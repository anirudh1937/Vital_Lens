const http = require('http');

function check(pathname, label) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:3000${pathname}`, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c.toString();
        });
        res.on('end', () => {
          console.log(`${label}_STATUS ${res.statusCode}`);
          console.log(body.slice(0, 120));
          resolve();
        });
      })
      .on('error', (err) => reject(err));
  });
}

check('/real-estate', 'ROUTE')
  .then(() => check('/real_estate.html', 'STATIC'))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`ROUTE_ERROR ${err.message}`);
    process.exit(1);
  });
