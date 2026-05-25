from pathlib import Path  
p=Path('ml/tests/test_algorithms.py')  
text=p.read_text()  
text=text.replace(\"assert q['snr']  \",\"assert q['snr'] > 5.0  \")  
text=text.replace('assert motion_energy(moving)  ','assert motion_energy(moving)   ')  
p.write_text(text)  
