import argparse
import json

import joblib
import numpy as np


def build_feature_row(open_price, high, low, close, prev_close, volume):
    body_pct = (close - open_price) / open_price if open_price != 0 else 0.0
    range_pct = (high - low) / close if close != 0 else 0.0
    close_to_prev_pct = (close - prev_close) / prev_close if prev_close != 0 else 0.0
    volume_log = float(np.log1p(max(volume, 0)))
    return {
        "body_pct": body_pct,
        "range_pct": range_pct,
        "close_to_prev_pct": close_to_prev_pct,
        "volume_log": volume_log,
    }


def attach_optional_indicators(row, args):
    def read_or_default(name, default_value):
        raw = getattr(args, name, None)
        if raw is None:
            return default_value
        try:
            return float(raw)
        except Exception:
            return default_value

    momentum_3 = read_or_default("momentum_3", row["close_to_prev_pct"])
    momentum_5 = read_or_default("momentum_5", row["close_to_prev_pct"])
    ema_fast_gap = read_or_default("ema_fast_gap", row["close_to_prev_pct"])
    ema_slow_gap = read_or_default("ema_slow_gap", row["close_to_prev_pct"] * 0.7)
    rsi_14_raw = read_or_default("rsi_14", 0.5)
    atr_pct_14 = read_or_default("atr_pct_14", row["range_pct"])

    if rsi_14_raw > 1:
        rsi_14 = max(0.0, min(100.0, rsi_14_raw)) / 100.0
    else:
        rsi_14 = max(0.0, min(1.0, rsi_14_raw))

    row["momentum_3"] = momentum_3
    row["momentum_5"] = momentum_5
    row["ema_fast_gap"] = ema_fast_gap
    row["ema_slow_gap"] = ema_slow_gap
    row["rsi_14"] = rsi_14
    row["atr_pct_14"] = atr_pct_14
    return row


def confidence_band(prob_up):
    if prob_up >= 0.7 or prob_up <= 0.3:
        return "high"
    if prob_up >= 0.6 or prob_up <= 0.4:
        return "medium"
    return "low"


def main():
    parser = argparse.ArgumentParser(description="Run finance direction model inference.")
    parser.add_argument("--model", required=True, help="Path to trained model .pkl")
    parser.add_argument("--open", type=float, required=True)
    parser.add_argument("--high", type=float, required=True)
    parser.add_argument("--low", type=float, required=True)
    parser.add_argument("--close", type=float, required=True)
    parser.add_argument("--prev-close", type=float, required=True)
    parser.add_argument("--volume", type=float, required=True)
    parser.add_argument("--momentum-3", type=float, default=None)
    parser.add_argument("--momentum-5", type=float, default=None)
    parser.add_argument("--ema-fast-gap", type=float, default=None)
    parser.add_argument("--ema-slow-gap", type=float, default=None)
    parser.add_argument("--rsi-14", type=float, default=None)
    parser.add_argument("--atr-pct-14", type=float, default=None)
    args = parser.parse_args()

    artifact = joblib.load(args.model)
    model = artifact["model"]
    features = artifact["feature_columns"]

    row = build_feature_row(
        open_price=args.open,
        high=args.high,
        low=args.low,
        close=args.close,
        prev_close=args.prev_close,
        volume=args.volume,
    )
    row = attach_optional_indicators(row, args)
    x = np.array([[row[f] for f in features]], dtype=float)
    prob_up = float(model.predict_proba(x)[0][1])
    pred_up = bool(prob_up >= 0.5)

    result = {
        "prediction": "up" if pred_up else "down",
        "probability_up": round(prob_up, 4),
        "probability_down": round(1 - prob_up, 4),
        "confidence": confidence_band(prob_up),
        "features": {k: round(v, 6) for k, v in row.items()},
        "explanation_simple": (
            "Model expects next session to move UP."
            if pred_up
            else "Model expects next session to move DOWN."
        ),
        "disclaimer": "Educational ML output only. Not financial advice.",
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
