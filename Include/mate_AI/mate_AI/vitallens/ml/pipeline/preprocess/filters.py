  
"""Band-pass and detrend helpers for rPPG."""  
import numpy as np  
  
def detrend(signal):  
    t = np.arange(len(signal))  
    p = np.polyfit(t, signal, 1)  
    return signal - (p[0] * t + p[1])  
  
def fft_bandpass(signal, fs, low=0.7, high=3.0):  
    spectrum = np.fft.rfft(signal)  
    freqs = np.fft.rfftfreq(len(signal), d=1.0 / fs)  
    mask = (freqs >= low) & (freqs <= high)  
    spectrum[~mask] = 0  
    return np.fft.irfft(spectrum)  
