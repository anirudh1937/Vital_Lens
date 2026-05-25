const http = require('http');

const url = 'http://127.0.0.1:3000/api/rag/status';
const deadline = Date.now() + 15000;

function ping() {
  http
    .get(url, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c.toString();
      });
      res.on('end', () => {
        console.log(`HEALTH_STATUS ${res.statusCode}`);
        console.log(body.slice(0, 500));
        process.exit(res.statusCode >= 200 && res.statusCode < 500 ? 0 : 1);
      });
    })
    .on('error', () => {
      if (Date.now() < deadline) {
        setTimeout(ping, 600);
      } else {
        console.error('HEALTH_STATUS unreachable');
        process.exit(1);
      }
    });
}

ping();
