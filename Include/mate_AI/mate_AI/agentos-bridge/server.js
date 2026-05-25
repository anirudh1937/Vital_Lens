/* AGENTOS Bridge — standalone from Mate AI
 * Exposes:
 *  - POST /api/agentos/devices/:id/goal
 *  - POST /api/agentos/devices/:id/telemetry
 *  - GET  /api/agentos/devices/:id/telemetry
 *  - GET  /api/agentos/devices
 */
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const fs = require('fs');
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;
const SECRET = (process.env.AGENTOS_SECRET || '').trim();
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const MQTT_GOAL_TOPIC = process.env.MQTT_GOAL_TOPIC || 'agentos/{deviceId}/goal';
const MQTT_TELEMETRY_TOPIC = process.env.MQTT_TELEMETRY_TOPIC || 'agentos/+/telemetry';
const DB_FILE = process.env.AGENTOS_DB || './agentos.db';
const GOAL_RATE_LIMIT = Number(process.env.AGENTOS_GOAL_RATE || 30); // per device per minute
const DEVICE_KEYS = (() => { try { return JSON.parse(process.env.AGENTOS_KEYS || '{}'); } catch { return {}; } })();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

let mqttClient = null;
let db;
const goalRateLog = new Map(); // deviceId -> timestamps array

// --- Utilities ---
const sanitizeId = (raw) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

function safeJsonParse(x) { try { return JSON.parse(x); } catch { return {}; } }

function verifyHmac(req, deviceId) {
  const key = DEVICE_KEYS[deviceId] || SECRET;
  if (!key) return true; // open mode
  const sig = String(req.headers['x-agentos-signature'] || '');
  const ts = String(req.headers['x-agentos-timestamp'] || '');
  const nonce = String(req.headers['x-agentos-nonce'] || '');
  if (!sig || !ts || !nonce) return false;
  const ageMs = Math.abs(Date.now() - Number(ts));
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return false;
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const msg = `${ts}.${nonce}.${body}`;
  const expected = crypto.createHmac('sha256', key).update(msg).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

function checkRateLimit(deviceId) {
  const now = Date.now();
  const windowMs = 60_000;
  const arr = goalRateLog.get(deviceId) || [];
  const recent = arr.filter((t) => now - t < windowMs);
  recent.push(now);
  goalRateLog.set(deviceId, recent);
  return recent.length <= GOAL_RATE_LIMIT;
}

// --- DB setup ---
function initDb() {
  db = new sqlite3.Database(DB_FILE);
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        deviceId TEXT,
        traceId TEXT,
        goal TEXT,
        plan TEXT,
        safety TEXT,
        status TEXT,
        at INTEGER
      )`
    );
    db.run(
      `CREATE TABLE IF NOT EXISTS telemetry (
        id TEXT PRIMARY KEY,
        deviceId TEXT,
        payload TEXT,
        at INTEGER
      )`
    );
  });
}
initDb();

// --- Persistence helpers ---
function insertGoal(entry) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO goals (id, deviceId, traceId, goal, plan, safety, status, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.deviceId,
        entry.traceId,
        entry.goal,
        entry.plan,
        JSON.stringify(entry.safety || {}),
        entry.status,
        entry.at
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function insertTelemetry(deviceId, payload) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO telemetry (id, deviceId, payload, at) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), deviceId, JSON.stringify(payload || {}), Date.now()],
      (err) => (err ? reject(err) : resolve())
    );
  }).catch((e) => console.error('telemetry insert failed', e.message));
}

function fetchDeviceSummary() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT deviceId,
              SUM(CASE WHEN tbl='g' THEN 1 ELSE 0 END) AS goals,
              SUM(CASE WHEN tbl='t' THEN 1 ELSE 0 END) AS telemetry,
              MAX(at) AS updatedAt
       FROM (
         SELECT deviceId, at, 'g' AS tbl FROM goals
         UNION ALL
         SELECT deviceId, at, 't' AS tbl FROM telemetry
       )
       GROUP BY deviceId
       ORDER BY updatedAt DESC
       LIMIT 200`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function fetchDeviceDetail(deviceId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM goals WHERE deviceId=? ORDER BY at DESC LIMIT 20`,
      [deviceId],
      (err, goals) => {
        if (err) return reject(err);
        db.all(
          `SELECT * FROM telemetry WHERE deviceId=? ORDER BY at DESC LIMIT 40`,
          [deviceId],
          (err2, tele) => {
            if (err2) return reject(err2);
            resolve({
              goals: (goals || []).map((g) => ({
                id: g.id,
                traceId: g.traceId,
                goal: g.goal,
                plan: g.plan,
                safety: safeJsonParse(g.safety),
                status: g.status,
                at: g.at
              })),
              telemetry: (tele || []).map((t) => ({
                id: t.id,
                payload: safeJsonParse(t.payload),
                at: t.at
              }))
            });
          }
        );
      }
    );
  });
}

// --- MQTT ---
const mqttOpts = { username: MQTT_USERNAME || undefined, password: MQTT_PASSWORD || undefined };
mqttClient = mqtt.connect(MQTT_URL, mqttOpts);
mqttClient.on('connect', () => {
  console.log(`MQTT connected to ${MQTT_URL}`);
  mqttClient.subscribe(MQTT_TELEMETRY_TOPIC, { qos: 1 }, (err) => {
    if (err) console.error('MQTT subscribe error', err.message);
  });
});
mqttClient.on('message', (topic, msg) => {
  try {
    const parts = topic.split('/');
    const idx = parts.findIndex((p) => p === 'agentos');
    const deviceId = sanitizeId(parts[idx + 1] || '');
    if (!deviceId) return;
    const payload = JSON.parse(msg.toString('utf8'));
    insertTelemetry(deviceId, payload);
  } catch (e) {
    console.error('MQTT message parse error', e.message);
  }
});
mqttClient.on('error', (e) => console.error('MQTT error', e.message));
mqttClient.on('reconnect', () => console.log('MQTT reconnecting...'));
mqttClient.on('close', () => console.log('MQTT connection closed'));

// --- Routes ---
app.post('/api/agentos/devices/:id/goal', async (req, res) => {
  try {
    const deviceId = sanitizeId(req.params.id);
    const goal = String(req.body?.goal || '').trim();
    if (!deviceId || !goal) return res.status(400).json({ error: 'deviceId and goal are required' });
    if (!verifyHmac(req, deviceId)) return res.status(401).json({ error: 'invalid signature' });
    if (!checkRateLimit(deviceId)) return res.status(429).json({ error: 'rate limit exceeded' });

    const entry = {
      id: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
      deviceId,
      goal,
      plan: typeof req.body?.plan === 'string' ? req.body.plan.slice(0, 4000) : null,
      safety:
        req.body?.safety && typeof req.body.safety === 'object' && !Array.isArray(req.body.safety)
          ? req.body.safety
          : {},
      status: 'queued',
      at: Date.now()
    };

    await insertGoal(entry);
    publishGoalToMqtt(deviceId, entry);
    res.json({ success: true, deviceId, goal: entry });
  } catch (error) {
    console.error('AgentOS goal error:', error);
    res.status(500).json({ error: error.message || 'AgentOS goal error' });
  }
});

app.post('/api/agentos/devices/:id/telemetry', async (req, res) => {
  try {
    const deviceId = sanitizeId(req.params.id);
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    if (!verifyHmac(req, deviceId)) return res.status(401).json({ error: 'invalid signature' });
    const payload =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : { note: 'noop' };
    await insertTelemetry(deviceId, payload);
    res.json({ success: true });
  } catch (error) {
    console.error('AgentOS telemetry error:', error);
    res.status(500).json({ error: error.message || 'AgentOS telemetry error' });
  }
});

app.get('/api/agentos/devices/:id/telemetry', async (req, res) => {
  try {
    const deviceId = sanitizeId(req.params.id);
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
    const data = await fetchDeviceDetail(deviceId);
    res.json({ deviceId, updatedAt: Date.now(), ...data });
  } catch (error) {
    console.error('AgentOS telemetry fetch error:', error);
    res.status(500).json({ error: error.message || 'AgentOS telemetry fetch error' });
  }
});

app.get('/api/agentos/devices', async (_req, res) => {
  try {
    const summary = await fetchDeviceSummary();
    res.json({ devices: summary });
  } catch (error) {
    console.error('AgentOS devices error:', error);
    res.status(500).json({ error: error.message || 'AgentOS devices error' });
  }
});

app.get('/healthz', (_req, res) => {
  const mqttOk = mqttClient && mqttClient.connected;
  const dbOk = !!db;
  res.json({ ok: mqttOk && dbOk, mqtt: mqttOk, db: dbOk, time: Date.now() });
});

// --- Helpers ---
function publishGoalToMqtt(deviceId, entry) {
  if (!mqttClient || mqttClient.disconnected) return;
  const topic = MQTT_GOAL_TOPIC.replace('{deviceId}', deviceId);
  mqttClient.publish(
    topic,
    JSON.stringify({
      traceId: entry.traceId,
      goal: entry.goal,
      plan: entry.plan,
      safety: entry.safety,
      at: entry.at
    }),
    { qos: 1 }
  );
}

// Start server
app.listen(PORT, () => {
  console.log(`AGENTOS bridge listening on http://localhost:${PORT}`);
});
