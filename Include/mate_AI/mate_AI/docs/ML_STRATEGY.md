# ML Strategy Options (Market-Aligned)

## Goal
Build practical ML capabilities that users can understand quickly and use with confidence.

## Option 1 (Recommended): Finance Trade Risk + Direction Model
- What it solves: helps retail users estimate trade quality and risk from structured inputs.
- Why now: strong demand, clear metrics, faster deployment than defense-grade pipelines.
- Initial deliverable:
  - Binary classifier for next-session direction (`up` / `down`) from OHLCV features.
  - Probability output + confidence band.
  - Explainable risk framing (not buy/sell guarantee).

## Option 2: Tech Full-Stack Talent/Feature Prioritization Model
- What it solves: predicts which features or skills give highest product/job market impact.
- Why useful: valuable for startup execution and roadmap decisions.
- Initial deliverable:
  - Ranking model for feature priority or skill demand.
  - Explainability by contribution score.

## Option 3: Defense Learning Model (Non-operational)
- What it solves: educational understanding of readiness/logistics tradeoffs.
- Why constrained: must avoid tactical/operational outputs and remain abstract.
- Initial deliverable:
  - Risk and readiness classification using synthetic or public policy datasets.

## Decision
Start with **Option 1 (Finance)** and then expand to Option 2 and Option 3 modules.

## What has been scaffolded now
- `ml/finance_market_model/requirements.txt`
- `scripts/ml_train_finance.py`
- `scripts/ml_predict_finance.py`
- `data/market/ohlcv_sample.csv`
- npm scripts:
  - `npm run ml:setup`
  - `npm run ml:finance:train`
  - `npm run ml:finance:predict`

## Next execution steps
1. Install ML dependencies.
2. Train baseline model and generate report.
3. Run inference command with sample candle.
4. Expose model inference via API endpoint in `server.js`.
5. Add a simple frontend panel for interactive prediction.
