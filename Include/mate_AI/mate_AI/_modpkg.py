import json, pathlib 
p=pathlib.Path('agentos-bridge/package.json') 
data=json.loads(p.read_text()) 
data['dependencies']['aedes']='0.48.1' 
p.write_text(json.dumps(data, indent=2)) 
