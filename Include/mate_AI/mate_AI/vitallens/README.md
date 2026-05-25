# VitalLens (separate product)

This folder will hold the standalone code for VitalLens (mobile + backend + ML). It stays separate from Mate/AgentOS/KubeOrbit.

## Planned structure
- `mobile/` (Expo React Native app)
- `backend/` (FastAPI + Postgres + Redis)
- `ml/` (training + export to TFLite)
- `docs/` (API contracts, model card, data sheet)

See `docs/VITALLENS_PLAN.md` for the build plan and phases.
## Phase 1 progress  
- rPPG pipeline skeleton added under ml/pipeline (ingest, preprocess, algorithms).  
- See ml/tests/test_algorithms.py for quick shape sanity checks. 
- Demo CLI: ml/scripts/run_demo.py (chrom|pos, requires OpenCV + numpy) 
