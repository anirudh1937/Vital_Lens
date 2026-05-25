# Mate AI Production Training Runbook

## 1. Goal
Build a repeatable training pipeline that improves Mate AI style + usefulness while preventing regressions.

## 2. Data Pipeline
Source data is chat history in `data/chats.json`.

Commands:

```bash
npm run models:verify
npm run train:prepare
npm run train:quality
npm run train:prepare:preferences
```

Default behavior: `train:prepare` includes only assistant replies rated `up` via feedback API.
Bootstrap behavior (early stage): `npm run train:prepare:bootstrap` to include unrated replies.

Outputs:
- `training_data/train.jsonl`
- `training_data/valid.jsonl`
- `training_data/stats.json`
- `training_data/preferences.jsonl` (for DPO-style training)

## 3. Training Strategy
Use staged training:
1. SFT on tone + helpfulness examples.
2. Preference optimization (DPO/RLHF style) once enough rated samples exist.
3. Final evaluation against a fixed benchmark prompt set before deploy.

Recommended stack for production:
- Fine-tuning framework: Axolotl or Unsloth
- Base model family: Llama 3.x Instruct compatible model
- Artifact storage: versioned model registry (Hugging Face private repo or internal registry)

## 4. Release Criteria
Do not ship unless all checks pass:
- Data quality gate passes.
- Validation loss improves over previous version or stays within accepted drift.
- Prompt benchmark score is not worse than previous production model.
- Safety checks pass (prompt injection + refusal behavior + harmful content boundaries).

## 5. Operational Rules
- Version datasets, configs, and model artifacts together.
- Keep at least one rollback model always ready.
- Run canary rollout (5-10% traffic) before full deployment.
- Track live metrics: latency, refusal rate, user thumbs up/down, session retention.

## 6. Next Upgrade
Add explicit human feedback collection:
- Save `rating`, `issue_type`, `preferred_answer` per assistant reply.
- Convert rated conversations into preference pairs for DPO.

## 7. Model Freshness Policy
To avoid stale/older model defaults, runtime model routing is controlled by:

- `data/model_policy.json`
- optional env overrides: `GROQ_MODEL_PRIMARY`, `GROQ_MODEL_TREND`, `GROQ_MODEL_FALLBACK`, `TRAIN_TEACHER_MODEL`, `TRAIN_BASE_FAMILY`

Operational rule:
1. Update `data/model_policy.json` whenever your provider releases or deprecates models.
2. Keep a `primary` and a `fallback` model to avoid outages from model retirement.
3. Verify active runtime model via `/api/system/stack` and `X-Model-Used` response header on `/api/chat`.
