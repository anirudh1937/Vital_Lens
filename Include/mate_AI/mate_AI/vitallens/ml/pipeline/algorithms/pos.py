import numpy as np
from scipy.signal import butter, filtfilt

def _bandpass(sig, fs, fmin=0.7, fmax=3.0, order=3):
    b, a = butter(order, [fmin/(fs/2), fmax/(fs/2)], btype="band")
    return filtfilt(b, a, sig)

def _fft_peak(signal, fs, fmin=0.7, fmax=3.0):
    n = len(signal)
    if n < 10:
        return None
    freqs = np.fft.rfftfreq(n, d=1.0/fs)
    spectrum = np.abs(np.fft.rfft(signal * np.hamming(n)))
    band = (freqs >= fmin) & (freqs <= fmax)
    if not np.any(band):
        return None
    peak_freq = freqs[band][np.argmax(spectrum[band])]
    return peak_freq * 60.0

def estimate_bpm_pos(rgb: np.ndarray, fs: float):
    rgb_norm = (rgb / (np.mean(rgb, axis=0) + 1e-6)) - 1.0
    M = np.array([[0, 1, -1], [-2, 1, 1]], dtype=np.float32)
    S = rgb_norm @ M.T
    h = S[:, 0] + S[:, 1] * (np.std(S[:, 0]) / (np.std(S[:, 1]) + 1e-6))
    h = _bandpass(h - np.mean(h), fs)
    bpm = _fft_peak(h, fs)
    return bpm, h
