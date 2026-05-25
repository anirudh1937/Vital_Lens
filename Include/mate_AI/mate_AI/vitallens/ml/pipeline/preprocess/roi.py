# Face ROI mask using MediaPipe Face Mesh (optional). 
import numpy as np  
import cv2 
try:  
    import mediapipe as mp  
    _mp_face_mesh = mp.solutions.face_mesh  
except Exception:  
    mp = None  
    _mp_face_mesh = None 
  
def face_roi_mask(rgb_frame):  
    if _mp_face_mesh is None:  
        return None  
    h, w, _ = rgb_frame.shape  
    with _mp_face_mesh.FaceMesh(static_image_mode=True, refine_landmarks=True, max_num_faces=1) as fm:  
        res = fm.process(rgb_frame)  
        if not res.multi_face_landmarks:  
            return None  
        pts = []  
        for lm in res.multi_face_landmarks[0].landmark:  
            pts.append([int(lm.x * w), int(lm.y * h)])  
        hull = cv2.convexHull(np.array(pts))  
        mask = np.zeros((h, w), dtype=np.uint8)  
        cv2.fillConvexPoly(mask, hull, 1)  
        return mask.astype(bool)  
  
def masked_mean_rgb(frame, mask):  
    if mask is None:  
        return frame.reshape(-1, 3).mean(axis=0)  
    region = frame[mask]  
    if region.size == 0:  
        return frame.reshape(-1, 3).mean(axis=0)  
    return region.mean(axis=0) 
