import argparse
import json
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score


FEATURE_COLUMNS = [
    "body_pct",
    "range_pct",
    "close_to_prev_pct",
    "volume_log",
    "momentum_3",
    "momentum_5",
    "ema_fast_gap",
    "ema_slow_gap",
    "rsi_14",
    "atr_pct_14",
]


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    data = df.copy()
    required = ["open", "high", "low", "close", "volume"]
    missing = [c for c in required if c not in data.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    data["prev_close"] = data["close"].shift(1)
    data["body_pct"] = np.where(data["open"] != 0, (data["close"] - data["open"]) / data["open"], 0.0)
    data["range_pct"] = np.where(data["close"] != 0, (data["high"] - data["low"]) / data["close"], 0.0)
    data["close_to_prev_pct"] = np.where(
        data["prev_close"].fillna(0) != 0,
        (data["close"] - data["prev_close"]) / data["prev_close"],
        0.0,
    )
    data["volume_log"] = np.log1p(data["volume"].clip(lower=0))
    data["momentum_3"] = data["close"].pct_change(3).replace([np.inf, -np.inf], np.nan)
    data["momentum_5"] = data["close"].pct_change(5).replace([np.inf, -np.inf], np.nan)

    ema_fast = data["close"].ewm(span=5, adjust=False).mean()
    ema_slow = data["close"].ewm(span=12, adjust=False).mean()
    data["ema_fast_gap"] = np.where(data["close"] != 0, (data["close"] - ema_fast) / data["close"], 0.0)
    data["ema_slow_gap"] = np.where(data["close"] != 0, (data["close"] - ema_slow) / data["close"], 0.0)

    delta = data["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=14, min_periods=14).mean()
    avg_loss = loss.rolling(window=14, min_periods=14).mean()
    rs = np.where(avg_loss != 0, avg_gain / avg_loss, np.nan)
    data["rsi_14"] = 100 - (100 / (1 + rs))
    data["rsi_14"] = data["rsi_14"].fillna(50.0) / 100.0

    prev_close = data["close"].shift(1)
    tr1 = data["high"] - data["low"]
    tr2 = (data["high"] - prev_close).abs()
    tr3 = (data["low"] - prev_close).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr14 = true_range.rolling(window=14, min_periods=14).mean()
    data["atr_pct_14"] = np.where(data["close"] != 0, atr14 / data["close"], np.nan)
    data["atr_pct_14"] = data["atr_pct_14"].fillna(data["range_pct"])

    data["target_up"] = (data["close"].shift(-1) > data["close"]).astype(int)
    data = data.dropna(subset=FEATURE_COLUMNS + ["target_up"])
    return data


def split_timewise(data: pd.DataFrame, train_ratio: float = 0.8):
    n = len(data)
    if n < 20:
        raise ValueError(f"Need at least 20 usable rows after feature engineering, got {n}.")
    idx = max(1, int(n * train_ratio))
    train = data.iloc[:idx]
    test = data.iloc[idx:]
    return train, test


def train_model(train_df: pd.DataFrame):
    x_train = train_df[FEATURE_COLUMNS].values
    y_train = train_df["target_up"].values
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=6,
        min_samples_leaf=4,
        random_state=42,
        class_weight="balanced_subsample",
    )
    model.fit(x_train, y_train)
    return model


def evaluate(model, test_df: pd.DataFrame):
    x_test = test_df[FEATURE_COLUMNS].values
    y_test = test_df["target_up"].values
    pred = model.predict(x_test)
    proba = model.predict_proba(x_test)[:, 1]

    metrics = {
        "accuracy": float(accuracy_score(y_test, pred)),
        "precision": float(precision_score(y_test, pred, zero_division=0)),
        "recall": float(recall_score(y_test, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, proba)) if len(np.unique(y_test)) > 1 else None,
        "test_size": int(len(y_test)),
    }
    return metrics


def ensure_parent_dir(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Train finance market-direction ML model.")
    parser.add_argument("--input", required=True, help="Path to OHLCV CSV")
    parser.add_argument("--model-out", required=True, help="Output .pkl artifact path")
    parser.add_argument("--report-out", required=True, help="Output training report JSON path")
    args = parser.parse_args()

    df = pd.read_csv(args.input)
    if "date" in df.columns:
        df = df.sort_values("date")
    engineered = engineer_features(df)
    train_df, test_df = split_timewise(engineered, train_ratio=0.8)
    model = train_model(train_df)
    metrics = evaluate(model, test_df)

    feature_importance = dict(
        sorted(
            zip(FEATURE_COLUMNS, model.feature_importances_),
            key=lambda x: x[1],
            reverse=True,
        )
    )

    artifact = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "meta": {
            "rows_total": int(len(df)),
            "rows_engineered": int(len(engineered)),
            "rows_train": int(len(train_df)),
            "rows_test": int(len(test_df)),
        },
    }

    ensure_parent_dir(args.model_out)
    ensure_parent_dir(args.report_out)
    joblib.dump(artifact, args.model_out)

    report = {
        "trained_at": artifact["trained_at"],
        "input_file": args.input,
        "model_file": args.model_out,
        "features": FEATURE_COLUMNS,
        "metrics": metrics,
        "feature_importance": {k: float(v) for k, v in feature_importance.items()},
        "disclaimer": "Educational ML baseline. Not investment advice or guaranteed performance.",
    }
    with open(args.report_out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("Training completed.")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
