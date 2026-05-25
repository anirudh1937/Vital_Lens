from pathlib import Path 
p=Path('agentos-bridge/server.js') 
text=p.read_text() 
if \"sqlite3\" not in text: 
    text=text.replace(\"const mqtt = require('mqtt');\n\",\"const mqtt = require('mqtt');\nconst sqlite3 = require('sqlite3').verbose();\n\") 
p.write_text(text) 
