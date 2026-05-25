const http = require('http');

http
  .get('http://127.0.0.1:3000/api/health/live', (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => {
      console.log('status', res.statusCode);
      console.log('body', data.slice(0, 300));
      process.exit(res.statusCode >= 400 ? 1 : 0);
    });
  })
  .on('error', (err) => {
    console.error('error', err.message);
    process.exit(1);
  });
