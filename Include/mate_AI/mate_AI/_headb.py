import io 
lines=io.open('agentos-bridge/server.js','r',encoding='utf-8',errors='ignore').read().splitlines() 
for i in range(40): 
    print(f'{i+1}:{lines[i]}') 
