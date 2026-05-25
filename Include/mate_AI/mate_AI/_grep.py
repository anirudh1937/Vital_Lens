import pathlib 
lines=pathlib.Path('public/index.html').read_text(encoding='utf-8',errors='ignore').splitlines() 
for i,l in enumerate(lines,1): 
    if 'stack-btn' in l and 'monitor' in l: 
        for j in range(i-5, i+5): 
