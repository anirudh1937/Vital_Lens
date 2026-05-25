const fs=require('fs'); 
let t=fs.readFileSync('agentos-bridge/server.js','utf8'); 
if(!t.includes('sqlite3')){t=t.replace(\"const mqtt = require('mqtt');\n\",\"const mqtt = require('mqtt');\nconst sqlite3 = require('sqlite3').verbose();\n\");fs.writeFileSync('agentos-bridge/server.js',t);} 
