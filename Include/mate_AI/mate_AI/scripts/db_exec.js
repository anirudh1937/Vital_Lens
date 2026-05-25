const path = require('path');
const fs = require('fs');

const basePath = path.join(__dirname, '..');
const cfgPath = path.join(basePath, 'data', 'db_connections.json');

function usage() {
  console.log('Usage: npm run db:exec -- <engine> <connectionId> "<sql>"');
  console.log('Example: npm run db:exec -- postgres main "SELECT NOW();"');
}

function isReadOnlySql(query) {
  const q = String(query || '').trim().toLowerCase();
  const startsAllowed = ['select', 'with', 'show', 'describe', 'desc', 'explain', 'pragma'];
  const startsOk = startsAllowed.some((kw) => q.startsWith(kw));
  if (!startsOk) return false;
  const blocked = ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'truncate ', 'create ', 'grant ', 'revoke '];
  return !blocked.some((kw) => q.includes(kw));
}

async function run() {
  const args = process.argv.slice(2);
  const engineRaw = args[0];
  const connectionId = args[1];
  let query = args.slice(2).join(' ').trim();
  if ((query.startsWith('"') && query.endsWith('"')) || (query.startsWith("'") && query.endsWith("'"))) {
    query = query.slice(1, -1);
  }
  const engine = String(engineRaw || '').toLowerCase();
  if (!engine || !connectionId || !query) {
    usage();
    process.exit(1);
  }
  if (!isReadOnlySql(query)) {
    console.error('Only read-only SQL allowed in this helper script.');
    process.exit(1);
  }

  if (!fs.existsSync(cfgPath)) {
    console.error('Missing data/db_connections.json');
    process.exit(1);
  }
  const store = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const list = Array.isArray(store[engine]) ? store[engine] : [];
  const cfg = list.find((c) => c.id === connectionId);
  if (!cfg) {
    console.error(`Connection not found: ${engine}.${connectionId}`);
    process.exit(1);
  }

  if (engine === 'postgres') {
    const { Client } = require('pg');
    const client = new Client({
      host: cfg.host,
      port: Number(cfg.port || 5432),
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : false
    });
    await client.connect();
    const result = await client.query(query);
    await client.end();
    console.log(JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2));
    return;
  }

  if (engine === 'mysql') {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      host: cfg.host,
      port: Number(cfg.port || 3306),
      user: cfg.user,
      password: cfg.password,
      database: cfg.database
    });
    const [rows] = await conn.query(query);
    await conn.end();
    console.log(JSON.stringify({ rowCount: Array.isArray(rows) ? rows.length : 0, rows }, null, 2));
    return;
  }

  if (engine === 'sqlite') {
    const sqlite3 = require('sqlite3');
    const filename = path.isAbsolute(cfg.filename || '')
      ? cfg.filename
      : path.join(basePath, String(cfg.filename || 'data/mate.db'));
    const db = new sqlite3.Database(filename);
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error(err.message);
        process.exit(1);
      }
      console.log(JSON.stringify({ rowCount: Array.isArray(rows) ? rows.length : 0, rows }, null, 2));
      db.close();
    });
    return;
  }

  console.error('Unsupported engine. Use postgres/mysql/sqlite.');
  process.exit(1);
}

run().catch((err) => {
  console.error('db:exec failed:', err.message || err);
  process.exit(1);
});
