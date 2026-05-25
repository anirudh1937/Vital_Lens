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

def estimate_bpm_chrom(rgb: np.ndarray, fs: float):
    X = rgb - np.mean(rgb, axis=0)
    r, g, b = X[:, 0], X[:, 1], X[:, 2]
    s1 = 3 * r - 2 * g
    s2 = 1.5 * r + g - 1.5 * b
    alpha = np.std(s1) / (np.std(s2) + 1e-6)
    h = s1 - alpha * s2
    h = _bandpass(h - np.mean(h), fs)
    bpm = _fft_peak(h, fs)
    return bpm, h
