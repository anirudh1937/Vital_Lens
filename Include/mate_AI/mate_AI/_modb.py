import pathlib 
p=pathlib.Path('agentos-bridge/server.js') 
txt=p.read_text() 
txt=txt.replace(\"const mqtt = require('mqtt');\",\"const mqtt = require('mqtt');\nconst aedes = require('aedes');\nconst net = require('net');\") 
p.write_text(txt) 
