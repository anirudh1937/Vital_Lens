import pathlib 
lines=pathlib.Path('public/index.html').read_text(encoding='utf-8',errors='ignore').splitlines() 
print('lines',len(lines)) 
[print(i+1,':',lines[i]) for i in range(len(lines)-20,len(lines))] 
