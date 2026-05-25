 
"""Demo: run CHROM/POS on a video and print estimated HR with optional FaceMesh ROI."""  
import argparse  
import sys  
from pathlib import Path  
import numpy as np  
ROOT = Path(__file__).resolve().parents[1]  
sys.path.insert(0, str(ROOT))  
from pipeline.ingest.frames import read_video  
from pipeline.preprocess.filters import detrend, fft_bandpass  
from pipeline.preprocess.roi import face_roi_mask  
from pipeline.algorithms.chrom import chrom  
from pipeline.algorithms.pos import pos  
from pipeline.utils.signal import frames_to_rgb_traces, motion_energy, signal_quality 
def peak_hr(signal, fs, low=0.7, high=3.0):  
    n = len(signal)  
    if n == 0:  
        return None  
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)  
    spectrum = np.abs(np.fft.rfft(signal - np.mean(signal)))  
    mask = (freqs >= low) & (freqs <= high)  
    if not mask.any():  
        return None  
    idx = np.argmax(spectrum[mask])  
    hr_hz = freqs[mask][idx]  
    return hr_hz * 60.0 
def main():  
    parser = argparse.ArgumentParser(description='Run rPPG demo on a video file')  
    parser.add_argument('video', help='Path to video (mp4/mov)')  
    parser.add_argument('--algo', choices=['chrom','pos'], default='chrom')  
    parser.add_argument('--fps', type=float, default=30.0, help='Target fps for sampling')  
    parser.add_argument('--max_frames', type=int, default=None, help='Optional frame cap')  
    parser.add_argument('--use_facemesh', action='store_true', help='Compute ROI mask via MediaPipe FaceMesh')  
    args = parser.parse_args()  
    frames = list(read_video(args.video, target_fps=args.fps, max_frames=args.max_frames))  
    if not frames:  
        print('No frames read; check video path/fps')  
        sys.exit(1)  
    mask = None  
    if args.use_facemesh:  
        sample = frames[0].rgb if hasattr(frames[0], 'rgb') else frames[0]['rgb']  
        mask = face_roi_mask(sample)  
        if mask is None:  
            print('FaceMesh mask not available; proceeding with full-frame mean')  
    traces = frames_to_rgb_traces(frames, mask=mask)  
    motion = motion_energy(traces)  
    sig = chrom(traces) if args.algo == 'chrom' else pos(traces)  
    sig = detrend(sig)  
    sig = fft_bandpass(sig, fs=args.fps)  
    quality = signal_quality(sig, fs=args.fps)  
    hr = peak_hr(sig, fs=args.fps)  
    if hr is None:  
        print('Could not detect heart rate peak in band 0.7-3.0 Hz')  
        sys.exit(2)  
    print(f"Estimated HR: {hr:.1f} bpm (algo={args.algo}, frames={len(frames)}, snr={quality['snr']:.2f}, motion={motion:.4f})") 
if __name__ == '__main__':  
    main() 
