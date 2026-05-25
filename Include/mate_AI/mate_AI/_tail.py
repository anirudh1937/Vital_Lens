from pathlib import Path 
lines=Path('server.js').read_text(encoding='utf-8',errors='ignore').splitlines() 
start=max(0,len(lines)-200) 
for i in range(start,len(lines)): 
    print(f'{i+1}:{lines[i]}') 
