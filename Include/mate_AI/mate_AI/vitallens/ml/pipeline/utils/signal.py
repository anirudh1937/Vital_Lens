 
# Signal utilities for rPPG  
import numpy as np  
from pipeline.preprocess.roi import masked_mean_rgb  
  
def frames_to_rgb_traces(frames, mask=None):  
    traces = []  
    for f in frames:  
        rgb = f['rgb'] if isinstance(f, dict) else f.rgb  
        traces.append(masked_mean_rgb(rgb, mask))  
    return np.asarray(traces)  
  
def sliding_window(signal, size, step):  
    for start in range(0, len(signal) - size + 1, step):  
        yield signal[start:start+size]  
  
def motion_energy(traces):  
    if len(traces) < 2:  
        return 0.0  
    diffs = np.diff(traces, axis=0)  
    return float(np.linalg.norm(diffs) / len(diffs))  
  
def signal_quality(sig, fs, low=0.7, high=3.0):  
    n = len(sig)  
    if n < 4:  
        return {'snr': 0.0}  
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)  
    spectrum = np.abs(np.fft.rfft(sig - np.mean(sig)))  
    mask = (freqs >= low) & (freqs <= high)  
    if not mask.any():  
        return {'snr': 0.0}  
    peak = spectrum[mask].max()  
    noise_floor = np.median(spectrum[~mask]) if (~mask).any() else 1e-6  
    snr = float(peak / (noise_floor + 1e-6))  
    return {'snr': snr} 
