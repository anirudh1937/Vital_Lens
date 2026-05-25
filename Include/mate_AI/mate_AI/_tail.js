const fs=require('fs'); 
const lines=fs.readFileSync('server.js','utf8').split(/\r?\n/); 
const start=Math.max(0,lines.length-80); 
