# VitalLens — Build Plan

This keeps VitalLens separate from Mate/AgentOS/KubeOrbit. It outlines what to ship and how to stage it.

## Scope
- React Native mobile app (Expo) for face capture and vitals display.
- rPPG extraction + ML inference (Python for training, TFLite for on-device).
- FastAPI backend for auth, storage, and trend APIs.
- Mate AI sits on top as the health interpreter (tooling only), but VitalLens code lives in its own service set.

## Architecture (layers)
1) **Mobile (RN/Expo)**: 30fps camera, MediaPipe FaceMesh ROI, sends short clips/frames.
2) **Signal extraction (Python/OpenCV/NumPy)**: CHROM/POS rPPG, bandpass 0.7–3Hz, FFT peak.
3) **ML model (PyTorch → TFLite)**: 1D CNN/Transformer trained on UBFC-rPPG + MAHNOB-HCI; noise rejection head.
4) **Backend (FastAPI + Postgres + Redis)**: auth (JWT), uploads, vitals store, WebSockets for live feed.
5) **Mate AI tools**: trend analysis, doctor referral, anomaly alerts (MCP server).
6) **Deploy**: Docker/K8s (KubeOrbit), Prom/Grafana, GitHub Actions CI/CD.

## Phased delivery (from the brief)
- **Phase 1 (3 wks)**: rPPG pipeline MVP (desktop script) + model baseline.
- **Phase 2 (2 wks)**: FastAPI backend (auth, vitals API, storage, docker-compose).
- **Phase 3 (3 wks)**: React Native app (capture UI, live vitals, history).
- **Phase 4 (2 wks)**: Mate AI integration (MCP health tools, alerts).
- **Phase 5 (1 wk)**: K8s deploy via KubeOrbit.

## Repos / folders (recommended)
- `vitallens/mobile` (Expo RN)
- `vitallens/backend` (FastAPI, Postgres, Redis, Dockerfile, k8s manifests)
- `vitallens/ml` (training notebooks, data loaders, export to TFLite)
- `vitallens/docs` (API contracts, model cards, data sheets)

## Immediate next actions (lightweight)
1) Create repo skeleton with README in `vitallens/`.
2) Stub FastAPI service with health/auth placeholder and docker-compose (Postgres/Redis).
3) Add RN placeholder app with camera permission screen.
4) Add CI stub (GitHub Actions) for backend lint/test.

## Data & compliance
- Datasets: UBFC-rPPG, MAHNOB-HCI (document licenses), internal noise augmentation.
- Security: JWT, HTTPS, minimal PHI; plan for HIPAA-ready deployment (logging/scrubbing).

## Dependencies
- Backend: Python 3.10+, FastAPI, uvicorn, SQLAlchemy, psycopg2, Redis, Pydantic.
- ML: PyTorch for training; export to ONNX → TFLite for mobile.
- Mobile: Expo, React Native, Expo Camera, React Query for API, WebSockets for live.

## KubeOrbit deploy notes
- Namespace `vitallens`.
- Deployments: `vital-backend`, `vital-worker` (for batch model runs), `vital-frontend` (optional web).
- Services: ClusterIP for backend, ingress via existing controller.
