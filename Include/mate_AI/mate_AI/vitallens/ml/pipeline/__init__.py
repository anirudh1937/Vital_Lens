from pathlib import Path
import numpy as np

from .ingest.frames import extract_rgb_trace
from .algorithms.pos import estimate_bpm_pos
from .algorithms.chrom import estimate_bpm_chrom

def estimate_hr(video_path: str):
    video_path = str(Path(video_path))
    rgb, fs, ts = extract_rgb_trace(video_path)
    bpm_pos, _ = estimate_bpm_pos(rgb, fs)
    bpm_chrom, _ = estimate_bpm_chrom(rgb, fs)

    # Choose the better one (fallback to whichever is not None)
    candidates = [b for b in [bpm_pos, bpm_chrom] if b is not None]
    best = float(np.median(candidates)) if candidates else None

    return {
        "fs": fs,
        "num_samples": len(rgb),
        "bpm_pos": bpm_pos,
        "bpm_chrom": bpm_chrom,
        "bpm_best": best,
    }

def cli():
    import argparse, json
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True, help="path to face video")
    args = p.parse_args()
    result = estimate_hr(args.video)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    cli()
