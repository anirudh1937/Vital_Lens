import cv2
import numpy as np

try:
    import mediapipe as mp
except ImportError as exc:
    raise ImportError("mediapipe is required (pip install mediapipe).") from exc

ROI_POINTS = {
    "left_cheek": [234, 93, 132, 58, 172, 136],
    "right_cheek": [454, 323, 361, 288, 397, 365],
    "forehead": [10, 338, 297, 332, 103, 67],
}

def _mean_rgb_at_points(frame_rgb, landmarks, idxs, radius=2):
    h, w, _ = frame_rgb.shape
    samples = []
    for idx in idxs:
        pt = landmarks.landmark[idx]
        x = int(pt.x * w)
        y = int(pt.y * h)
        x0, x1 = max(0, x - radius), min(w, x + radius + 1)
        y0, y1 = max(0, y - radius), min(h, y + radius + 1)
        if x0 < x1 and y0 < y1:
            samples.append(frame_rgb[y0:y1, x0:x1].reshape(-1, 3))
    if not samples:
        return None
    all_pix = np.concatenate(samples, axis=0)
    return all_pix.mean(axis=0)

def extract_rgb_trace(video_path: str, target_fps: float = 30.0):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    native_fps = cap.get(cv2.CAP_PROP_FPS) or target_fps
    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    rgb_trace = []
    ts = []
    frame_idx = 0
    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break
        frame_idx += 1
        timestamp = frame_idx / native_fps
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        res = face_mesh.process(frame_rgb)
        if not res.multi_face_landmarks:
            continue
        lm = res.multi_face_landmarks[0]
        region_means = []
        for idxs in ROI_POINTS.values():
            m = _mean_rgb_at_points(frame_rgb, lm, idxs)
            if m is not None:
                region_means.append(m)
        if not region_means:
            continue
        rgb_trace.append(np.mean(region_means, axis=0))
        ts.append(timestamp)

    cap.release()
    face_mesh.close()

    if not rgb_trace:
        raise ValueError("No face/ROI detected long enough to extract signal.")

    rgb_trace = np.asarray(rgb_trace, dtype=np.float32) / 255.0
    ts = np.asarray(ts, dtype=np.float32)

    if len(ts) > 1:
        t_uniform = np.arange(ts[0], ts[-1], 1.0 / target_fps)
        rgb_resampled = np.vstack(
            [np.interp(t_uniform, ts, rgb_trace[:, c]) for c in range(3)]
        ).T
        fs = target_fps
    else:
        rgb_resampled = rgb_trace
        fs = target_fps

    return rgb_resampled, fs, ts
