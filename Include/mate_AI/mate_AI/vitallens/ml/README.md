rPPG pipeline skeleton  
-----------------------  
- ingest: frame reader in pipeline/ingest/frames.py  
- preprocess: fft_bandpass + detrend in pipeline/preprocess/filters.py  
- algorithms: chrom.py and pos.py in pipeline/algorithms  
- utils: signal.py helpers for RGB traces and windows  
- tests: ml/tests/test_algorithms.py basic shape checks 
- demo: run rPPG on a video with run_demo.py --algo chrom|pos path/to/video.mp4 
- optional FaceMesh ROI: run_demo.py --use_facemesh (requires mediapipe) 
