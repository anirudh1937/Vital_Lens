import pathlib 
lines=pathlib.Path('server.js').read_text().splitlines() 
for i,l in enumerate(lines,1): 
    if 'listen(' in l or 'PORT' in l: 
        print(i,l) 
