const fs = require('fs');
const path = process.argv[2];
const start = Number(process.argv[3] || 1);
const count = Number(process.argv[4] || 80);
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
const s = Math.max(1, start);
const e = Math.min(lines.length, s + count - 1);
for (let i = s; i <= e; i++) {
  console.log(`${i}:${lines[i - 1]}`);
}
