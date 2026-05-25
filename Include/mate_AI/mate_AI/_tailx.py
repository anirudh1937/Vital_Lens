import io 
lines=io.open('server.js','r',encoding='utf-8',errors='ignore').read().splitlines() 
start=max(0,len(lines)-60) 
for i in range(start,len(lines)): 
    s=f'{i+1}:{lines[i]}' 
    print(s.encode('ascii','replace').decode('ascii')) 
