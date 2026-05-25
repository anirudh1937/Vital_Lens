# Master Project Architecture & Software Stack

This document outlines the complete technology stack used across the integrated Mate AI and VitalLens ecosystem.

---

## 1. Mate AI (The "Brain" & Web Platform)
*The core personalized AI chatbot and interactive web interface.*

### Frontend (Web)
* **Core:** Vanilla HTML5, CSS3, Vanilla JavaScript (ES6 Modules)
* **Styling:** Custom CSS with 2026 "Dynamic Minimal Glass" aesthetic (Glassmorphism, CSS Variables, Animations)
* **3D Graphics:** Vanilla Three.js (`particle_swarm.js` integration)
* **Markdown Rendering:** Marked.js (via CDN)
* **PWA:** Service Workers (`sw.js`) and Web Manifest for installable web app capabilities.

### Backend (API & Inference)
* **Server:** Node.js with Express.js (`server.js` running on Port 3000)
* **LLM Engine:** Ollama / Groq API (`llama-3.3-70b` model)
* **Real-time Comm:** Server-Sent Events (SSE) for streaming AI chat responses.

---

## 2. VitalLens (The Bio-Sensing System)
*The system responsible for capturing user video and extracting physiological data.*

### Mobile Application (Frontend)
* **Framework:** React Native
* **Build System / Bundler:** Expo (`npx expo`) & Metro Bundler
* **Camera / Capture:** `expo-camera` (for 30s facial video capture)
* **State Management:** React Hooks (`useState`, `useEffect`, `useRef`)
* **Network:** Fetch API for REST endpoints (`api.js`)

### Analysis Backend (API)
* **Server:** Python 3.10
* **Framework:** FastAPI (`app.main:app` running on Port 8000 via Uvicorn)
* **Computer Vision / ML:** OpenCV (`cv2`), MediaPipe (Face mesh tracking)
* **Signal Processing:** NumPy, SciPy (Used for rPPG - remote photoplethysmography to extract Heart Rate, Stress, Radiance)
* **Database / ORM:** SQLAlchemy / SQLModel / PostgreSQL (for the Bio-Metric Vault)

---

## 3. Infrastructure & Edge (AgentOS)
*The underlying hardware integration and operational stack.*

* **Edge Devices:** STM32F4-class Microcontrollers ($5-$10 MCUs)
* **IoT Protocols:** MQTT (for device telemetry and AgentOS bridging)
* **Container Orchestration:** KubeOrbit (Cluster viewing/management)
* **Environments:** Node Virtual Environment (`node_modules`), Python Virtual Environment (`f:\venv-vitallens`)

---

## 4. Integration Flow
1. **User** scans face using **Expo React Native App**.
2. Video is sent to **FastAPI Python Backend**.
3. Python extracts `BPM, Stress, Symmetry, Radiance`.
4. Stats are passed transparently as context via React Native to **Node.js Express Server**.
5. **Mate AI (Groq/Ollama)** streams a personalized health analysis back to the mobile app.
