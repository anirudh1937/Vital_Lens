from pathlib import Path 
txt=Path('server.js').read_text() 
for i,line in enumerate(txt.splitlines(),1): 
    if '4001' in line or 'PORT' in line.upper(): 
        print('{0}: {1}'.format(i, line[:200])) 
