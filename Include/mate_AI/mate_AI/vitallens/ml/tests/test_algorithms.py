  
import numpy as np  
from ml.pipeline.algorithms.chrom import chrom  
from ml.pipeline.algorithms.pos import pos  
from ml.pipeline.utils.signal import motion_energy, signal_quality  
  
def test_chrom_shape():  
    x = np.ones((30,3))  
    y = chrom(x)  
    assert y.shape[0] == 30  
  
def test_pos_shape():  
    x = np.ones((30,3))  
    y = pos(x)  
    assert y.shape[0] == 30  
  
def test_signal_quality_peak():  
    fs = 30  
    t = np.arange(fs * 5) / fs  
    sig = np.sin(2 * np.pi * 1.2 * t)  
    q = signal_quality(sig, fs)  
    assert q['snr'] > 5.0  
  
def test_motion_energy():  
    flat = np.ones((5,3))  
    moving = np.array([[0,0,0],[1,1,1],[2,2,2]])  
    assert motion_energy(flat) == 0.0  
    assert motion_energy(moving) > 0.0  
