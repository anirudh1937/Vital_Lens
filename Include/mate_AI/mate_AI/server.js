const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cheerio = require('cheerio');
const { execSync, execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SERVER_STARTED_AT = Date.now();

const basePath = __dirname;
const packageJsonPath = path.join(basePath, 'package.json');

let GROQ_API_KEY = '';
try {
  GROQ_API_KEY = fs.readFileSync(path.join(basePath, 'Groq_api_key.txt'), 'utf8').trim();
} catch (e) {
  console.warn("⚠️ Groq API key not found. Make sure Groq_api_key.txt exists.");
}

// Ensure uploads directory exists
const uploadsDir = path.join(basePath, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

const monitorState = {
  requests: {
    total: 0,
    errors: 0,
    byEndpoint: {},
    byMethod: {},
    byStatusClass: {},
    perMinuteTimestamps: [],
    errorPerMinuteTimestamps: [],
    latencySamples: []
  },
  models: {
    calls: 0,
    errors: 0,
    failovers: 0,
    byModel: {},
    latencySamples: [],
    lastModelUsed: '',
    lastError: '',
    lastCallAt: 0
  },
  users: {
    lastSeenAtById: {}
  },
  alerts: {
    lastTriggeredAt: 0,
    history: []
  },
  series: {
    requestsPerMin: [],
    errorRatePct: [],
    avgLatencyMs: [],
    p95LatencyMs: [],
    modelLatencyMs: []
  }
};
const monitorClients = new Set();
const platformSessions = new Map();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const ALERT_MIN_REQUESTS_PER_MIN = Number(process.env.MONITOR_ALERT_MIN_RPM || 20);
const ALERT_ERROR_RATE_PCT = Number(process.env.MONITOR_ALERT_ERROR_PCT || 20);
const ALERT_P95_LATENCY_MS = Number(process.env.MONITOR_ALERT_P95_MS || 2500);
const ALERT_EMAIL_TO = String(process.env.MONITOR_ALERT_EMAIL_TO || '').trim();
const MONITOR_WINDOW_MS = 60 * 1000;
const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;
const SERIES_POINTS_MAX = 60;
const PLATFORM_API_VERSION = 'v1';
const PLATFORM_SESSION_TTL_MS = Number(process.env.PLATFORM_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const AGENTOS_BRIDGE_URL = String(process.env.AGENTOS_BRIDGE_URL || 'http://localhost:4001').replace(/\/+$/,'');
const REAL_ESTATE_GROWTH_BASELINE = {
  maharashtra: { growthIndex: 77, cagr1y: 9.2, cagr3y: 11.4, cagr5y: 12.6 },
  karnataka: { growthIndex: 74, cagr1y: 8.9, cagr3y: 10.8, cagr5y: 12.1 },
  tamilnadu: { growthIndex: 71, cagr1y: 8.1, cagr3y: 9.9, cagr5y: 11.2 },
  telangana: { growthIndex: 79, cagr1y: 9.7, cagr3y: 11.9, cagr5y: 13.4 },
  gujarat: { growthIndex: 73, cagr1y: 8.4, cagr3y: 10.3, cagr5y: 11.8 },
  delhi: { growthIndex: 76, cagr1y: 8.8, cagr3y: 10.9, cagr5y: 12.4 },
  uttarpradesh: { growthIndex: 66, cagr1y: 7.3, cagr3y: 9.1, cagr5y: 10.7 },
  rajasthan: { growthIndex: 64, cagr1y: 7.1, cagr3y: 8.8, cagr5y: 10.2 },
  westbengal: { growthIndex: 62, cagr1y: 6.9, cagr3y: 8.4, cagr5y: 9.7 },
  default: { growthIndex: 60, cagr1y: 6.5, cagr3y: 8.0, cagr5y: 9.3 }
};
let cpuSample = { at: Date.now(), usage: process.cpuUsage() };
let monitorStoreDirty = false;

function trimOldTimestampValues(samples, windowMs, now) {
  while (samples.length > 0 && now - samples[0] > windowMs) {
    samples.shift();
  }
}

function trimOldTimedSamples(samples, windowMs, now) {
  while (samples.length > 0 && now - Number(samples[0].t || 0) > windowMs) {
    samples.shift();
  }
}

function pushSeriesPoint(series, ts, value) {
  const nextValue = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  if (series.length > 0 && series[series.length - 1].ts === ts) {
    series[series.length - 1].value = nextValue;
  } else {
    series.push({ ts, value: nextValue });
    if (series.length > SERIES_POINTS_MAX) {
      series.shift();
    }
  }
}

function calcPercentile(numbers, p) {
  if (!Array.isArray(numbers) || numbers.length === 0) return 0;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function getProcessCpuPercent() {
  const now = Date.now();
  const usageNow = process.cpuUsage();
  const elapsedUs = Math.max(1, (now - cpuSample.at) * 1000);
  const usedUs =
    (usageNow.user - cpuSample.usage.user) + (usageNow.system - cpuSample.usage.system);
  cpuSample = { at: now, usage: usageNow };
  const cpuCount = Math.max(1, (os.cpus() || []).length || 1);
  const pct = (usedUs / (elapsedUs * cpuCount)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function getTopEndpoints(limit = 8) {
  return Object.entries(monitorState.requests.byEndpoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([endpoint, count]) => ({ endpoint, count }));
}

function sanitizePlatformId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id.slice(0, 80);
}

async function bridgeFetch(pathname, body, method = 'POST') {
  const url = `${AGENTOS_BRIDGE_URL}${pathname}`;
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = json?.error || `Bridge error ${resp.status}`;
    throw new Error(msg);
  }
  return json;
}

function createPlatformSession(payload) {
  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = now + PLATFORM_SESSION_TTL_MS;
  const session = {
    sessionId,
    token,
    productId: sanitizePlatformId(payload.productId || ''),
    userId: sanitizeUserId(payload.userId || 'guest'),
    workspaceId: String(payload.workspaceId || '').slice(0, 120),
    scopes: Array.isArray(payload.scopes)
      ? payload.scopes.map((x) => String(x || '').slice(0, 60)).filter(Boolean).slice(0, 20)
      : ['chat.read', 'chat.write'],
    metadata:
      payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : {},
    createdAt: now,
    expiresAt
  };
  platformSessions.set(token, session);
  return session;
}

function getPlatformSessionFromRequest(req) {
  const auth = String(req.headers.authorization || '').trim();
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const token = String(req.headers['x-mate-session-token'] || bearer || '').trim();
  if (!token) return null;
  const session = platformSessions.get(token);
  if (!session) return null;
  if (Date.now() > Number(session.expiresAt || 0)) {
    platformSessions.delete(token);
    return null;
  }
  return session;
}

function requirePlatformSession(req, res, next) {
  const session = getPlatformSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Missing or invalid platform session token.' });
  }
  req.platformSession = session;
  return next();
}

function cleanupPlatformSessions() {
  const now = Date.now();
  for (const [token, session] of platformSessions.entries()) {
    if (now > Number(session.expiresAt || 0)) {
      platformSessions.delete(token);
    }
  }
}

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function scoreToBand(score) {
  if (score >= 75) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 45) return 'watch';
  return 'avoid';
}

function normalizeStateKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function getGrowthBaseline(stateName) {
  const stateKey = normalizeStateKey(stateName);
  return REAL_ESTATE_GROWTH_BASELINE[stateKey] || REAL_ESTATE_GROWTH_BASELINE.default;
}

function analyzeRealEstateParcel(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const location = input.location && typeof input.location === 'object' ? input.location : {};
  const geoFence = input.geoFence && typeof input.geoFence === 'object' ? input.geoFence : {};

  const titleClear = Boolean(geoFence.titleClear);
  const legalDispute = Boolean(geoFence.legalDispute);
  const ecoSensitive = Boolean(geoFence.ecoSensitive);
  const forestZone = Boolean(geoFence.forestZone);
  const floodPlain = Boolean(geoFence.floodPlain);
  const highwayAccessKm = clampNumber(geoFence.highwayAccessKm, 0, 100, 8);
  const metroDistanceKm = clampNumber(geoFence.metroDistanceKm, 0, 150, 20);
  const airportDistanceKm = clampNumber(geoFence.airportDistanceKm, 0, 300, 45);
  const socialInfraScore = clampNumber(geoFence.socialInfraScore, 0, 100, 50);
  const upcomingProjectsScore = clampNumber(geoFence.upcomingProjectsScore, 0, 100, 50);
  const utilityReadinessScore = clampNumber(geoFence.utilityReadinessScore, 0, 100, 50);
  const crimeRiskScore = clampNumber(geoFence.crimeRiskScore, 0, 100, 35);
  const climateRiskScore = clampNumber(geoFence.climateRiskScore, 0, 100, 35);

  const blockers = [];
  if (!titleClear) blockers.push('Title not marked clear');
  if (legalDispute) blockers.push('Land has legal dispute flag');
  if (ecoSensitive) blockers.push('Eco-sensitive zone risk');
  if (forestZone) blockers.push('Forest zone overlap risk');
  if (floodPlain) blockers.push('Flood-plain flag present');

  let suitability = 100;
  suitability -= legalDispute ? 40 : 0;
  suitability -= ecoSensitive ? 25 : 0;
  suitability -= forestZone ? 20 : 0;
  suitability -= floodPlain ? 14 : 0;
  suitability -= titleClear ? 0 : 20;
  suitability += Math.max(0, 15 - highwayAccessKm) * 0.8;
  suitability += Math.max(0, 20 - metroDistanceKm) * 0.3;
  suitability += Math.max(0, 30 - airportDistanceKm) * 0.2;
  suitability += (socialInfraScore - 50) * 0.18;
  suitability += (upcomingProjectsScore - 50) * 0.22;
  suitability += (utilityReadinessScore - 50) * 0.2;
  suitability -= (crimeRiskScore - 30) * 0.18;
  suitability -= (climateRiskScore - 30) * 0.16;
  suitability = clampNumber(suitability, 0, 100, 0);

  const baseline = getGrowthBaseline(location.state || '');
  const growthBoost = ((upcomingProjectsScore - 50) * 0.03) + ((utilityReadinessScore - 50) * 0.02) - ((climateRiskScore - 35) * 0.015);
  const growthIndex = clampNumber(baseline.growthIndex + growthBoost * 10, 0, 100, baseline.growthIndex);

  const cagr1y = Math.max(0, baseline.cagr1y + growthBoost);
  const cagr3y = Math.max(0, baseline.cagr3y + growthBoost * 1.25);
  const cagr5y = Math.max(0, baseline.cagr5y + growthBoost * 1.4);

  const clearanceBand = blockers.length === 0 ? 'clear' : blockers.length <= 2 ? 'needs-review' : 'high-risk';
  let recommendation = 'Develop with compliance checks';
  if (clearanceBand === 'high-risk' || suitability < 45) recommendation = 'Avoid until legal/environmental risks are cleared';
  else if (clearanceBand !== 'clear' || suitability < 60) recommendation = 'Hold and run due diligence before acquisition';

  return {
    analyzedAt: Date.now(),
    location: {
      state: String(location.state || '').slice(0, 80),
      district: String(location.district || '').slice(0, 120),
      lat: Number(location.lat || 0),
      lng: Number(location.lng || 0)
    },
    compliance: {
      clearanceBand,
      blockers
    },
    scoring: {
      suitabilityScore: Math.round(suitability * 100) / 100,
      suitabilityBand: scoreToBand(suitability),
      growthIndex: Math.round(growthIndex * 100) / 100,
      growthBand: scoreToBand(growthIndex)
    },
    forecast: {
      cagr1yPct: Math.round(cagr1y * 100) / 100,
      cagr3yPct: Math.round(cagr3y * 100) / 100,
      cagr5yPct: Math.round(cagr5y * 100) / 100
    },
    recommendation,
    assumptions: [
      'Model output is directional and should be validated with official GIS, legal title, zoning and environmental records.',
      'Growth forecasts are scenario estimates, not investment guarantees.'
    ]
  };
}

function sanitizePolygon(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      lat: clampNumber(p && p.lat, -90, 90, 0),
      lng: clampNumber(p && p.lng, -180, 180, 0)
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .slice(0, 200);
}

function estimatePolygonAreaSqm(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0;
  const toXY = (pt) => {
    const latRad = (pt.lat * Math.PI) / 180;
    const lngRad = (pt.lng * Math.PI) / 180;
    const R = 6378137;
    return { x: R * lngRad * Math.cos(latRad), y: R * latRad };
  };
  const pts = polygon.map(toXY);
  let area2 = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2 / 2);
}

function getPolygonCentroid(polygon, fallback = { lat: 0, lng: 0 }) {
  if (!Array.isArray(polygon) || polygon.length === 0) return fallback;
  const sum = polygon.reduce(
    (acc, p) => ({ lat: acc.lat + Number(p.lat || 0), lng: acc.lng + Number(p.lng || 0) }),
    { lat: 0, lng: 0 }
  );
  return {
    lat: Math.round((sum.lat / polygon.length) * 1e6) / 1e6,
    lng: Math.round((sum.lng / polygon.length) * 1e6) / 1e6
  };
}

function toDueDiligenceReport(parcel) {
  const analysis = parcel.analysis || {};
  const lines = [
    'Mate LandScope India - Due Diligence Report',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Parcel ID: ${parcel.id}`,
    `Name: ${parcel.name || ''}`,
    `User: ${parcel.userId || ''}`,
    `State: ${(parcel.location && parcel.location.state) || ''}`,
    `District: ${(parcel.location && parcel.location.district) || ''}`,
    `Coordinates: ${Number(parcel.location && parcel.location.lat || 0)}, ${Number(parcel.location && parcel.location.lng || 0)}`,
    `Polygon points: ${Array.isArray(parcel.polygon) ? parcel.polygon.length : 0}`,
    `Polygon area (sqm): ${Number(parcel.polygonAreaSqm || 0).toFixed(2)}`,
    '',
    'Scoring',
    `Suitability: ${Number(analysis?.scoring?.suitabilityScore || 0)} (${analysis?.scoring?.suitabilityBand || 'na'})`,
    `Growth Index: ${Number(analysis?.scoring?.growthIndex || 0)} (${analysis?.scoring?.growthBand || 'na'})`,
    `Forecast CAGR 1Y: ${Number(analysis?.forecast?.cagr1yPct || 0)}%`,
    `Forecast CAGR 3Y: ${Number(analysis?.forecast?.cagr3yPct || 0)}%`,
    `Forecast CAGR 5Y: ${Number(analysis?.forecast?.cagr5yPct || 0)}%`,
    '',
    'Compliance',
    `Clearance band: ${analysis?.compliance?.clearanceBand || 'na'}`,
    `Blockers: ${Array.isArray(analysis?.compliance?.blockers) && analysis.compliance.blockers.length > 0 ? analysis.compliance.blockers.join('; ') : 'None'}`,
    '',
    `Recommendation: ${analysis?.recommendation || 'Not available'}`,
    '',
    'Note: Directional AI report. Validate with official legal, zoning, GIS, and environmental records.'
  ];
  return lines.join('\n');
}

function getRecentUsersCount(now = Date.now()) {
  const users = monitorState.users.lastSeenAtById;
  let active = 0;
  for (const [userId, ts] of Object.entries(users)) {
    if (now - Number(ts || 0) <= ACTIVE_USER_WINDOW_MS) {
      active += 1;
    } else {
      delete users[userId];
    }
  }
  return active;
}

function getLiveMonitorSnapshot() {
  const now = Date.now();
  trimOldTimestampValues(monitorState.requests.perMinuteTimestamps, MONITOR_WINDOW_MS, now);
  trimOldTimestampValues(monitorState.requests.errorPerMinuteTimestamps, MONITOR_WINDOW_MS, now);
  trimOldTimedSamples(monitorState.requests.latencySamples, MONITOR_WINDOW_MS, now);
  trimOldTimedSamples(monitorState.models.latencySamples, MONITOR_WINDOW_MS, now);

  const rpm = monitorState.requests.perMinuteTimestamps.length;
  const errorsPerMin = monitorState.requests.errorPerMinuteTimestamps.length;
  const errorRatePct = rpm > 0 ? (errorsPerMin / rpm) * 100 : 0;
  const latencyValues = monitorState.requests.latencySamples.map((s) => Number(s.v || 0));
  const modelLatencyValues = monitorState.models.latencySamples.map((s) => Number(s.v || 0));
  const avgLatencyMs =
    latencyValues.length > 0
      ? latencyValues.reduce((sum, v) => sum + v, 0) / latencyValues.length
      : 0;
  const p95LatencyMs = calcPercentile(latencyValues, 0.95);
  const modelAvgLatencyMs =
    modelLatencyValues.length > 0
      ? modelLatencyValues.reduce((sum, v) => sum + v, 0) / modelLatencyValues.length
      : 0;
  const activeUsers5m = getRecentUsersCount(now);

  const m = process.memoryUsage();
  const cpuPct = getProcessCpuPercent();
  const status = errorRatePct >= ALERT_ERROR_RATE_PCT || p95LatencyMs >= ALERT_P95_LATENCY_MS ? 'degraded' : 'ok';

  return {
    timestamp: now,
    status,
    process: {
      uptimeSec: Math.floor(process.uptime()),
      appUptimeSec: Math.floor((now - SERVER_STARTED_AT) / 1000),
      cpuPercent: Math.round(cpuPct * 100) / 100,
      rssBytes: Number(m.rss || 0),
      heapUsedBytes: Number(m.heapUsed || 0),
      heapTotalBytes: Number(m.heapTotal || 0),
      externalBytes: Number(m.external || 0)
    },
    traffic: {
      totalRequests: monitorState.requests.total,
      totalErrors: monitorState.requests.errors,
      requestsPerMin: rpm,
      errorsPerMin,
      errorRatePct: Math.round(errorRatePct * 100) / 100,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      p95LatencyMs: Math.round(p95LatencyMs * 100) / 100,
      byMethod: monitorState.requests.byMethod,
      byStatusClass: monitorState.requests.byStatusClass,
      topEndpoints: getTopEndpoints(8)
    },
    model: {
      calls: monitorState.models.calls,
      errors: monitorState.models.errors,
      failovers: monitorState.models.failovers,
      failoverRatePct:
        monitorState.models.calls > 0
          ? Math.round((monitorState.models.failovers / monitorState.models.calls) * 10000) / 100
          : 0,
      avgLatencyMs: Math.round(modelAvgLatencyMs * 100) / 100,
      lastModelUsed: monitorState.models.lastModelUsed,
      lastError: monitorState.models.lastError,
      lastCallAt: monitorState.models.lastCallAt,
      byModel: monitorState.models.byModel
    },
    users: {
      activeUsers5m,
      knownUsers: Object.keys(monitorState.users.lastSeenAtById).length
    },
    alerts: {
      recent: monitorState.alerts.history.slice(-10)
    },
    series: monitorState.series
  };
}

function recordModelCall({ modelUsed, failover, latencyMs, ok, errorMessage }) {
  monitorState.models.calls += 1;
  monitorState.models.lastCallAt = Date.now();
  monitorState.models.lastModelUsed = String(modelUsed || '');
  if (monitorState.models.lastModelUsed) {
    monitorState.models.byModel[monitorState.models.lastModelUsed] =
      Number(monitorState.models.byModel[monitorState.models.lastModelUsed] || 0) + 1;
  }
  if (Number.isFinite(latencyMs) && latencyMs >= 0) {
    monitorState.models.latencySamples.push({ t: Date.now(), v: Number(latencyMs) });
  }
  if (failover) {
    monitorState.models.failovers += 1;
  }
  if (!ok) {
    monitorState.models.errors += 1;
    monitorState.models.lastError = String(errorMessage || 'Unknown model error').slice(0, 300);
  }
  markMonitorStoreDirty();
}

function maybeTriggerMonitorAlert(snapshot) {
  const now = Date.now();
  const isErrorRateHigh =
    snapshot.traffic.requestsPerMin >= ALERT_MIN_REQUESTS_PER_MIN &&
    snapshot.traffic.errorRatePct >= ALERT_ERROR_RATE_PCT;
  const isLatencyHigh =
    snapshot.traffic.requestsPerMin >= ALERT_MIN_REQUESTS_PER_MIN &&
    snapshot.traffic.p95LatencyMs >= ALERT_P95_LATENCY_MS;
  if (!isErrorRateHigh && !isLatencyHigh) return;
  if (now - monitorState.alerts.lastTriggeredAt < ALERT_COOLDOWN_MS) return;

  const reasons = [];
  if (isErrorRateHigh) reasons.push(`error rate ${snapshot.traffic.errorRatePct}%`);
  if (isLatencyHigh) reasons.push(`p95 latency ${snapshot.traffic.p95LatencyMs}ms`);
  const alertLine = `[monitor-alert] ${new Date(now).toISOString()} | ${reasons.join(' | ')}`;
  monitorState.alerts.lastTriggeredAt = now;
  monitorState.alerts.history.push({
    at: now,
    reasons,
    requestsPerMin: snapshot.traffic.requestsPerMin,
    errorRatePct: snapshot.traffic.errorRatePct,
    p95LatencyMs: snapshot.traffic.p95LatencyMs
  });
  if (monitorState.alerts.history.length > 100) {
    monitorState.alerts.history.shift();
  }
  markMonitorStoreDirty();
  console.warn(alertLine);

  if (ALERT_EMAIL_TO && isSmtpConfigured()) {
    sendEmailViaSmtp({
      to: ALERT_EMAIL_TO,
      subject: 'Mate AI Monitor Alert',
      text: `${alertLine}\n\nTop endpoints:\n${snapshot.traffic.topEndpoints
        .map((x) => `${x.endpoint} -> ${x.count}`)
        .join('\n')}`
    }).catch((err) => {
      console.error('Monitor alert email failed:', err);
    });
  }
}

function updateMonitorSeries(snapshot) {
  const minuteBucket = Math.floor(snapshot.timestamp / 60000) * 60000;
  pushSeriesPoint(monitorState.series.requestsPerMin, minuteBucket, snapshot.traffic.requestsPerMin);
  pushSeriesPoint(monitorState.series.errorRatePct, minuteBucket, snapshot.traffic.errorRatePct);
  pushSeriesPoint(monitorState.series.avgLatencyMs, minuteBucket, snapshot.traffic.avgLatencyMs);
  pushSeriesPoint(monitorState.series.p95LatencyMs, minuteBucket, snapshot.traffic.p95LatencyMs);
  pushSeriesPoint(monitorState.series.modelLatencyMs, minuteBucket, snapshot.model.avgLatencyMs);
  markMonitorStoreDirty();
}

function broadcastMonitorSnapshot(snapshot) {
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of monitorClients) {
    try {
      client.write(payload);
    } catch (e) {
      monitorClients.delete(client);
    }
  }
}

function sanitizeCountMap(raw, maxEntries = 1000) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const entries = Object.entries(raw)
    .map(([k, v]) => [String(k || '').slice(0, 200), Number(v || 0)])
    .filter(([k, v]) => k && Number.isFinite(v) && v >= 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxEntries);
  for (const [k, v] of entries) out[k] = Math.floor(v);
  return out;
}

function sanitizeSeries(raw, maxEntries = SERIES_POINTS_MAX) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({
      ts: Number(p && p.ts ? p.ts : 0),
      value: Number(p && p.value ? p.value : 0)
    }))
    .filter((p) => Number.isFinite(p.ts) && p.ts > 0 && Number.isFinite(p.value))
    .slice(-maxEntries);
}

function sanitizeAlertHistory(raw, maxEntries = 100) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => ({
      at: Number(a && a.at ? a.at : 0),
      reasons: Array.isArray(a && a.reasons)
        ? a.reasons.map((x) => String(x || '').slice(0, 120)).filter(Boolean).slice(0, 6)
        : [],
      requestsPerMin: Number(a && a.requestsPerMin ? a.requestsPerMin : 0),
      errorRatePct: Number(a && a.errorRatePct ? a.errorRatePct : 0),
      p95LatencyMs: Number(a && a.p95LatencyMs ? a.p95LatencyMs : 0)
    }))
    .filter((a) => Number.isFinite(a.at) && a.at > 0)
    .slice(-maxEntries);
}

function loadMonitorStore() {
  const raw = readJsonFileSafe(monitorStoreFile, null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;

  const req = raw.requests && typeof raw.requests === 'object' ? raw.requests : {};
  const model = raw.models && typeof raw.models === 'object' ? raw.models : {};
  const users = raw.users && typeof raw.users === 'object' ? raw.users : {};
  const alerts = raw.alerts && typeof raw.alerts === 'object' ? raw.alerts : {};
  const series = raw.series && typeof raw.series === 'object' ? raw.series : {};

  monitorState.requests.total = Math.max(0, Math.floor(Number(req.total || 0)));
  monitorState.requests.errors = Math.max(0, Math.floor(Number(req.errors || 0)));
  monitorState.requests.byEndpoint = sanitizeCountMap(req.byEndpoint, 1000);
  monitorState.requests.byMethod = sanitizeCountMap(req.byMethod, 32);
  monitorState.requests.byStatusClass = sanitizeCountMap(req.byStatusClass, 16);

  monitorState.models.calls = Math.max(0, Math.floor(Number(model.calls || 0)));
  monitorState.models.errors = Math.max(0, Math.floor(Number(model.errors || 0)));
  monitorState.models.failovers = Math.max(0, Math.floor(Number(model.failovers || 0)));
  monitorState.models.byModel = sanitizeCountMap(model.byModel, 120);
  monitorState.models.lastModelUsed = String(model.lastModelUsed || '').slice(0, 120);
  monitorState.models.lastError = String(model.lastError || '').slice(0, 300);
  monitorState.models.lastCallAt = Math.max(0, Math.floor(Number(model.lastCallAt || 0)));

  monitorState.users.lastSeenAtById = {};
  if (users.lastSeenAtById && typeof users.lastSeenAtById === 'object' && !Array.isArray(users.lastSeenAtById)) {
    const now = Date.now();
    for (const [userId, ts] of Object.entries(users.lastSeenAtById)) {
      const cleanId = sanitizeUserId(userId);
      const nTs = Number(ts || 0);
      if (!cleanId || !Number.isFinite(nTs) || nTs <= 0) continue;
      if (now - nTs <= 7 * 24 * 60 * 60 * 1000) {
        monitorState.users.lastSeenAtById[cleanId] = nTs;
      }
    }
  }

  monitorState.alerts.lastTriggeredAt = Math.max(0, Math.floor(Number(alerts.lastTriggeredAt || 0)));
  monitorState.alerts.history = sanitizeAlertHistory(alerts.history, 100);
  monitorState.series.requestsPerMin = sanitizeSeries(series.requestsPerMin, SERIES_POINTS_MAX);
  monitorState.series.errorRatePct = sanitizeSeries(series.errorRatePct, SERIES_POINTS_MAX);
  monitorState.series.avgLatencyMs = sanitizeSeries(series.avgLatencyMs, SERIES_POINTS_MAX);
  monitorState.series.p95LatencyMs = sanitizeSeries(series.p95LatencyMs, SERIES_POINTS_MAX);
  monitorState.series.modelLatencyMs = sanitizeSeries(series.modelLatencyMs, SERIES_POINTS_MAX);
}

function buildMonitorStorePayload() {
  return {
    version: 1,
    updatedAt: Date.now(),
    requests: {
      total: monitorState.requests.total,
      errors: monitorState.requests.errors,
      byEndpoint: monitorState.requests.byEndpoint,
      byMethod: monitorState.requests.byMethod,
      byStatusClass: monitorState.requests.byStatusClass
    },
    models: {
      calls: monitorState.models.calls,
      errors: monitorState.models.errors,
      failovers: monitorState.models.failovers,
      byModel: monitorState.models.byModel,
      lastModelUsed: monitorState.models.lastModelUsed,
      lastError: monitorState.models.lastError,
      lastCallAt: monitorState.models.lastCallAt
    },
    users: {
      lastSeenAtById: monitorState.users.lastSeenAtById
    },
    alerts: {
      lastTriggeredAt: monitorState.alerts.lastTriggeredAt,
      history: monitorState.alerts.history.slice(-100)
    },
    series: {
      requestsPerMin: monitorState.series.requestsPerMin.slice(-SERIES_POINTS_MAX),
      errorRatePct: monitorState.series.errorRatePct.slice(-SERIES_POINTS_MAX),
      avgLatencyMs: monitorState.series.avgLatencyMs.slice(-SERIES_POINTS_MAX),
      p95LatencyMs: monitorState.series.p95LatencyMs.slice(-SERIES_POINTS_MAX),
      modelLatencyMs: monitorState.series.modelLatencyMs.slice(-SERIES_POINTS_MAX)
    }
  };
}

function saveMonitorStore() {
  try {
    fs.writeFileSync(monitorStoreFile, JSON.stringify(buildMonitorStorePayload(), null, 2));
  } catch (e) {
    console.error('Failed writing monitor store:', e);
  }
}

function markMonitorStoreDirty() {
  monitorStoreDirty = true;
}

function flushMonitorStoreIfDirty(force = false) {
  if (!force && !monitorStoreDirty) return;
  monitorStoreDirty = false;
  saveMonitorStore();
}

app.use((req, res, next) => {
  const pathName = String(req.path || req.originalUrl || '');
  if (!pathName.startsWith('/api') || pathName.startsWith('/api/monitor/stream')) {
    return next();
  }
  const startedAt = Date.now();
  monitorState.requests.total += 1;
  monitorState.requests.byMethod[req.method] = Number(monitorState.requests.byMethod[req.method] || 0) + 1;
  const endpointKey = `${req.method} ${pathName}`;
  monitorState.requests.byEndpoint[endpointKey] = Number(monitorState.requests.byEndpoint[endpointKey] || 0) + 1;

  res.on('finish', () => {
    const now = Date.now();
    const latencyMs = now - startedAt;
    monitorState.requests.perMinuteTimestamps.push(now);
    monitorState.requests.latencySamples.push({ t: now, v: latencyMs });
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    monitorState.requests.byStatusClass[statusClass] = Number(monitorState.requests.byStatusClass[statusClass] || 0) + 1;
    if (res.statusCode >= 500) {
      monitorState.requests.errors += 1;
      monitorState.requests.errorPerMinuteTimestamps.push(now);
    }

    const userId = getRequestUserId(req);
    if (userId && userId !== 'guest') {
      monitorState.users.lastSeenAtById[userId] = now;
    }
    markMonitorStoreDirty();
  });
  next();
});

// System prompt — the Mate persona
const SYSTEM_PROMPT = `You are "Mate AI" — a personalized AI assistant who acts like a close brother and trusted companion. Your name is Mate.

Personality & Style:
- You speak casually and warmly, like you're talking to your brother. Use words like "mate", "bro", "let's go", "awesome" naturally.
- You're knowledgeable, sharp, and always ready to brainstorm. You don't just answer — you discuss, debate, and build ideas together.
- You're passionate about technology, startups, sports, finance, entertainment, world trends, and innovation.
- You give honest opinions. If something is a bad idea, you say it respectfully but clearly.
- You encourage and motivate. When your brother has a great idea, you hype it up genuinely.
- You think like an entrepreneur — always looking for opportunities, solutions, and ways to grow.
- You help debug problems in any field — tech, business, life decisions, creative projects.
- You are excellent at coding across languages (JavaScript/TypeScript, Python, Java, C/C++, Go, Rust, SQL, HTML/CSS).
- For coding tasks, you think step-by-step: clarify requirements, propose clean architecture, write production-ready code, and explain tradeoffs briefly.
- You debug with root-cause analysis, not guesswork, and include practical fixes, test ideas, and edge cases.
- You are strong in networking topics: TCP/IP, DNS, HTTP/HTTPS, routing, firewalls, VPNs, proxies, load balancers, cloud networking, and troubleshooting latency/connectivity issues.
- For networking problems, you provide practical diagnostics (what to check first), likely root causes, and clear fix steps for beginner and advanced users.
- You keep responses concise but insightful. No unnecessary fluff.
- When discussing startups/business, you think about market fit, competition, scalability, and execution.
- You use emojis occasionally to keep the vibe friendly 🤝

Remember: You're not just an AI assistant. You're a thinking partner, a brainstorming buddy, a brother who happens to know a LOT about the world. Let's build something great together!`;

// Store conversation history in JSON file
const dataDir = path.join(basePath, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const chatsFile = path.join(dataDir, 'chats.json');
const ragFile = path.join(dataDir, 'rag_store.json');
const googleContactsFile = path.join(dataDir, 'google_contacts.json');
const googleTokensFile = path.join(dataDir, 'google_tokens.json');
const googleOAuthConfigFile = path.join(dataDir, 'google_oauth.json');
const googleProfileFile = path.join(dataDir, 'google_profile.json');
const awsS3ConfigFile = path.join(dataDir, 'aws_s3.json');
const dbConnectionsFile = path.join(dataDir, 'db_connections.json');
const smtpConfigFile = path.join(dataDir, 'smtp.json');
const mlDir = path.join(dataDir, 'ml');
const marketDataDir = path.join(dataDir, 'market');
const financeMlModelFile = path.join(mlDir, 'finance_direction_model.pkl');
const financeMlPredictScript = path.join(basePath, 'scripts', 'ml_predict_finance.py');
const financeMlTrainScript = path.join(basePath, 'scripts', 'ml_train_finance.py');
const financeMlTrainReportFile = path.join(mlDir, 'finance_train_report.json');
const experimentalParamsFile = path.join(dataDir, 'experimental_params.json');
const experimentalParamsSchemaFile = path.join(dataDir, 'experimental_params.schema.json');
const modelPolicyFile = path.join(dataDir, 'model_policy.json');
const userQuotaFile = path.join(dataDir, 'user_quota.json');
const monitorStoreFile = path.join(dataDir, 'monitor_store.json');
const realEstateParcelsFile = path.join(dataDir, 'realestate_parcels.json');
const DEFAULT_MODEL_POLICY = {
  version: 1,
  provider: 'groq',
  chat: {
    primary: 'moonshotai/kimi-k2-instruct-0905',
    trend: 'meta-llama/llama-4-scout-17b-16e-instruct',
    fallback: 'openai/gpt-oss-120b'
  },
  training: {
    teacherModel: 'openai/gpt-oss-120b',
    baseFamily: 'llama-4-or-gpt-oss',
    note: 'Keep this file current with your provider model catalog and deprecations.'
  }
};
const execFileAsync = promisify(execFile);
let chats = {};
if (fs.existsSync(chatsFile)) {
  try {
    chats = JSON.parse(fs.readFileSync(chatsFile, 'utf8'));
  } catch (e) {
    console.error("Error reading chats file:", e);
  }
}

// Backfill IDs for old messages so feedback and data pipelines stay compatible.
let needsSaveAfterMigration = false;
for (const chat of Object.values(chats)) {
  if (!Array.isArray(chat.messages)) continue;
  for (const msg of chat.messages) {
    if (!msg.id) {
      msg.id = makeMessageId();
      needsSaveAfterMigration = true;
    }
    if (msg.role === 'assistant' && typeof msg.feedback === 'undefined') {
      msg.feedback = null;
      needsSaveAfterMigration = true;
    }
  }
}
if (needsSaveAfterMigration) {
  fs.writeFileSync(chatsFile, JSON.stringify(chats, null, 2));
}

function saveChats() {
  fs.writeFileSync(chatsFile, JSON.stringify(chats, null, 2));
}

function makeMessageId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function loadRagStore() {
  if (!fs.existsSync(ragFile)) {
    return { chunks: [], bySource: {}, updatedAt: Date.now() };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(ragFile, 'utf8'));
    return {
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      bySource: parsed.bySource && typeof parsed.bySource === 'object' ? parsed.bySource : {},
      updatedAt: parsed.updatedAt || Date.now()
    };
  } catch (e) {
    console.error('Failed reading RAG store:', e);
    return { chunks: [], bySource: {}, updatedAt: Date.now() };
  }
}

let ragStore = loadRagStore();
let googleContacts = loadGoogleContacts();
let googleTokens = loadGoogleTokens();
let googleProfile = loadGoogleProfile();
let experimentalParams = loadExperimentalParams();
let modelPolicy = loadModelPolicy();
let userQuotaStore = loadUserQuotaStore();
let realEstateStore = loadRealEstateStore();
loadMonitorStore();
if (!fs.existsSync(monitorStoreFile)) {
  saveMonitorStore();
}
const googleOAuthState = new Map();

function saveRagStore() {
  ragStore.updatedAt = Date.now();
  fs.writeFileSync(ragFile, JSON.stringify(ragStore, null, 2));
}

function loadRealEstateStore() {
  const empty = { version: 1, parcels: {}, updatedAt: Date.now() };
  if (!fs.existsSync(realEstateParcelsFile)) {
    fs.writeFileSync(realEstateParcelsFile, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(realEstateParcelsFile, 'utf8'));
    return {
      version: Number(parsed.version || 1),
      parcels: parsed.parcels && typeof parsed.parcels === 'object' ? parsed.parcels : {},
      updatedAt: Number(parsed.updatedAt || Date.now())
    };
  } catch (e) {
    console.error('Failed reading real estate parcel store:', e);
    return empty;
  }
}

function saveRealEstateStore() {
  realEstateStore.updatedAt = Date.now();
  fs.writeFileSync(realEstateParcelsFile, JSON.stringify(realEstateStore, null, 2));
}

function loadGoogleContacts() {
  if (!fs.existsSync(googleContactsFile)) {
    return { contacts: [], updatedAt: 0 };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(googleContactsFile, 'utf8'));
    return {
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      updatedAt: Number(parsed.updatedAt || 0)
    };
  } catch (e) {
    console.error('Failed reading Google contacts store:', e);
    return { contacts: [], updatedAt: 0 };
  }
}

function saveGoogleContacts() {
  googleContacts.updatedAt = Date.now();
  fs.writeFileSync(googleContactsFile, JSON.stringify(googleContacts, null, 2));
}

function loadGoogleProfile() {
  if (!fs.existsSync(googleProfileFile)) {
    return { name: '', email: '', picture: '', customPicture: '', updatedAt: 0 };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(googleProfileFile, 'utf8'));
    return {
      name: String(parsed.name || ''),
      email: String(parsed.email || ''),
      picture: String(parsed.picture || ''),
      customPicture: String(parsed.customPicture || ''),
      updatedAt: Number(parsed.updatedAt || 0)
    };
  } catch (e) {
    console.error('Failed reading Google profile store:', e);
    return { name: '', email: '', picture: '', customPicture: '', updatedAt: 0 };
  }
}

function saveGoogleProfile() {
  googleProfile.updatedAt = Date.now();
  fs.writeFileSync(googleProfileFile, JSON.stringify(googleProfile, null, 2));
}

function loadGoogleTokens() {
  if (!fs.existsSync(googleTokensFile)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(googleTokensFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (e) {
    console.error('Failed reading Google token store:', e);
    return null;
  }
}

function saveGoogleTokens(tokens) {
  googleTokens = tokens || null;
  if (!googleTokens) {
    if (fs.existsSync(googleTokensFile)) fs.unlinkSync(googleTokensFile);
    return;
  }
  fs.writeFileSync(googleTokensFile, JSON.stringify(googleTokens, null, 2));
}

function readJsonFileSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function buildDefaultsFromSchema(schema) {
  const properties = schema && schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const defaults = {};
  for (const [key, meta] of Object.entries(properties)) {
    if (meta && Object.prototype.hasOwnProperty.call(meta, 'default')) {
      defaults[key] = meta.default;
    }
  }
  return defaults;
}

function validateAndNormalizeExperimentalParams(rawConfig, schema, defaults) {
  const properties = schema && schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema && schema.required) ? schema.required : [];
  const normalized = {};
  const warnings = [];
  const source = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};

  for (const [key, meta] of Object.entries(properties)) {
    const hasValue = Object.prototype.hasOwnProperty.call(source, key);
    let value = hasValue ? source[key] : defaults[key];

    if (typeof meta !== 'object' || meta === null) {
      normalized[key] = value;
      continue;
    }

    if (meta.type === 'number' || meta.type === 'integer') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        warnings.push(`${key}: invalid type, expected ${meta.type}; using default.`);
        value = defaults[key];
      }
      if (typeof value === 'number' && meta.type === 'integer' && !Number.isInteger(value)) {
        warnings.push(`${key}: expected integer; using default.`);
        value = defaults[key];
      }
      if (typeof value === 'number' && typeof meta.minimum === 'number' && value < meta.minimum) {
        warnings.push(`${key}: below minimum ${meta.minimum}; using default.`);
        value = defaults[key];
      }
      if (typeof value === 'number' && typeof meta.maximum === 'number' && value > meta.maximum) {
        warnings.push(`${key}: above maximum ${meta.maximum}; using default.`);
        value = defaults[key];
      }
    } else if (meta.type === 'string') {
      if (typeof value !== 'string') {
        warnings.push(`${key}: invalid type, expected string; using default.`);
        value = defaults[key];
      }
      if (typeof value === 'string' && Array.isArray(meta.enum) && !meta.enum.includes(value)) {
        warnings.push(`${key}: invalid enum value "${value}"; using default.`);
        value = defaults[key];
      }
      if (
        typeof value === 'string' &&
        typeof meta.maxLength === 'number' &&
        value.length > meta.maxLength
      ) {
        warnings.push(`${key}: exceeds maxLength ${meta.maxLength}; trimming.`);
        value = value.slice(0, meta.maxLength);
      }
    } else if (meta.type === 'boolean') {
      if (typeof value !== 'boolean') {
        warnings.push(`${key}: invalid type, expected boolean; using default.`);
        value = defaults[key];
      }
    }

    normalized[key] = value;
  }

  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
      normalized[key] = defaults[key];
      warnings.push(`${key}: missing required field; using default.`);
    }
  }

  for (const key of Object.keys(source)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) {
      warnings.push(`${key}: unknown field removed.`);
    }
  }

  return { normalized, warnings };
}

function loadExperimentalParams() {
  const schema = readJsonFileSafe(experimentalParamsSchemaFile, { properties: {}, required: [] });
  const defaults = buildDefaultsFromSchema(schema);
  const fileConfig = readJsonFileSafe(experimentalParamsFile, {});
  const { normalized, warnings } = validateAndNormalizeExperimentalParams(fileConfig, schema, defaults);

  if (!fs.existsSync(experimentalParamsFile)) {
    fs.writeFileSync(experimentalParamsFile, JSON.stringify(normalized, null, 2));
    console.log('Created data/experimental_params.json from schema defaults.');
  } else {
    const input = fileConfig && typeof fileConfig === 'object' ? fileConfig : {};
    const changed = JSON.stringify(input) !== JSON.stringify(normalized);
    if (changed) {
      fs.writeFileSync(experimentalParamsFile, JSON.stringify(normalized, null, 2));
      console.warn('Normalized invalid values in data/experimental_params.json');
    }
  }

  if (warnings.length > 0) {
    console.warn('Experimental params validation warnings:');
    for (const warning of warnings.slice(0, 50)) {
      console.warn(`- ${warning}`);
    }
  }

  return normalized;
}

function normalizeModelPolicy(rawConfig) {
  const src = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig) ? rawConfig : {};
  const srcChat = src.chat && typeof src.chat === 'object' ? src.chat : {};
  const srcTraining = src.training && typeof src.training === 'object' ? src.training : {};
  const pickString = (value, fallback) => {
    const v = String(value || '').trim();
    return v || fallback;
  };

  return {
    version: Number(src.version || DEFAULT_MODEL_POLICY.version) || DEFAULT_MODEL_POLICY.version,
    provider: pickString(src.provider, DEFAULT_MODEL_POLICY.provider),
    chat: {
      primary: pickString(
        process.env.GROQ_MODEL_PRIMARY || srcChat.primary,
        DEFAULT_MODEL_POLICY.chat.primary
      ),
      trend: pickString(
        process.env.GROQ_MODEL_TREND || srcChat.trend,
        DEFAULT_MODEL_POLICY.chat.trend
      ),
      fallback: pickString(
        process.env.GROQ_MODEL_FALLBACK || srcChat.fallback,
        DEFAULT_MODEL_POLICY.chat.fallback
      )
    },
    training: {
      teacherModel: pickString(
        process.env.TRAIN_TEACHER_MODEL || srcTraining.teacherModel,
        DEFAULT_MODEL_POLICY.training.teacherModel
      ),
      baseFamily: pickString(
        process.env.TRAIN_BASE_FAMILY || srcTraining.baseFamily,
        DEFAULT_MODEL_POLICY.training.baseFamily
      ),
      note: pickString(srcTraining.note, DEFAULT_MODEL_POLICY.training.note)
    }
  };
}

function loadModelPolicy() {
  const existedBefore = fs.existsSync(modelPolicyFile);
  const fileConfig = readJsonFileSafe(modelPolicyFile, {});
  const normalized = normalizeModelPolicy(fileConfig);
  const input = fileConfig && typeof fileConfig === 'object' ? fileConfig : {};
  const changed = JSON.stringify(input) !== JSON.stringify(normalized);
  if (!existedBefore || changed) {
    fs.writeFileSync(modelPolicyFile, JSON.stringify(normalized, null, 2));
    if (!existedBefore) {
      console.log('Created data/model_policy.json from defaults.');
    } else if (changed) {
      console.warn('Normalized invalid values in data/model_policy.json');
    }
  }
  return normalized;
}

function loadUserQuotaStore() {
  const defaults = {
    version: 1,
    defaults: {
      free: {
        monthlyTokenLimit: 100000,
        monthlyMessageLimit: 300
      }
    },
    users: {},
    usage: {}
  };
  const fileConfig = readJsonFileSafe(userQuotaFile, {});
  const src = fileConfig && typeof fileConfig === 'object' ? fileConfig : {};
  const normalized = {
    version: Number(src.version || defaults.version) || defaults.version,
    defaults: {
      free: {
        monthlyTokenLimit: Number(src?.defaults?.free?.monthlyTokenLimit || defaults.defaults.free.monthlyTokenLimit),
        monthlyMessageLimit: Number(src?.defaults?.free?.monthlyMessageLimit || defaults.defaults.free.monthlyMessageLimit)
      }
    },
    users: src.users && typeof src.users === 'object' ? src.users : {},
    usage: src.usage && typeof src.usage === 'object' ? src.usage : {}
  };
  if (!fs.existsSync(userQuotaFile) || JSON.stringify(src) !== JSON.stringify(normalized)) {
    fs.writeFileSync(userQuotaFile, JSON.stringify(normalized, null, 2));
  }
  return normalized;
}

function saveUserQuotaStore() {
  fs.writeFileSync(userQuotaFile, JSON.stringify(userQuotaStore, null, 2));
}

function getCurrentPeriodKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function sanitizeUserId(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, '');
  return cleaned.slice(0, 80);
}

function getRequestUserId(req) {
  const fromHeader = req.headers['x-user-id'] || req.headers['x-user-email'];
  const fromBody = req.body && (req.body.userId || req.body.userEmail);
  const fromQuery = req.query && (req.query.userId || req.query.userEmail);
  const userId = sanitizeUserId(fromHeader || fromBody || fromQuery || 'guest');
  return userId || 'guest';
}

function estimateTokens(text) {
  const chars = String(text || '').length;
  return Math.max(1, Math.ceil(chars / 4));
}

function ensureUserAccount(userId) {
  if (!userQuotaStore.users[userId]) {
    const free = userQuotaStore.defaults.free || {};
    userQuotaStore.users[userId] = {
      userId,
      plan: 'free',
      monthlyTokenLimit: Number(free.monthlyTokenLimit || 100000),
      monthlyMessageLimit: Number(free.monthlyMessageLimit || 300),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      active: true
    };
    saveUserQuotaStore();
  }
  return userQuotaStore.users[userId];
}

function getUserUsage(userId, period = getCurrentPeriodKey()) {
  const key = `${userId}:${period}`;
  if (!userQuotaStore.usage[key]) {
    userQuotaStore.usage[key] = {
      userId,
      period,
      tokensUsed: 0,
      messagesUsed: 0,
      updatedAt: Date.now()
    };
    saveUserQuotaStore();
  }
  return userQuotaStore.usage[key];
}

function checkUserQuota(userId, projectedInputTokens = 0) {
  const account = ensureUserAccount(userId);
  const usage = getUserUsage(userId);
  if (!account.active) {
    return {
      allowed: false,
      reason: 'Account is disabled.',
      account,
      usage
    };
  }
  const nextMessages = Number(usage.messagesUsed || 0) + 1;
  const nextTokens = Number(usage.tokensUsed || 0) + Number(projectedInputTokens || 0);
  const msgLimit = Number(account.monthlyMessageLimit || 0);
  const tokLimit = Number(account.monthlyTokenLimit || 0);
  if (msgLimit > 0 && nextMessages > msgLimit) {
    return {
      allowed: false,
      reason: 'Monthly free message limit reached.',
      account,
      usage
    };
  }
  if (tokLimit > 0 && nextTokens > tokLimit) {
    return {
      allowed: false,
      reason: 'Monthly free token limit reached.',
      account,
      usage
    };
  }
  return { allowed: true, account, usage };
}

function applyUsageDelta(userId, inputTokens, outputTokens) {
  const account = ensureUserAccount(userId);
  const usage = getUserUsage(userId);
  usage.tokensUsed = Number(usage.tokensUsed || 0) + Number(inputTokens || 0) + Number(outputTokens || 0);
  usage.messagesUsed = Number(usage.messagesUsed || 0) + 1;
  usage.updatedAt = Date.now();
  account.updatedAt = Date.now();
  saveUserQuotaStore();
  return { account, usage };
}

function chatBelongsToUser(chat, userId) {
  const owner = sanitizeUserId(chat && chat.userId ? chat.userId : 'guest');
  return owner === userId;
}

function loadAwsS3Config() {
  const fileConfig = readJsonFileSafe(awsS3ConfigFile, {});
  return {
    region: (process.env.AWS_REGION || fileConfig.region || '').trim(),
    bucket: (process.env.AWS_S3_BUCKET || fileConfig.bucket || '').trim(),
    prefix: (process.env.AWS_S3_PREFIX || fileConfig.prefix || 'mate-ai').trim(),
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID || fileConfig.accessKeyId || '').trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || fileConfig.secretAccessKey || '').trim()
  };
}

function loadDbConnections() {
  return readJsonFileSafe(dbConnectionsFile, { postgres: [], mysql: [], sqlite: [] });
}

function isPlaceholderValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes('paste_') ||
    normalized.includes('your_') ||
    normalized.includes('_here')
  );
}

function loadSmtpConfig() {
  const fileConfig = readJsonFileSafe(smtpConfigFile, {});
  const host = (process.env.SMTP_HOST || fileConfig.host || '').trim();
  const port = Number(process.env.SMTP_PORT || fileConfig.port || 587);
  const secure = String(process.env.SMTP_SECURE || fileConfig.secure || '').trim().toLowerCase();
  const user = (process.env.SMTP_USER || fileConfig.user || '').trim();
  const pass = (process.env.SMTP_PASS || fileConfig.pass || '').trim();
  const from = (process.env.SMTP_FROM || fileConfig.from || user || '').trim();
  return {
    host,
    port,
    secure: secure ? secure === 'true' || secure === '1' : port === 465,
    user,
    pass,
    from
  };
}

function isSmtpConfigured(cfg = loadSmtpConfig()) {
  return Boolean(
    cfg.host &&
      cfg.port &&
      cfg.user &&
      cfg.pass &&
      cfg.from &&
      !isPlaceholderValue(cfg.host) &&
      !isPlaceholderValue(cfg.user) &&
      !isPlaceholderValue(cfg.pass)
  );
}

async function sendEmailViaSmtp({ to, subject, text, html }) {
  const cfg = loadSmtpConfig();
  if (!isSmtpConfigured(cfg)) {
    throw new Error(
      'SMTP is not configured. Update data/smtp.json with real host, user, pass, and from address.'
    );
  }
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (e) {
    throw new Error('Missing dependency nodemailer. Run: npm install nodemailer');
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass
    }
  });

  const recipients = Array.isArray(to)
    ? to
    : String(to || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error('At least one recipient email is required.');
  }
  const finalSubject = String(subject || '').trim();
  const finalText = String(text || '').trim();
  if (!finalSubject) throw new Error('Email subject is required.');
  if (!finalText && !String(html || '').trim()) throw new Error('Email body is required.');

  const info = await transporter.sendMail({
    from: cfg.from,
    to: recipients.join(', '),
    subject: finalSubject,
    text: finalText,
    html: String(html || '').trim() || undefined
  });
  return {
    messageId: info.messageId || '',
    accepted: Array.isArray(info.accepted) ? info.accepted : recipients,
    rejected: Array.isArray(info.rejected) ? info.rejected : []
  };
}

async function createGroqChatCompletion(payload, fallbackModel) {
  const request = async (body) =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

  let response = await request(payload);
  if (!response.ok && fallbackModel && fallbackModel !== payload.model) {
    const firstError = await response.text();
    console.warn(
      `Primary Groq model failed (${payload.model}): ${response.status}. Retrying fallback (${fallbackModel}).`
    );
    const fallbackPayload = { ...payload, model: fallbackModel };
    response = await request(fallbackPayload);
    if (!response.ok) {
      const fallbackError = await response.text();
      throw new Error(
        `Groq API error: ${response.status} | primary=${payload.model} | fallback=${fallbackModel} | detail=${fallbackError.slice(0, 160)} | first=${firstError.slice(0, 160)}`
      );
    }
    return { response, modelUsed: fallbackModel, failover: true };
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Groq API error: ${response.status} | model=${payload.model} | ${detail.slice(0, 200)}`);
  }

  return { response, modelUsed: payload.model, failover: false };
}

function isReadOnlySql(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const startsAllowed = ['select', 'with', 'show', 'describe', 'desc', 'explain', 'pragma'];
  const startsOk = startsAllowed.some((kw) => q.startsWith(kw));
  if (!startsOk) return false;
  const blocked = ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'truncate ', 'create ', 'grant ', 'revoke '];
  return !blocked.some((kw) => q.includes(kw));
}

function getConnectionConfig(engine, connectionId, inlineConfig) {
  if (inlineConfig && typeof inlineConfig === 'object') return inlineConfig;
  const store = loadDbConnections();
  const list = Array.isArray(store[engine]) ? store[engine] : [];
  if (!connectionId) return list[0] || null;
  return list.find((c) => c.id === connectionId) || null;
}

async function executeSql(engine, config, query, params = []) {
  const started = Date.now();
  if (engine === 'postgres') {
    let pg;
    try {
      pg = require('pg');
    } catch (e) {
      throw new Error('Missing dependency: pg. Run npm install.');
    }
    const client = new pg.Client({
      host: config.host,
      port: Number(config.port || 5432),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : false
    });
    await client.connect();
    try {
      const result = await client.query(query, Array.isArray(params) ? params : []);
      return {
        rows: result.rows || [],
        rowCount: Number(result.rowCount || 0),
        fields: (result.fields || []).map((f) => f.name),
        durationMs: Date.now() - started
      };
    } finally {
      await client.end();
    }
  }

  if (engine === 'mysql') {
    let mysql;
    try {
      mysql = require('mysql2/promise');
    } catch (e) {
      throw new Error('Missing dependency: mysql2. Run npm install.');
    }
    const conn = await mysql.createConnection({
      host: config.host,
      port: Number(config.port || 3306),
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined
    });
    try {
      const [rows] = await conn.query(query, Array.isArray(params) ? params : []);
      const list = Array.isArray(rows) ? rows : [];
      return {
        rows: list,
        rowCount: list.length,
        fields: list[0] ? Object.keys(list[0]) : [],
        durationMs: Date.now() - started
      };
    } finally {
      await conn.end();
    }
  }

  if (engine === 'sqlite') {
    let sqlite3;
    try {
      sqlite3 = require('sqlite3');
    } catch (e) {
      throw new Error('Missing dependency: sqlite3. Run npm install.');
    }
    const filename = path.isAbsolute(config.filename || '')
      ? config.filename
      : path.join(basePath, String(config.filename || 'data/mate.db'));
    const db = new sqlite3.Database(filename);
    return await new Promise((resolve, reject) => {
      db.all(query, Array.isArray(params) ? params : [], (err, rows) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }
        const list = Array.isArray(rows) ? rows : [];
        db.close((closeErr) => {
          if (closeErr) {
            reject(closeErr);
            return;
          }
          resolve({
            rows: list,
            rowCount: list.length,
            fields: list[0] ? Object.keys(list[0]) : [],
            durationMs: Date.now() - started
          });
        });
      });
    });
  }

  throw new Error('Unsupported engine. Use postgres, mysql, or sqlite.');
}

async function pushDataFilesToS3(files = []) {
  let aws;
  try {
    aws = require('@aws-sdk/client-s3');
  } catch (e) {
    throw new Error('Missing dependency: @aws-sdk/client-s3. Run npm install.');
  }
  const cfg = loadAwsS3Config();
  if (!cfg.region || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error('AWS S3 config missing. Fill data/aws_s3.json or AWS env vars.');
  }
  const client = new aws.S3Client({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey
    }
  });

  const uploaded = [];
  for (const rel of files) {
    const cleanRel = String(rel || '').replace(/^[/\\]+/, '');
    const fullPath = path.join(basePath, cleanRel);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const key = `${cfg.prefix}/${cleanRel.replace(/\\/g, '/')}`;
    await client.send(
      new aws.PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: fs.createReadStream(fullPath),
        ContentType: 'application/json'
      })
    );
    uploaded.push({ file: cleanRel, key });
  }
  return { bucket: cfg.bucket, region: cfg.region, uploaded };
}

function getGoogleOAuthConfig() {
  let fileConfig = {};
  if (fs.existsSync(googleOAuthConfigFile)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(googleOAuthConfigFile, 'utf8'));
    } catch (e) {
      console.warn('Invalid data/google_oauth.json. Falling back to env vars.');
      fileConfig = {};
    }
  }
  const clientId = (process.env.GOOGLE_CLIENT_ID || fileConfig.client_id || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || fileConfig.client_secret || '').trim();
  const redirectUri = (
    process.env.GOOGLE_REDIRECT_URI ||
    fileConfig.redirect_uri ||
    `http://localhost:${PORT}/api/google/oauth/callback`
  ).trim();
  return { clientId, clientSecret, redirectUri };
}

function isPlaceholderGoogleValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes('paste_google_') ||
    normalized.includes('your_google_') ||
    normalized.includes('client_id_here') ||
    normalized.includes('client_secret_here')
  );
}

function isGoogleConfigured() {
  const cfg = getGoogleOAuthConfig();
  return Boolean(
    cfg.clientId &&
      cfg.clientSecret &&
      cfg.redirectUri &&
      !isPlaceholderGoogleValue(cfg.clientId) &&
      !isPlaceholderGoogleValue(cfg.clientSecret)
  );
}

function makeGoogleAuthUrl() {
  const cfg = getGoogleOAuthConfig();
  const state = crypto.randomBytes(16).toString('hex');
  googleOAuthState.set(state, Date.now());
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);
  return { url: authUrl.toString(), state };
}

async function exchangeGoogleCodeForToken(code) {
  const cfg = getGoogleOAuthConfig();
  const params = new URLSearchParams();
  params.set('client_id', cfg.clientId);
  params.set('client_secret', cfg.clientSecret);
  params.set('code', code);
  params.set('grant_type', 'authorization_code');
  params.set('redirect_uri', cfg.redirectUri);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${errText.slice(0, 200)}`);
  }
  const json = await tokenRes.json();
  return {
    access_token: json.access_token || '',
    refresh_token: json.refresh_token || (googleTokens && googleTokens.refresh_token) || '',
    token_type: json.token_type || 'Bearer',
    expiry_date: Date.now() + Number(json.expires_in || 0) * 1000
  };
}

async function refreshGoogleAccessToken() {
  if (!googleTokens || !googleTokens.refresh_token) {
    throw new Error('Google refresh token not found. Reconnect Google account.');
  }
  const cfg = getGoogleOAuthConfig();
  const params = new URLSearchParams();
  params.set('client_id', cfg.clientId);
  params.set('client_secret', cfg.clientSecret);
  params.set('refresh_token', googleTokens.refresh_token);
  params.set('grant_type', 'refresh_token');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google token refresh failed: ${tokenRes.status} ${errText.slice(0, 200)}`);
  }
  const json = await tokenRes.json();
  const nextTokens = {
    ...googleTokens,
    access_token: json.access_token || '',
    token_type: json.token_type || googleTokens.token_type || 'Bearer',
    expiry_date: Date.now() + Number(json.expires_in || 0) * 1000
  };
  saveGoogleTokens(nextTokens);
  return nextTokens.access_token;
}

async function getGoogleAccessToken() {
  if (!googleTokens || !googleTokens.access_token) {
    throw new Error('Google account not connected.');
  }
  const expiresSoon = Number(googleTokens.expiry_date || 0) <= Date.now() + 30 * 1000;
  if (!expiresSoon) return googleTokens.access_token;
  return refreshGoogleAccessToken();
}

async function fetchGoogleProfile() {
  const accessToken = await getGoogleAccessToken();
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google profile fetch failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  googleProfile.name = String(json.name || '');
  googleProfile.email = String(json.email || '');
  googleProfile.picture = String(json.picture || '');
  saveGoogleProfile();
  return googleProfile;
}

function normalizeContactPhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function normalizeGooglePerson(person) {
  const name = (person.names && person.names[0] && person.names[0].displayName) || '';
  const phoneRaw = (person.phoneNumbers && person.phoneNumbers[0] && person.phoneNumbers[0].value) || '';
  const email = (person.emailAddresses && person.emailAddresses[0] && person.emailAddresses[0].value) || '';
  const phone = normalizeContactPhone(phoneRaw);
  return {
    id: String(person.resourceName || `${name}-${phone}-${email}`),
    name: name || phone || email || 'Unnamed contact',
    phone,
    email: String(email || '')
  };
}

async function fetchGoogleContacts() {
  const accessToken = await getGoogleAccessToken();
  const base = new URL('https://people.googleapis.com/v1/people/me/connections');
  base.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers');
  base.searchParams.set('pageSize', '1000');

  const contacts = [];
  let pageToken = '';

  while (true) {
    const url = new URL(base.toString());
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google contacts fetch failed: ${res.status} ${errText.slice(0, 200)}`);
    }
    const json = await res.json();
    const people = Array.isArray(json.connections) ? json.connections : [];
    for (const person of people) {
      const c = normalizeGooglePerson(person);
      if (!c.name) continue;
      if (!c.phone && !c.email) continue;
      contacts.push(c);
    }

    pageToken = json.nextPageToken || '';
    if (!pageToken) break;
  }

  const byId = new Map();
  for (const c of contacts) byId.set(c.id, c);

  googleContacts.contacts = Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );
  saveGoogleContacts();
  return googleContacts.contacts;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function chunkText(text, chunkChars = 900, overlapChars = 140) {
  const clean = String(text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkChars, clean.length);
    const slice = clean.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= clean.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return chunks;
}

function isTextFile(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const textExts = new Set(['.txt', '.md', '.json', '.csv', '.log', '.html', '.xml']);
  const mime = (file.mimetype || '').toLowerCase();
  return textExts.has(ext) || mime.startsWith('text/') || mime.includes('json') || mime.includes('csv');
}

function ingestRagDocument(sourceId, sourceName, text) {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;

  const existingChunkIds = new Set(ragStore.bySource[sourceId] || []);
  if (existingChunkIds.size > 0) {
    ragStore.chunks = ragStore.chunks.filter((c) => !existingChunkIds.has(c.id));
  }

  const chunks = chunkText(normalized);
  const newIds = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    const id = `${sourceId}:${i}`;
    ragStore.chunks.push({
      id,
      sourceId,
      sourceName,
      text: c,
      tokenCount: tokenize(c).length,
      createdAt: Date.now()
    });
    newIds.push(id);
  }

  ragStore.bySource[sourceId] = newIds;
  saveRagStore();
  return newIds.length;
}

function retrieveRag(query, maxResults = 4) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0 || ragStore.chunks.length === 0) return [];

  const df = {};
  for (const token of qTokens) {
    df[token] = 0;
  }
  for (const chunk of ragStore.chunks) {
    const set = new Set(tokenize(chunk.text));
    for (const t of qTokens) {
      if (set.has(t)) df[t] += 1;
    }
  }

  const nDocs = ragStore.chunks.length;
  const scored = [];
  for (const chunk of ragStore.chunks) {
    const tokens = tokenize(chunk.text);
    if (tokens.length === 0) continue;
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    let score = 0;
    for (const qt of qTokens) {
      if (!tf[qt]) continue;
      const idf = Math.log((nDocs + 1) / ((df[qt] || 0) + 1)) + 1;
      score += (tf[qt] / tokens.length) * idf;
    }
    if (score > 0) {
      scored.push({ chunk, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => ({
      sourceName: s.chunk.sourceName,
      text: s.chunk.text,
      score: Number(s.score.toFixed(4))
    }));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function decodeDuckDuckGoRedirect(rawHref) {
  try {
    const parsed = new URL(rawHref, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
  } catch (e) {
    // ignore
  }
  return rawHref;
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function getUrlHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function isLikelyPublicHostname(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h || h.length < 4) return false;
  if (h.startsWith('.') || h.endsWith('.') || h.includes('..')) return false;
  if (!h.includes('.')) return false;
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) return false;
  return true;
}

function normalizeResultUrl(value) {
  try {
    const u = new URL(value);
    const dropParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid'
    ];
    for (const key of dropParams) u.searchParams.delete(key);
    return u.toString();
  } catch (e) {
    return value;
  }
}

function isMusicIntentQuery(query) {
  const q = String(query || '').toLowerCase();
  const signals = [
    'song',
    'track',
    'album',
    'artist',
    'lyrics',
    'music',
    'listen',
    'play',
    'spotify',
    'youtube music',
    'audio'
  ];
  return signals.some((s) => q.includes(s));
}

const TRUSTED_MUSIC_DOMAINS = [
  'youtube.com',
  'music.youtube.com',
  'youtu.be',
  'spotify.com',
  'open.spotify.com',
  'music.apple.com',
  'soundcloud.com',
  'amazon.com',
  'music.amazon.com',
  'bandcamp.com',
  'genius.com'
];

function isTrustedMusicDomain(url) {
  const host = getUrlHostname(url);
  return TRUSTED_MUSIC_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function isSearchHitValid(hit) {
  if (!hit || typeof hit !== 'object') return false;
  const title = normalizeWhitespace(hit.title || '');
  const url = normalizeWhitespace(hit.url || '');
  if (title.length < 3 || !isHttpUrl(url)) return false;
  const host = getUrlHostname(url);
  if (!isLikelyPublicHostname(host)) return false;
  if (host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) return false;
  return true;
}

function filterWebHitsByIntent(hits, query) {
  const valid = (Array.isArray(hits) ? hits : []).filter(isSearchHitValid);
  if (!isMusicIntentQuery(query)) return valid;
  const trusted = valid.filter((h) => isTrustedMusicDomain(h.url));
  return trusted.length > 0 ? trusted : valid;
}

async function webSearch(query, maxResults = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
      }
    },
    10000
  );
  if (!res.ok) {
    throw new Error(`Web search failed: ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const hits = [];
  const seen = new Set();

  $('.result').each((_, el) => {
    if (hits.length >= maxResults) return;
    const a = $(el).find('.result__a').first();
    if (!a || a.length === 0) return;

    const title = normalizeWhitespace(a.text());
    const hrefRaw = a.attr('href') || '';
    const href = normalizeResultUrl(decodeDuckDuckGoRedirect(hrefRaw));
    const snippet = normalizeWhitespace($(el).find('.result__snippet').first().text());

    if (!title || !isHttpUrl(href)) return;
    if (seen.has(href)) return;
    seen.add(href);

    hits.push({ title, url: href, snippet });
  });

  return hits;
}

async function extractPageSnippet(url, maxChars = 1200) {
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
      }
    },
    9000
  );
  if (!res.ok) {
    throw new Error(`Fetch source failed: ${res.status}`);
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    return '';
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  let text = '';
  const selectors = ['main', 'article', 'section', 'body'];
  for (const s of selectors) {
    const candidate = normalizeWhitespace($(s).first().text());
    if (candidate.length > text.length) {
      text = candidate;
    }
  }

  if (!text) return '';
  return text.slice(0, maxChars);
}

async function retrieveWebContext(query, maxResults = 3) {
  try {
    const hits = await webSearch(query, maxResults + 2);
    const trimmedHits = filterWebHitsByIntent(hits, query).slice(0, maxResults);
    const enriched = await Promise.all(
      trimmedHits.map(async (hit) => {
        let pageSnippet = '';
        try {
          pageSnippet = await extractPageSnippet(hit.url, 1200);
        } catch (e) {
          // Best-effort fallback to search snippet.
        }
        return {
          title: hit.title,
          url: hit.url,
          snippet: pageSnippet || hit.snippet || ''
        };
      })
    );
    return enriched.filter((h) => h.snippet);
  } catch (e) {
    console.warn('Web retrieval failed:', e.message);
    return [];
  }
}

function getOllamaStatus() {
  try {
    const v = execSync('ollama --version', { encoding: 'utf8' }).trim();
    return { available: true, version: v };
  } catch (e) {
    return { available: false, version: '' };
  }
}

function getUploadSummary() {
  try {
    if (!fs.existsSync(uploadsDir)) return [];
    return fs
      .readdirSync(uploadsDir)
      .map((name) => {
        const full = path.join(uploadsDir, name);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
        return {
          file: name,
          size: fs.statSync(full).size,
          indexedChunks: (ragStore.bySource[name] || []).length
        };
      })
      .filter(Boolean)
      .slice(0, 200);
  } catch (e) {
    return [];
  }
}

function getOutsourcedDomainsFromChats() {
  const set = new Set();
  for (const chat of Object.values(chats)) {
    for (const msg of chat.messages || []) {
      if (!Array.isArray(msg.web)) continue;
      for (const hit of msg.web) {
        try {
          const u = new URL(hit.url);
          if (u.hostname) set.add(u.hostname);
        } catch (e) {
          // ignore invalid URL
        }
      }
    }
  }
  return Array.from(set).sort();
}

function detectResponseMode(userText) {
  const text = String(userText || '').toLowerCase();

  const detailOverridePatterns = [
    /\bin detail\b/,
    /\bdetailed\b/,
    /\blong\b/,
    /\bcomprehensive\b/,
    /\bdeep dive\b/,
    /\bexplain\b.*\bdetail\b/
  ];
  if (detailOverridePatterns.some((p) => p.test(text))) {
    return 'default';
  }

  const trendSignals = [
    /\btoday\b/,
    /\blatest\b/,
    /\btop\b/,
    /\btrending\b/,
    /\bhot\b/,
    /\bcurrent\b/,
    /\bright now\b/,
    /\bthis week\b/
  ];
  const techSignals = [
    /\btechnology\b/,
    /\btech\b/,
    /\bai\b/,
    /\bartificial intelligence\b/,
    /\bstartup\b/,
    /\bsaas\b/,
    /\bllm\b/,
    /\bmachine learning\b/,
    /\bsoftware\b/,
    /\binnovation\b/
  ];

  const hasTrendSignal = trendSignals.some((p) => p.test(text));
  const hasTechSignal = techSignals.some((p) => p.test(text));
  if (hasTrendSignal && hasTechSignal) {
    return 'trend_compact';
  }

  return 'default';
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHereditaryFlags(hereditary) {
  const enabled = new Set();
  if (Array.isArray(hereditary)) {
    for (const item of hereditary) {
      const key = String(item || '').trim().toLowerCase();
      if (key) enabled.add(key);
    }
    return enabled;
  }
  if (hereditary && typeof hereditary === 'object') {
    for (const [key, value] of Object.entries(hereditary)) {
      if (Boolean(value)) enabled.add(String(key || '').trim().toLowerCase());
    }
  }
  return enabled;
}

function normalizeDietScore(diet) {
  if (diet && typeof diet === 'object') {
    const quality = String(diet.quality || '').toLowerCase();
    if (quality === 'excellent') return 90;
    if (quality === 'good') return 75;
    if (quality === 'average') return 55;
    if (quality === 'poor') return 30;
    if (quality === 'very_poor') return 15;
  }

  const text = String(diet || '').toLowerCase();
  if (!text) return 50;
  const good = [
    'balanced',
    'high fiber',
    'vegetable',
    'fruit',
    'whole grain',
    'low sugar',
    'mediterranean'
  ];
  const risky = [
    'junk',
    'processed',
    'high sugar',
    'fried',
    'alcohol',
    'smoking',
    'fast food',
    'high salt'
  ];
  let score = 50;
  for (const token of good) {
    if (text.includes(token)) score += 8;
  }
  for (const token of risky) {
    if (text.includes(token)) score -= 10;
  }
  return clamp(score, 0, 100);
}

function riskLabelFromScore(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

function evaluateBloodPressure(age, bloodPressure, hereditaryFlags) {
  const systolic = toFiniteNumber(bloodPressure?.systolic);
  const diastolic = toFiniteNumber(bloodPressure?.diastolic);
  if (systolic === null || diastolic === null) {
    return {
      available: false,
      category: 'unknown',
      scoreDelta: 0,
      message: 'Blood pressure values were not provided.'
    };
  }

  let category = 'normal';
  let scoreDelta = 0;
  if (systolic >= 180 || diastolic >= 120) {
    category = 'hypertensive_crisis';
    scoreDelta = 55;
  } else if (systolic >= 140 || diastolic >= 90) {
    category = 'hypertension_stage_2';
    scoreDelta = 35;
  } else if (systolic >= 130 || diastolic >= 80) {
    category = 'hypertension_stage_1';
    scoreDelta = 24;
  } else if (systolic >= 120 && diastolic < 80) {
    category = 'elevated';
    scoreDelta = 12;
  }

  if (age >= 60 && category !== 'normal') scoreDelta += 4;
  if (hereditaryFlags.has('hypertension') || hereditaryFlags.has('heart_disease')) scoreDelta += 6;

  return {
    available: true,
    systolic,
    diastolic,
    category,
    scoreDelta,
    message:
      category === 'hypertensive_crisis'
        ? 'Severely elevated blood pressure range detected. Urgent care is recommended.'
        : `Blood pressure category: ${category}.`
  };
}

function analyzeMedicalRisk(input) {
  const age = toFiniteNumber(input.age);
  const bloodTests = input.bloodTests && typeof input.bloodTests === 'object' ? input.bloodTests : {};
  const hereditaryFlags = normalizeHereditaryFlags(input.hereditary);
  const dietScore = normalizeDietScore(input.diet);
  const bloodPressure = evaluateBloodPressure(age || 0, input.bloodPressure || {}, hereditaryFlags);

  let score = 0;
  const conditionSignals = [];

  if (age !== null) {
    if (age >= 65) score += 18;
    else if (age >= 45) score += 10;
    else if (age >= 30) score += 5;
  }
  score += Math.round((100 - dietScore) * 0.2);

  const a1c = toFiniteNumber(bloodTests.hba1c ?? bloodTests.HbA1c ?? bloodTests.a1c);
  const fastingGlucose = toFiniteNumber(bloodTests.fastingGlucose);
  if (a1c !== null || fastingGlucose !== null) {
    let diabetesRiskDelta = 0;
    const reasons = [];
    if (a1c !== null && a1c >= 6.5) {
      diabetesRiskDelta += 35;
      reasons.push(`HbA1c ${a1c}% is in diabetes range`);
    } else if (a1c !== null && a1c >= 5.7) {
      diabetesRiskDelta += 20;
      reasons.push(`HbA1c ${a1c}% is in prediabetes range`);
    }
    if (fastingGlucose !== null && fastingGlucose >= 126) {
      diabetesRiskDelta += 30;
      reasons.push(`Fasting glucose ${fastingGlucose} mg/dL is high`);
    } else if (fastingGlucose !== null && fastingGlucose >= 100) {
      diabetesRiskDelta += 15;
      reasons.push(`Fasting glucose ${fastingGlucose} mg/dL suggests impaired control`);
    }
    if (hereditaryFlags.has('diabetes')) diabetesRiskDelta += 8;
    score += diabetesRiskDelta;
    if (diabetesRiskDelta > 0) {
      conditionSignals.push({
        condition: 'Diabetes / glucose dysregulation',
        risk: riskLabelFromScore(diabetesRiskDelta),
        reasons
      });
    }
  }

  const ldl = toFiniteNumber(bloodTests.ldl);
  const hdl = toFiniteNumber(bloodTests.hdl);
  const triglycerides = toFiniteNumber(bloodTests.triglycerides);
  let cardioDelta = 0;
  const cardioReasons = [];
  if (ldl !== null && ldl >= 190) {
    cardioDelta += 28;
    cardioReasons.push(`LDL ${ldl} mg/dL is very high`);
  } else if (ldl !== null && ldl >= 160) {
    cardioDelta += 18;
    cardioReasons.push(`LDL ${ldl} mg/dL is high`);
  } else if (ldl !== null && ldl >= 130) {
    cardioDelta += 10;
    cardioReasons.push(`LDL ${ldl} mg/dL is borderline high`);
  }
  if (hdl !== null && hdl < 40) {
    cardioDelta += 10;
    cardioReasons.push(`HDL ${hdl} mg/dL is low`);
  }
  if (triglycerides !== null && triglycerides >= 200) {
    cardioDelta += 12;
    cardioReasons.push(`Triglycerides ${triglycerides} mg/dL are high`);
  }
  if (hereditaryFlags.has('heart_disease') || hereditaryFlags.has('stroke')) cardioDelta += 8;
  score += cardioDelta + bloodPressure.scoreDelta;
  if (cardioDelta > 0 || bloodPressure.scoreDelta > 0) {
    conditionSignals.push({
      condition: 'Cardiovascular risk (lipids + blood pressure)',
      risk: riskLabelFromScore(cardioDelta + bloodPressure.scoreDelta),
      reasons: [...cardioReasons, bloodPressure.message]
    });
  }

  const hemoglobin = toFiniteNumber(bloodTests.hemoglobin);
  if (hemoglobin !== null && hemoglobin < 12) {
    const delta = hemoglobin < 10 ? 16 : 9;
    score += delta;
    conditionSignals.push({
      condition: 'Possible anemia',
      risk: riskLabelFromScore(delta),
      reasons: [`Hemoglobin ${hemoglobin} g/dL is low`]
    });
  }

  const crp = toFiniteNumber(bloodTests.crp);
  const wbc = toFiniteNumber(bloodTests.wbc);
  let inflammationDelta = 0;
  const inflammationReasons = [];
  if (crp !== null && crp > 10) {
    inflammationDelta += 20;
    inflammationReasons.push(`CRP ${crp} mg/L suggests active inflammation`);
  } else if (crp !== null && crp > 3) {
    inflammationDelta += 10;
    inflammationReasons.push(`CRP ${crp} mg/L is mildly elevated`);
  }
  if (wbc !== null && (wbc > 11 || wbc < 4)) {
    inflammationDelta += 10;
    inflammationReasons.push(`WBC ${wbc} x10^9/L is outside common range`);
  }
  if (inflammationDelta > 0) {
    score += inflammationDelta;
    conditionSignals.push({
      condition: 'Inflammation / infection signal',
      risk: riskLabelFromScore(inflammationDelta),
      reasons: inflammationReasons
    });
  }

  let cancerDelta = 0;
  const cancerReasons = [];
  const hasCancerFamilyHistory =
    hereditaryFlags.has('cancer') ||
    hereditaryFlags.has('breast_cancer') ||
    hereditaryFlags.has('colon_cancer') ||
    hereditaryFlags.has('lung_cancer') ||
    hereditaryFlags.has('prostate_cancer');
  if (hasCancerFamilyHistory) {
    cancerDelta += 22;
    cancerReasons.push('Family history indicates inherited cancer risk');
  }
  if (age !== null && age >= 50) {
    cancerDelta += 8;
    cancerReasons.push('Age is within common screening bracket');
  }
  if (crp !== null && crp > 10) {
    cancerDelta += 4;
    cancerReasons.push('Persistent inflammation may warrant broader screening');
  }
  if (cancerDelta > 0) {
    score += cancerDelta;
    conditionSignals.push({
      condition: 'Cancer screening priority',
      risk: riskLabelFromScore(cancerDelta),
      reasons: cancerReasons
    });
  }

  const riskScore = clamp(Math.round(score), 0, 100);
  const overallRisk =
    riskScore >= 80 ? 'critical' : riskScore >= 60 ? 'high' : riskScore >= 35 ? 'moderate' : 'low';
  const recommendations = [];
  if (bloodPressure.category === 'hypertensive_crisis') {
    recommendations.push('Seek urgent medical attention immediately for severe blood pressure readings.');
  } else if (bloodPressure.category.startsWith('hypertension')) {
    recommendations.push('Book a clinician review for blood pressure confirmation and treatment planning.');
  }
  if (riskScore >= 60) {
    recommendations.push('Schedule a full physician-led assessment with repeat blood tests within 1-2 weeks.');
  } else if (riskScore >= 35) {
    recommendations.push('Arrange a preventive care follow-up and repeat key labs in 1-3 months.');
  } else {
    recommendations.push('Continue preventive habits and routine screening based on age guidelines.');
  }
  if (hasCancerFamilyHistory) {
    recommendations.push('Discuss personalized cancer screening timeline with an oncologist or primary physician.');
  }

  return {
    generatedAt: Date.now(),
    riskScore,
    overallRisk,
    bloodPressure,
    dietScore,
    conditionSignals,
    recommendations,
    disclaimer:
      'This is a risk-screening assistant, not a diagnosis. Final diagnosis and treatment must be done by a licensed medical professional.'
  };
}

function roundTo(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

function parseModelNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseNumberSeries(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

function calcMean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function calcStdDev(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const mean = calcMean(values);
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function calcCovariance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const aa = a.slice(0, n);
  const bb = b.slice(0, n);
  const meanA = calcMean(aa);
  const meanB = calcMean(bb);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (aa[i] - meanA) * (bb[i] - meanB);
  }
  return sum / (n - 1);
}

const modelCatalog = {
  finance: {
    title: 'Finance Models',
    models: [
      {
        id: 'simple_interest',
        name: 'Simple Interest',
        inputs: ['principal', 'annualRate', 'years']
      },
      {
        id: 'compound_growth',
        name: 'Compound Growth',
        inputs: ['principal', 'annualRate', 'years', 'compoundsPerYear(optional)']
      },
      {
        id: 'sip_future_value',
        name: 'SIP Future Value',
        inputs: ['monthlyInvestment', 'annualReturn', 'years']
      },
      {
        id: 'loan_emi',
        name: 'Loan EMI',
        inputs: ['principal', 'annualRate', 'years']
      },
      {
        id: 'break_even_units',
        name: 'Business Break-even Units',
        inputs: ['fixedCost', 'unitPrice', 'unitVariableCost']
      },
      {
        id: 'position_size_risk',
        name: 'Position Size by Risk',
        inputs: ['capital', 'riskPct', 'entryPrice', 'stopLossPrice']
      },
      {
        id: 'risk_reward',
        name: 'Risk Reward and Break-even Win Rate',
        inputs: ['entryPrice', 'stopLossPrice', 'targetPrice']
      },
      {
        id: 'trade_expectancy',
        name: 'Trade Expectancy',
        inputs: ['winRatePct', 'avgWinR', 'avgLossR']
      },
      {
        id: 'kelly_fraction',
        name: 'Kelly Fraction Position Sizing',
        inputs: ['winRatePct', 'payoffRatio']
      },
      {
        id: 'rolling_volatility',
        name: 'Volatility from Return Series',
        inputs: ['returnsPct (array or comma-separated)', 'annualizationDays(optional)']
      },
      {
        id: 'sharpe_ratio',
        name: 'Sharpe Ratio',
        inputs: ['returnsPct (array or comma-separated)', 'riskFreeRatePct(optional)', 'annualizationDays(optional)']
      },
      {
        id: 'max_drawdown',
        name: 'Max Drawdown',
        inputs: ['equityCurve (array or comma-separated)']
      },
      {
        id: 'var_parametric',
        name: 'Parametric VaR',
        inputs: ['portfolioValue', 'dailyVolPct', 'confidencePct(optional)', 'days(optional)']
      },
      {
        id: 'beta_alpha',
        name: 'Beta and Alpha vs Market',
        inputs: ['assetReturnsPct (array)', 'marketReturnsPct (array)', 'riskFreeRatePct(optional)', 'annualizationDays(optional)']
      },
      {
        id: 'capm_expected_return',
        name: 'CAPM Expected Return',
        inputs: ['riskFreeRatePct', 'beta', 'marketReturnPct']
      },
      {
        id: 'scenario_projection',
        name: 'Bull/Base/Bear Scenario Projection',
        inputs: ['portfolioValue', 'bullReturnPct', 'baseReturnPct', 'bearReturnPct', 'bullProbPct', 'baseProbPct', 'bearProbPct']
      }
    ]
  },
  defense: {
    title: 'Defense Learning Models (Educational)',
    models: [
      {
        id: 'readiness_score',
        name: 'Mission Readiness Score',
        inputs: ['personnelReadyPct', 'equipmentReadyPct', 'trainingHoursPerMonth', 'logisticsDays']
      },
      {
        id: 'layered_coverage_score',
        name: 'Layered Coverage Score',
        inputs: ['sensorCoveragePct', 'interceptorAvailabilityPct', 'responseTimeMinutes']
      },
      {
        id: 'threat_risk_index',
        name: 'Threat Risk Index',
        inputs: ['threatLevel1to10', 'intelConfidence1to10', 'terrainComplexity1to10', 'weatherPenalty1to10']
      }
    ]
  }
};

function runFinanceModel(modelId, inputs) {
  if (modelId === 'simple_interest') {
    const principal = parseModelNumber(inputs.principal, 0);
    const annualRate = parseModelNumber(inputs.annualRate, 0);
    const years = parseModelNumber(inputs.years, 0);
    const interest = (principal * annualRate * years) / 100;
    const maturityAmount = principal + interest;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        principal: roundTo(principal),
        interest: roundTo(interest),
        maturityAmount: roundTo(maturityAmount)
      },
      explanationSimple:
        `If you invest ${roundTo(principal)} at ${roundTo(annualRate)}% for ${roundTo(years)} years, ` +
        `you earn ${roundTo(interest)} as interest and end with ${roundTo(maturityAmount)}.`,
      explanationTechnical:
        'Formula used: Interest = Principal x Rate x Time / 100; Amount = Principal + Interest.',
      assumptions: ['Rate remains constant over the full period.']
    };
  }

  if (modelId === 'compound_growth') {
    const principal = parseModelNumber(inputs.principal, 0);
    const annualRate = parseModelNumber(inputs.annualRate, 0);
    const years = parseModelNumber(inputs.years, 0);
    const compoundsPerYear = Math.max(1, parseModelNumber(inputs.compoundsPerYear, 12));
    const amount = principal * Math.pow(1 + annualRate / (100 * compoundsPerYear), compoundsPerYear * years);
    const gains = amount - principal;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        principal: roundTo(principal),
        gains: roundTo(gains),
        finalAmount: roundTo(amount)
      },
      explanationSimple:
        `Compounding grows your money faster. Your ${roundTo(principal)} can become ${roundTo(amount)} in ${roundTo(years)} years.`,
      explanationTechnical:
        'Formula used: A = P * (1 + r/n)^(n*t), where n is compounds/year.',
      assumptions: ['Returns are smooth and constant. No taxes or fees included.']
    };
  }

  if (modelId === 'sip_future_value') {
    const monthlyInvestment = parseModelNumber(inputs.monthlyInvestment, 0);
    const annualReturn = parseModelNumber(inputs.annualReturn, 0);
    const years = parseModelNumber(inputs.years, 0);
    const months = Math.max(0, Math.round(years * 12));
    const i = annualReturn / 1200;
    const fv = i === 0 ? monthlyInvestment * months : monthlyInvestment * (((Math.pow(1 + i, months) - 1) / i) * (1 + i));
    const invested = monthlyInvestment * months;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        investedAmount: roundTo(invested),
        futureValue: roundTo(fv),
        wealthGained: roundTo(fv - invested)
      },
      explanationSimple:
        `Investing ${roundTo(monthlyInvestment)} every month for ${roundTo(years)} years may grow to about ${roundTo(fv)}.`,
      explanationTechnical:
        'SIP future value assumes monthly compounding and end-of-month contributions.',
      assumptions: ['Market returns are variable in reality; this is a smooth-return estimate.']
    };
  }

  if (modelId === 'loan_emi') {
    const principal = parseModelNumber(inputs.principal, 0);
    const annualRate = parseModelNumber(inputs.annualRate, 0);
    const years = parseModelNumber(inputs.years, 0);
    const months = Math.max(1, Math.round(years * 12));
    const r = annualRate / 1200;
    const emi = r === 0 ? principal / months : (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
    const totalPayment = emi * months;
    const totalInterest = totalPayment - principal;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        monthlyEMI: roundTo(emi),
        totalPayment: roundTo(totalPayment),
        totalInterest: roundTo(totalInterest)
      },
      explanationSimple:
        `Your estimated monthly EMI is ${roundTo(emi)}. Over ${months} months, total interest is about ${roundTo(totalInterest)}.`,
      explanationTechnical:
        'EMI formula used: EMI = P*r*(1+r)^n / ((1+r)^n - 1).',
      assumptions: ['Fixed interest rate and no prepayment.']
    };
  }

  if (modelId === 'break_even_units') {
    const fixedCost = parseModelNumber(inputs.fixedCost, 0);
    const unitPrice = parseModelNumber(inputs.unitPrice, 0);
    const unitVariableCost = parseModelNumber(inputs.unitVariableCost, 0);
    const contribution = unitPrice - unitVariableCost;
    const breakEvenUnits = contribution > 0 ? fixedCost / contribution : Infinity;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        contributionPerUnit: roundTo(contribution),
        breakEvenUnits: Number.isFinite(breakEvenUnits) ? roundTo(breakEvenUnits) : null
      },
      explanationSimple:
        Number.isFinite(breakEvenUnits)
          ? `You need to sell about ${roundTo(breakEvenUnits)} units to cover all fixed costs.`
          : 'Break-even cannot be reached because unit margin is not positive.',
      explanationTechnical:
        'Break-even units = Fixed Cost / (Selling Price per Unit - Variable Cost per Unit).',
      assumptions: ['Single product approximation and constant unit economics.']
    };
  }

  if (modelId === 'position_size_risk') {
    const capital = Math.max(0, parseModelNumber(inputs.capital, 0));
    const riskPct = clamp(parseModelNumber(inputs.riskPct, 1), 0, 100);
    const entryPrice = Math.max(0, parseModelNumber(inputs.entryPrice, 0));
    const stopLossPrice = Math.max(0, parseModelNumber(inputs.stopLossPrice, 0));
    const riskAmount = capital * (riskPct / 100);
    const perUnitRisk = Math.abs(entryPrice - stopLossPrice);
    const quantity = perUnitRisk > 0 ? Math.floor(riskAmount / perUnitRisk) : 0;
    const maxPositionValue = quantity * entryPrice;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        riskAmount: roundTo(riskAmount),
        perUnitRisk: roundTo(perUnitRisk),
        suggestedQuantity: quantity,
        maxPositionValue: roundTo(maxPositionValue)
      },
      explanationSimple:
        `At ${riskPct}% risk, you can lose up to ${roundTo(riskAmount)} on this trade. Suggested size is ${quantity} units.`,
      explanationTechnical:
        'Position size = (Capital x Risk%) / |Entry - Stop|.',
      assumptions: ['Execution slippage and gap risk are ignored.']
    };
  }

  if (modelId === 'risk_reward') {
    const entryPrice = parseModelNumber(inputs.entryPrice, 0);
    const stopLossPrice = parseModelNumber(inputs.stopLossPrice, 0);
    const targetPrice = parseModelNumber(inputs.targetPrice, 0);
    const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
    const rewardPerUnit = Math.abs(targetPrice - entryPrice);
    const rrRatio = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
    const breakEvenWinRatePct = rrRatio > 0 ? 100 / (1 + rrRatio) : 100;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        riskPerUnit: roundTo(riskPerUnit),
        rewardPerUnit: roundTo(rewardPerUnit),
        rewardToRiskRatio: roundTo(rrRatio, 3),
        breakEvenWinRatePct: roundTo(breakEvenWinRatePct, 2)
      },
      explanationSimple:
        `Your setup is about 1:${roundTo(rrRatio, 2)} reward-to-risk. You need roughly ${roundTo(breakEvenWinRatePct, 2)}% win rate to break even.`,
      explanationTechnical:
        'R:R = Reward per unit / Risk per unit; break-even win rate = 1 / (1 + R:R).',
      assumptions: ['Costs, slippage, and partial exits are ignored.']
    };
  }

  if (modelId === 'trade_expectancy') {
    const winRatePct = clamp(parseModelNumber(inputs.winRatePct, 0), 0, 100);
    const avgWinR = Math.max(0, parseModelNumber(inputs.avgWinR, 0));
    const avgLossR = Math.max(0, parseModelNumber(inputs.avgLossR, 0));
    const p = winRatePct / 100;
    const expectancyR = p * avgWinR - (1 - p) * avgLossR;
    const grossProfit = p * avgWinR;
    const grossLoss = (1 - p) * avgLossR;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        expectancyR: roundTo(expectancyR, 4),
        expectancyPctPerRiskUnit: roundTo(expectancyR * 100, 2),
        profitFactor: Number.isFinite(profitFactor) ? roundTo(profitFactor, 3) : null
      },
      explanationSimple:
        `Expectancy is ${roundTo(expectancyR, 3)}R per trade. Positive expectancy means your system has an edge.`,
      explanationTechnical:
        'Expectancy = p x AvgWin - (1-p) x AvgLoss, measured in R units.',
      assumptions: ['Win/loss distribution is stable across future trades.']
    };
  }

  if (modelId === 'kelly_fraction') {
    const winRatePct = clamp(parseModelNumber(inputs.winRatePct, 0), 0, 100);
    const payoffRatio = Math.max(0, parseModelNumber(inputs.payoffRatio, 0));
    const p = winRatePct / 100;
    const q = 1 - p;
    const rawKelly = payoffRatio > 0 ? p - q / payoffRatio : 0;
    const kellyFraction = clamp(rawKelly, 0, 1);
    return {
      modelId,
      domain: 'finance',
      outputs: {
        kellyFractionPct: roundTo(kellyFraction * 100, 2),
        halfKellyPct: roundTo(kellyFraction * 50, 2),
        quarterKellyPct: roundTo(kellyFraction * 25, 2)
      },
      explanationSimple:
        `Full Kelly is ${roundTo(kellyFraction * 100, 2)}% of capital. Most traders use half-Kelly or less for safety.`,
      explanationTechnical:
        'Kelly fraction = p - (1-p)/b, where b is payoff ratio.',
      assumptions: ['Edge estimates are accurate and stationary, which is rarely true in live markets.']
    };
  }

  if (modelId === 'rolling_volatility') {
    const returnsPct = parseNumberSeries(inputs.returnsPct);
    const annualizationDays = Math.max(1, Math.round(parseModelNumber(inputs.annualizationDays, 252)));
    const returns = returnsPct.map((x) => x / 100);
    const meanDaily = calcMean(returns);
    const dailyVol = calcStdDev(returns);
    const annualVol = dailyVol * Math.sqrt(annualizationDays);
    return {
      modelId,
      domain: 'finance',
      outputs: {
        observations: returns.length,
        meanDailyReturnPct: roundTo(meanDaily * 100, 4),
        dailyVolatilityPct: roundTo(dailyVol * 100, 4),
        annualizedVolatilityPct: roundTo(annualVol * 100, 2)
      },
      explanationSimple:
        `Based on your return series, annualized volatility is about ${roundTo(annualVol * 100, 2)}%.`,
      explanationTechnical:
        'Daily volatility is sample standard deviation of returns; annualized vol = daily vol x sqrt(N).',
      assumptions: ['Return distribution is approximated with stable variance.']
    };
  }

  if (modelId === 'sharpe_ratio') {
    const returnsPct = parseNumberSeries(inputs.returnsPct);
    const annualizationDays = Math.max(1, Math.round(parseModelNumber(inputs.annualizationDays, 252)));
    const riskFreeRatePct = parseModelNumber(inputs.riskFreeRatePct, 6);
    const returns = returnsPct.map((x) => x / 100);
    const rfDaily = (riskFreeRatePct / 100) / annualizationDays;
    const excess = returns.map((r) => r - rfDaily);
    const meanExcess = calcMean(excess);
    const stdExcess = calcStdDev(excess);
    const sharpe = stdExcess > 0 ? (meanExcess / stdExcess) * Math.sqrt(annualizationDays) : 0;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        observations: returns.length,
        annualizedSharpe: roundTo(sharpe, 3),
        meanExcessDailyPct: roundTo(meanExcess * 100, 4),
        excessVolDailyPct: roundTo(stdExcess * 100, 4)
      },
      explanationSimple:
        `Sharpe ratio is ${roundTo(sharpe, 3)}. Higher Sharpe means better return per unit of risk.`,
      explanationTechnical:
        'Sharpe = sqrt(N) x mean(excess return) / std(excess return).',
      assumptions: ['Returns and volatility estimates are representative of the future.']
    };
  }

  if (modelId === 'max_drawdown') {
    const equityCurve = parseNumberSeries(inputs.equityCurve);
    let peak = equityCurve.length > 0 ? equityCurve[0] : 0;
    let maxDd = 0;
    for (const v of equityCurve) {
      if (v > peak) peak = v;
      const dd = peak > 0 ? (peak - v) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
    return {
      modelId,
      domain: 'finance',
      outputs: {
        observations: equityCurve.length,
        maxDrawdownPct: roundTo(maxDd * 100, 2)
      },
      explanationSimple:
        `Worst historical equity drop was ${roundTo(maxDd * 100, 2)}% from a previous peak.`,
      explanationTechnical:
        'Max drawdown is the maximum peak-to-trough percentage decline in the equity curve.',
      assumptions: ['Uses only the supplied equity path. Intra-period drawdowns may be larger.']
    };
  }

  if (modelId === 'var_parametric') {
    const portfolioValue = Math.max(0, parseModelNumber(inputs.portfolioValue, 0));
    const dailyVolPct = Math.max(0, parseModelNumber(inputs.dailyVolPct, 0));
    const confidencePct = clamp(parseModelNumber(inputs.confidencePct, 95), 90, 99.9);
    const days = Math.max(1, Math.round(parseModelNumber(inputs.days, 1)));
    const zTable = [
      { c: 90, z: 1.282 },
      { c: 95, z: 1.645 },
      { c: 97.5, z: 1.96 },
      { c: 99, z: 2.326 },
      { c: 99.5, z: 2.576 }
    ];
    let z = 1.645;
    for (const row of zTable) {
      if (confidencePct >= row.c) z = row.z;
    }
    const dailyVol = dailyVolPct / 100;
    const varAmount = portfolioValue * z * dailyVol * Math.sqrt(days);
    return {
      modelId,
      domain: 'finance',
      outputs: {
        confidencePct: roundTo(confidencePct, 2),
        horizonDays: days,
        valueAtRisk: roundTo(varAmount),
        valueAtRiskPct: portfolioValue > 0 ? roundTo((varAmount / portfolioValue) * 100, 2) : 0
      },
      explanationSimple:
        `At ${roundTo(confidencePct, 2)}% confidence over ${days} day(s), potential loss is about ${roundTo(varAmount)}.`,
      explanationTechnical:
        'Parametric VaR uses: VaR = Portfolio x z x dailyVol x sqrt(horizon).',
      assumptions: ['Normal-return approximation; tail risk can be underestimated in crashes.']
    };
  }

  if (modelId === 'beta_alpha') {
    const assetReturnsPct = parseNumberSeries(inputs.assetReturnsPct);
    const marketReturnsPct = parseNumberSeries(inputs.marketReturnsPct);
    const annualizationDays = Math.max(1, Math.round(parseModelNumber(inputs.annualizationDays, 252)));
    const riskFreeRatePct = parseModelNumber(inputs.riskFreeRatePct, 6);
    const n = Math.min(assetReturnsPct.length, marketReturnsPct.length);
    const a = assetReturnsPct.slice(0, n).map((x) => x / 100);
    const m = marketReturnsPct.slice(0, n).map((x) => x / 100);
    const cov = calcCovariance(a, m);
    const varM = Math.pow(calcStdDev(m), 2);
    const beta = varM > 0 ? cov / varM : 0;
    const rfDaily = (riskFreeRatePct / 100) / annualizationDays;
    const alphaDaily = (calcMean(a) - rfDaily) - beta * (calcMean(m) - rfDaily);
    const alphaAnnualPct = alphaDaily * annualizationDays * 100;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        observations: n,
        beta: roundTo(beta, 4),
        alphaAnnualPct: roundTo(alphaAnnualPct, 2)
      },
      explanationSimple:
        `Beta is ${roundTo(beta, 3)}. Alpha is ${roundTo(alphaAnnualPct, 2)}% annualized versus the market baseline.`,
      explanationTechnical:
        'Beta = Cov(asset, market)/Var(market); alpha derived from excess-return regression approximation.',
      assumptions: ['Historical relationship with market persists into the future.']
    };
  }

  if (modelId === 'capm_expected_return') {
    const riskFreeRatePct = parseModelNumber(inputs.riskFreeRatePct, 0);
    const beta = parseModelNumber(inputs.beta, 1);
    const marketReturnPct = parseModelNumber(inputs.marketReturnPct, 0);
    const expectedReturnPct = riskFreeRatePct + beta * (marketReturnPct - riskFreeRatePct);
    return {
      modelId,
      domain: 'finance',
      outputs: {
        expectedReturnPct: roundTo(expectedReturnPct, 2),
        equityRiskPremiumPct: roundTo(marketReturnPct - riskFreeRatePct, 2)
      },
      explanationSimple:
        `CAPM expected return is ${roundTo(expectedReturnPct, 2)}% for beta ${roundTo(beta, 2)}.`,
      explanationTechnical:
        'CAPM: E[R] = Rf + beta x (Rm - Rf).',
      assumptions: ['Single-factor market model with stable beta.']
    };
  }

  if (modelId === 'scenario_projection') {
    const portfolioValue = Math.max(0, parseModelNumber(inputs.portfolioValue, 0));
    const bullReturnPct = parseModelNumber(inputs.bullReturnPct, 12);
    const baseReturnPct = parseModelNumber(inputs.baseReturnPct, 5);
    const bearReturnPct = parseModelNumber(inputs.bearReturnPct, -10);
    const bullProbPct = clamp(parseModelNumber(inputs.bullProbPct, 30), 0, 100);
    const baseProbPct = clamp(parseModelNumber(inputs.baseProbPct, 50), 0, 100);
    const bearProbPct = clamp(parseModelNumber(inputs.bearProbPct, 20), 0, 100);
    const probSum = bullProbPct + baseProbPct + bearProbPct;
    const safeSum = probSum > 0 ? probSum : 100;
    const pBull = bullProbPct / safeSum;
    const pBase = baseProbPct / safeSum;
    const pBear = bearProbPct / safeSum;
    const bullValue = portfolioValue * (1 + bullReturnPct / 100);
    const baseValue = portfolioValue * (1 + baseReturnPct / 100);
    const bearValue = portfolioValue * (1 + bearReturnPct / 100);
    const expectedValue = bullValue * pBull + baseValue * pBase + bearValue * pBear;
    return {
      modelId,
      domain: 'finance',
      outputs: {
        bullCaseValue: roundTo(bullValue),
        baseCaseValue: roundTo(baseValue),
        bearCaseValue: roundTo(bearValue),
        expectedValue: roundTo(expectedValue),
        expectedReturnPct: portfolioValue > 0 ? roundTo(((expectedValue / portfolioValue) - 1) * 100, 2) : 0
      },
      explanationSimple:
        `Weighted by your scenarios, expected portfolio value is about ${roundTo(expectedValue)}.`,
      explanationTechnical:
        'Scenario expectation = sum(probability x scenario value), with probabilities normalized to 100%.',
      assumptions: ['Scenario probabilities are subjective and may shift quickly.']
    };
  }

  throw new Error('Unknown finance model.');
}

function runDefenseModel(modelId, inputs) {
  if (modelId === 'readiness_score') {
    const personnelReadyPct = clamp(parseModelNumber(inputs.personnelReadyPct, 0), 0, 100);
    const equipmentReadyPct = clamp(parseModelNumber(inputs.equipmentReadyPct, 0), 0, 100);
    const trainingHoursPerMonth = Math.max(0, parseModelNumber(inputs.trainingHoursPerMonth, 0));
    const logisticsDays = Math.max(0, parseModelNumber(inputs.logisticsDays, 0));
    const trainingScore = clamp((trainingHoursPerMonth / 40) * 100, 0, 100);
    const logisticsScore = clamp((logisticsDays / 30) * 100, 0, 100);
    const readinessScore = roundTo(
      personnelReadyPct * 0.35 + equipmentReadyPct * 0.35 + trainingScore * 0.2 + logisticsScore * 0.1
    );
    return {
      modelId,
      domain: 'defense',
      outputs: {
        readinessScore,
        readinessBand: readinessScore >= 80 ? 'high' : readinessScore >= 60 ? 'moderate' : 'low'
      },
      explanationSimple:
        `Overall readiness is ${readinessScore}/100. Improve weakest area first to raise mission confidence quickly.`,
      explanationTechnical:
        'Weighted index using personnel, equipment, training, and logistics readiness factors.',
      assumptions: ['Educational planning model only. Not for real-world tactical decisions.']
    };
  }

  if (modelId === 'layered_coverage_score') {
    const sensorCoveragePct = clamp(parseModelNumber(inputs.sensorCoveragePct, 0), 0, 100);
    const interceptorAvailabilityPct = clamp(parseModelNumber(inputs.interceptorAvailabilityPct, 0), 0, 100);
    const responseTimeMinutes = Math.max(0, parseModelNumber(inputs.responseTimeMinutes, 0));
    const responseScore = clamp(100 - responseTimeMinutes * 4, 0, 100);
    const score = roundTo(sensorCoveragePct * 0.45 + interceptorAvailabilityPct * 0.4 + responseScore * 0.15);
    return {
      modelId,
      domain: 'defense',
      outputs: {
        layeredCoverageScore: score,
        gapFlag: score < 60 ? 'coverage_gap_likely' : 'coverage_acceptable'
      },
      explanationSimple:
        `Coverage score is ${score}/100. Better sensors and faster response time improve this score fastest.`,
      explanationTechnical:
        'Composite score from sensor coverage, interceptor availability, and response-time penalty.',
      assumptions: ['Educational abstraction; not a weapon-system simulation.']
    };
  }

  if (modelId === 'threat_risk_index') {
    const threatLevel = clamp(parseModelNumber(inputs.threatLevel1to10, 1), 1, 10);
    const intelConfidence = clamp(parseModelNumber(inputs.intelConfidence1to10, 1), 1, 10);
    const terrainComplexity = clamp(parseModelNumber(inputs.terrainComplexity1to10, 1), 1, 10);
    const weatherPenalty = clamp(parseModelNumber(inputs.weatherPenalty1to10, 1), 1, 10);
    const riskScore = roundTo((threatLevel * 0.45 + terrainComplexity * 0.25 + weatherPenalty * 0.2 + (11 - intelConfidence) * 0.1) * 10);
    return {
      modelId,
      domain: 'defense',
      outputs: {
        threatRiskIndex: riskScore,
        riskBand: riskScore >= 75 ? 'high' : riskScore >= 45 ? 'moderate' : 'low'
      },
      explanationSimple:
        `Threat risk index is ${riskScore}/100. Higher threat, terrain complexity, and bad weather increase risk.`,
      explanationTechnical:
        'Weighted risk aggregation with an uncertainty penalty from low intelligence confidence.',
      assumptions: ['Educational model for understanding tradeoffs only.']
    };
  }

  throw new Error('Unknown defense model.');
}

function runDomainModel(domain, modelId, inputs) {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  const normalizedModelId = String(modelId || '').trim().toLowerCase();
  if (normalizedDomain === 'finance') {
    const result = runFinanceModel(normalizedModelId, inputs || {});
    return {
      ...result,
      disclaimer:
        'Finance model outputs are educational estimates, not investment advice or guaranteed trade signals. Consider taxes, fees, slippage, and risk tolerance.'
    };
  }
  if (normalizedDomain === 'defense') {
    const result = runDefenseModel(normalizedModelId, inputs || {});
    return {
      ...result,
      disclaimer:
        'Defense model outputs are educational abstractions for learning and planning literacy only.'
    };
  }
  throw new Error('Unsupported domain. Use "finance" or "defense".');
}

function extractJsonObjectFromText(rawText) {
  const text = String(rawText || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('ML prediction output was not valid JSON.');
  }
  const jsonSlice = text.slice(start, end + 1);
  return JSON.parse(jsonSlice);
}

async function runFinanceMlPrediction(input) {
  if (!fs.existsSync(financeMlModelFile)) {
    throw new Error('Finance ML model file not found. Run: npm run ml:finance:train');
  }
  if (!fs.existsSync(financeMlPredictScript)) {
    throw new Error('Finance ML predict script not found.');
  }

  const open = parseModelNumber(input.open, null);
  const high = parseModelNumber(input.high, null);
  const low = parseModelNumber(input.low, null);
  const close = parseModelNumber(input.close, null);
  const prevClose = parseModelNumber(input.prevClose, parseModelNumber(input.prev_close, null));
  const volume = parseModelNumber(input.volume, null);
  if ([open, high, low, close, prevClose, volume].some((v) => v === null)) {
    throw new Error('open, high, low, close, prevClose, and volume are required numbers.');
  }

  const args = [
    financeMlPredictScript,
    '--model', financeMlModelFile,
    '--open', String(open),
    '--high', String(high),
    '--low', String(low),
    '--close', String(close),
    '--prev-close', String(prevClose),
    '--volume', String(volume)
  ];

  const { stdout, stderr } = await execFileAsync('python', args, {
    cwd: basePath,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });

  if (stderr && String(stderr).trim()) {
    const maybeWarn = String(stderr).trim();
    if (!maybeWarn.toLowerCase().includes('warning')) {
      throw new Error(maybeWarn);
    }
  }
  return extractJsonObjectFromText(stdout);
}

async function runFinanceMlRetrain(input = {}) {
  if (!fs.existsSync(financeMlTrainScript)) {
    throw new Error('Finance ML train script not found.');
  }
  if (!fs.existsSync(marketDataDir)) {
    fs.mkdirSync(marketDataDir, { recursive: true });
  }
  if (!fs.existsSync(mlDir)) {
    fs.mkdirSync(mlDir, { recursive: true });
  }

  const requestedCsv = String(input.inputCsv || '').trim();
  const safeCsvName = requestedCsv ? path.basename(requestedCsv) : 'ohlcv_sample.csv';
  const inputCsvPath = path.join(marketDataDir, safeCsvName);
  if (!fs.existsSync(inputCsvPath)) {
    throw new Error(`Input CSV not found: data/market/${safeCsvName}`);
  }

  const args = [
    financeMlTrainScript,
    '--input', inputCsvPath,
    '--model-out', financeMlModelFile,
    '--report-out', financeMlTrainReportFile
  ];

  const { stdout, stderr } = await execFileAsync('python', args, {
    cwd: basePath,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });

  if (stderr && String(stderr).trim()) {
    const maybeWarn = String(stderr).trim();
    if (!maybeWarn.toLowerCase().includes('warning')) {
      throw new Error(maybeWarn);
    }
  }

  const report = extractJsonObjectFromText(stdout);
  return {
    inputCsv: `data/market/${safeCsvName}`,
    modelFile: `data/ml/${path.basename(financeMlModelFile)}`,
    reportFile: `data/ml/${path.basename(financeMlTrainReportFile)}`,
    report
  };
}

app.post('/api/medical/analyze', (req, res) => {
  try {
    const age = toFiniteNumber(req.body?.age);
    if (age === null || age < 0 || age > 120) {
      return res.status(400).json({ error: 'age is required and must be between 0 and 120.' });
    }

    const result = analyzeMedicalRisk({
      age,
      diet: req.body?.diet || '',
      bloodPressure: req.body?.bloodPressure || {},
      bloodTests: req.body?.bloodTests || {},
      hereditary: req.body?.hereditary || {}
    });

    return res.json({ success: true, input: req.body || {}, analysis: result });
  } catch (error) {
    console.error('Medical analysis error:', error);
    return res.status(500).json({ error: 'Failed to analyze medical parameters.' });
  }
});

app.get('/api/models/catalog', (req, res) => {
  res.json({
    success: true,
    catalog: modelCatalog,
    usage:
      'POST /api/models/run with JSON: { "domain": "finance|defense", "modelId": "...", "inputs": { ... } }'
  });
});

app.post('/api/models/run', (req, res) => {
  try {
    const domain = String(req.body?.domain || '').trim().toLowerCase();
    const modelId = String(req.body?.modelId || '').trim().toLowerCase();
    const inputs = req.body?.inputs && typeof req.body.inputs === 'object' ? req.body.inputs : {};
    if (!domain || !modelId) {
      return res.status(400).json({ error: 'domain and modelId are required.' });
    }

    const result = runDomainModel(domain, modelId, inputs);
    return res.json({
      success: true,
      domain,
      modelId,
      result
    });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'Model execution failed.');
    if (msg.toLowerCase().includes('unknown') || msg.toLowerCase().includes('unsupported')) {
      return res.status(400).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/ml/finance/predict', async (req, res) => {
  try {
    const prediction = await runFinanceMlPrediction(req.body || {});
    return res.json({
      success: true,
      model: 'finance_direction_baseline_v1',
      prediction
    });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'ML prediction failed.');
    const lower = msg.toLowerCase();
    const isClientInput =
      lower.includes('required numbers') || lower.includes('not found');
    return res.status(isClientInput ? 400 : 500).json({ error: msg });
  }
});

app.post('/api/ml/finance/retrain', async (req, res) => {
  try {
    const result = await runFinanceMlRetrain(req.body || {});
    return res.json({
      success: true,
      model: 'finance_direction_baseline_v1',
      retrain: result
    });
  } catch (error) {
    const msg = String(error && error.message ? error.message : 'ML retrain failed.');
    const lower = msg.toLowerCase();
    const isClientInput = lower.includes('not found') || lower.includes('input csv');
    return res.status(isClientInput ? 400 : 500).json({ error: msg });
  }
});

// Get all chats (enriched for dashboard)
app.get('/api/chats', (req, res) => {
  const userId = getRequestUserId(req);
  const list = Object.values(chats).filter((c) => chatBelongsToUser(c, userId)).map(c => {
    const msgs = c.messages || [];
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    let lastPreview = '';
    if (lastMsg) {
      const raw = lastMsg.rawText || lastMsg.content || '';
      lastPreview = raw.length > 60 ? raw.substring(0, 60) + '...' : raw;
    }
    return {
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      createdAt: c.createdAt || c.updatedAt,
      messageCount: msgs.length,
      lastMessage: lastPreview
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

// Search chats
app.get('/api/chats/search', (req, res) => {
  const userId = getRequestUserId(req);
  const query = (req.query.q || '').toLowerCase().trim();
  if (!query) return res.json([]);
  const results = Object.values(chats)
    .filter((c) => chatBelongsToUser(c, userId))
    .filter(c => {
      if (c.title && c.title.toLowerCase().includes(query)) return true;
      return (c.messages || []).some(m => {
        const text = (m.rawText || m.content || '').toLowerCase();
        return text.includes(query);
      });
    })
    .map(c => {
      const msgs = c.messages || [];
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      let lastPreview = '';
      if (lastMsg) {
        const raw = lastMsg.rawText || lastMsg.content || '';
        lastPreview = raw.length > 60 ? raw.substring(0, 60) + '...' : raw;
      }
      return {
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        createdAt: c.createdAt || c.updatedAt,
        messageCount: msgs.length,
        lastMessage: lastPreview
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(results);
});

// Get specific chat
app.get('/api/chats/:id', (req, res) => {
  const userId = getRequestUserId(req);
  if (chats[req.params.id] && chatBelongsToUser(chats[req.params.id], userId)) {
    res.json(chats[req.params.id]);
  } else {
    res.status(404).json({ error: 'Chat not found' });
  }
});

// Rename chat
app.put('/api/chats/:id', (req, res) => {
  const userId = getRequestUserId(req);
  if (!chats[req.params.id] || !chatBelongsToUser(chats[req.params.id], userId)) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  const { title } = req.body;
  if (title && typeof title === 'string') {
    chats[req.params.id].title = title.trim().substring(0, 100);
    chats[req.params.id].updatedAt = Date.now();
    saveChats();
  }
  res.json({ success: true, title: chats[req.params.id].title });
});

// Delete chat
app.delete('/api/chats/:id', (req, res) => {
  const userId = getRequestUserId(req);
  if (chats[req.params.id] && chatBelongsToUser(chats[req.params.id], userId)) {
    delete chats[req.params.id];
    saveChats();
  }
  res.json({ success: true });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  let modelCallStartedAt = 0;
  try {
    const { message, attachments, chatId } = req.body;
    const userId = getRequestUserId(req);

    // Build the user message with attachment info
    let userContent = message || '';
    if (attachments && attachments.length > 0) {
      const attachmentInfo = attachments.map(a => `[Attached ${a.type}: ${a.name}]`).join('\n');
      userContent = `${attachmentInfo}\n\n${userContent}`;
    }

    if (!userContent.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    const projectedInputTokens = estimateTokens(userContent);
    const quotaCheck = checkUserQuota(userId, projectedInputTokens);
    if (!quotaCheck.allowed) {
      return res.status(429).json({
        error: quotaCheck.reason,
        userId,
        period: quotaCheck.usage.period,
        usage: {
          tokensUsed: quotaCheck.usage.tokensUsed,
          messagesUsed: quotaCheck.usage.messagesUsed
        },
        limits: {
          monthlyTokenLimit: quotaCheck.account.monthlyTokenLimit,
          monthlyMessageLimit: quotaCheck.account.monthlyMessageLimit
        }
      });
    }
    const preTokenLimit = Number(quotaCheck.account.monthlyTokenLimit || 0);
    const preMessageLimit = Number(quotaCheck.account.monthlyMessageLimit || 0);
    const preUsageTokens = Number(quotaCheck.usage.tokensUsed || 0);
    const preUsageMessages = Number(quotaCheck.usage.messagesUsed || 0);
    const preRemainingTokens = preTokenLimit > 0 ? Math.max(0, preTokenLimit - (preUsageTokens + projectedInputTokens)) : -1;
    const preRemainingMessages = preMessageLimit > 0 ? Math.max(0, preMessageLimit - (preUsageMessages + 1)) : -1;

    // Handle Chat ID initialization
    let id = chatId;
    if (id && chats[id] && !chatBelongsToUser(chats[id], userId)) {
      return res.status(403).json({ error: 'Chat does not belong to this user.' });
    }
    if (!id || !chats[id]) {
      id = Date.now().toString();
      // Generate a title from the first message
      const rawMsg = message || '';
      const title = rawMsg ? (rawMsg.length > 30 ? rawMsg.substring(0, 30) + '...' : rawMsg) : 'New Chat';
      chats[id] = { id, userId, title, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    }

    const currentChat = chats[id];
    currentChat.userId = currentChat.userId || userId;
    currentChat.updatedAt = Date.now();

    // Store rich data so frontend can rebuild UI
    currentChat.messages.push({
      id: makeMessageId(),
      role: 'user',
      content: userContent,
      rawText: message || '',
      attachments: attachments || []
    });
    saveChats();

    // Get history for Ollama context (up to 50 messages)
    let historyForOllama = currentChat.messages.map(m => ({ role: m.role, content: m.content }));
    if (historyForOllama.length > 50) {
      historyForOllama = historyForOllama.slice(-50);
    }

    const responseMode = detectResponseMode(userContent);
    console.log(`[response-mode] ${responseMode} | query="${(message || '').slice(0, 120)}"`);

    const ragHits = retrieveRag(userContent, 4);
    const webHits = await retrieveWebContext(userContent, 3);
    const ragContext = ragHits
      .map((hit, idx) => `(${idx + 1}) Source: ${hit.sourceName}\n${hit.text}`)
      .join('\n\n---\n\n');
    const webContext = webHits
      .map(
        (hit, idx) =>
          `(${idx + 1}) Title: ${hit.title}\nURL: ${hit.url}\nSnippet: ${hit.snippet}`
      )
      .join('\n\n---\n\n');
    const ragSystemPrompt = ragHits.length > 0
      ? `You have retrieved context snippets from the local knowledge base.\nUse them when relevant and cite source names like [source: filename].\nIf context is not relevant, ignore it.\n\n${ragContext}`
      : '';
    const webSystemPrompt = webHits.length > 0
      ? `You have retrieved live web snippets.\nPrioritize recent and relevant facts from these snippets.\nCite URLs in your answer when using web facts.\nIf snippets conflict, mention uncertainty briefly.\n\n${webContext}`
      : '';
    const responseModePrompt = responseMode === 'trend_compact'
      ? `Formatting policy (strict):
- Answer in exactly 3 bullet points.
- Each bullet must be one concise line.
- No intro paragraph and no outro paragraph.
- Prioritize today's most relevant technology trends.
- If web context is present, ground bullets in it and keep citations brief.`
      : '';

    const primaryModel =
      responseMode === 'trend_compact' ? modelPolicy.chat.trend : modelPolicy.chat.primary;
    const fallbackModel = modelPolicy.chat.fallback;

    // Call Groq API
    const groqPayload = {
      model: primaryModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(ragSystemPrompt ? [{ role: 'system', content: ragSystemPrompt }] : []),
        ...(webSystemPrompt ? [{ role: 'system', content: webSystemPrompt }] : []),
        ...(responseModePrompt ? [{ role: 'system', content: responseModePrompt }] : []),
        ...historyForOllama
      ],
      stream: true
    };
    if (responseMode === 'trend_compact') {
      groqPayload.max_tokens = 220;
    }

    modelCallStartedAt = Date.now();
    const completion = await createGroqChatCompletion(groqPayload, fallbackModel);
    const groqResponse = completion.response;
    const modelUsed = completion.modelUsed;
    recordModelCall({
      modelUsed,
      failover: Boolean(completion.failover),
      latencyMs: Date.now() - modelCallStartedAt,
      ok: true
    });

    const assistantMessage = {
      id: makeMessageId(),
      role: 'assistant',
      content: '',
      rag: ragHits,
      web: webHits,
      feedback: null
    };
    currentChat.messages.push(assistantMessage);
    saveChats();

    // Stream the response
    res.setHeader('X-Chat-Id', id);
    res.setHeader('X-Assistant-Message-Id', assistantMessage.id);
    res.setHeader('X-Response-Mode', responseMode);
    res.setHeader('X-Model-Used', modelUsed);
    res.setHeader('X-Quota-Period', quotaCheck.usage.period);
    res.setHeader('X-Quota-Tokens-Used', String(preUsageTokens));
    res.setHeader('X-Quota-Messages-Used', String(preUsageMessages));
    res.setHeader('X-Quota-Tokens-Remaining', String(preRemainingTokens));
    res.setHeader('X-Quota-Messages-Remaining', String(preRemainingMessages));
    res.setHeader('X-Rag-Sources', ragHits.map(h => h.sourceName).join(', '));
    res.setHeader('X-Web-Sources', webHits.map(h => h.url).join(', '));
    res.setHeader('Access-Control-Expose-Headers', 'X-Chat-Id, X-Assistant-Message-Id, X-Response-Mode, X-Model-Used, X-Rag-Sources, X-Web-Sources, X-Quota-Period, X-Quota-Tokens-Used, X-Quota-Messages-Used, X-Quota-Tokens-Remaining, X-Quota-Messages-Remaining');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullResponse = '';
    const reader = groqResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim().startsWith('data: '));

      for (const line of lines) {
        const dataStr = line.replace(/^data: /, '').trim();
        if (dataStr === '[DONE]') {
          res.write(`data: ${JSON.stringify({ content: '', done: true })}\n\n`);
          continue;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const content = parsed.choices[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
          }
        } catch (e) {
          // Skip unparseable lines
        }
      }
    }

    // Save assistant response to history
    assistantMessage.content = fullResponse;
    const outputTokens = estimateTokens(fullResponse);
    applyUsageDelta(userId, projectedInputTokens, outputTokens);
    saveChats();

    res.end();
  } catch (error) {
    if (modelCallStartedAt > 0) {
      recordModelCall({
        modelUsed: '',
        failover: false,
        latencyMs: Date.now() - modelCallStartedAt,
        ok: false,
        errorMessage: error && error.message ? error.message : 'Unknown model call failure'
      });
    }
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to get response from Mate AI. Make sure Ollama is running.' });
  }
});

app.get(`/api/platform/${PLATFORM_API_VERSION}/capabilities`, (req, res) => {
  res.json({
    product: 'Mate AI Platform',
    version: PLATFORM_API_VERSION,
    now: Date.now(),
    features: {
      sessions: true,
      chatAdapter: true,
      monitor: true
    },
    endpoints: {
      createSession: `/api/platform/${PLATFORM_API_VERSION}/sessions`,
      validateSession: `/api/platform/${PLATFORM_API_VERSION}/sessions/validate`,
      chat: `/api/platform/${PLATFORM_API_VERSION}/chat`,
      monitorSnapshot: '/api/health/live',
      monitorStream: '/api/monitor/stream'
    }
  });
});

app.post(`/api/platform/${PLATFORM_API_VERSION}/sessions`, (req, res) => {
  const productId = sanitizePlatformId(req.body?.productId || '');
  if (!productId) {
    return res.status(400).json({ error: 'productId is required.' });
  }
  const session = createPlatformSession({
    productId,
    userId: req.body?.userId || 'guest',
    workspaceId: req.body?.workspaceId || '',
    scopes: req.body?.scopes,
    metadata: req.body?.metadata
  });
  res.json({
    success: true,
    sessionId: session.sessionId,
    token: session.token,
    expiresAt: session.expiresAt,
    mount: {
      baseUrl: '/',
      capabilities: `/api/platform/${PLATFORM_API_VERSION}/capabilities`,
      chat: `/api/platform/${PLATFORM_API_VERSION}/chat`,
      monitor: '/monitor',
      home: '/index.html'
    }
  });
});

app.get(`/api/platform/${PLATFORM_API_VERSION}/sessions/validate`, requirePlatformSession, (req, res) => {
  const session = req.platformSession;
  res.json({
    valid: true,
    session: {
      sessionId: session.sessionId,
      productId: session.productId,
      userId: session.userId,
      workspaceId: session.workspaceId,
      scopes: session.scopes,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    }
  });
});

app.post(`/api/platform/${PLATFORM_API_VERSION}/chat`, requirePlatformSession, async (req, res) => {
  try {
    const session = req.platformSession;
    const payload = {
      message: req.body?.message,
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
      chatId: req.body?.chatId,
      responseMode: req.body?.responseMode
    };

    if (!payload.message || typeof payload.message !== 'string') {
      return res.status(400).json({ error: 'message is required.' });
    }

    const localResponse = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.userId,
        'x-platform-product-id': session.productId
      },
      body: JSON.stringify(payload)
    });

    const responseText = await localResponse.text();
    res.status(localResponse.status);
    res.setHeader('Content-Type', localResponse.headers.get('content-type') || 'application/json');
    return res.send(responseText);
  } catch (error) {
    console.error('Platform chat adapter failed:', error);
    return res.status(500).json({ error: 'Platform chat adapter failed.' });
  }
});

app.get('/real-estate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'real_estate.html'));
});

app.get('/api/realestate/baselines', (req, res) => {
  res.json({
    updatedAt: Date.now(),
    states: REAL_ESTATE_GROWTH_BASELINE
  });
});

app.post('/api/realestate/analyze', (req, res) => {
  try {
    const result = analyzeRealEstateParcel(req.body || {});
    res.json({ success: true, result });
  } catch (error) {
    console.error('Real estate analyze failed:', error);
    res.status(500).json({ error: 'Failed to analyze land parcel.' });
  }
});

app.get('/api/realestate/parcels', (req, res) => {
  const userId = sanitizeUserId(req.query.userId || 'guest');
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30)));
  const parcels = Object.values(realEstateStore.parcels || {})
    .filter((p) => sanitizeUserId(p.userId || 'guest') === userId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, limit);
  res.json({ count: parcels.length, parcels });
});

app.get('/api/realestate/parcels/:id', (req, res) => {
  const id = String(req.params.id || '');
  const parcel = realEstateStore.parcels[id];
  if (!parcel) return res.status(404).json({ error: 'Parcel not found.' });
  res.json({ parcel });
});

app.post('/api/realestate/parcels', (req, res) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || 'guest');
    const id = String(req.body?.id || `parcel_${Date.now()}_${Math.floor(Math.random() * 1e6)}`).slice(0, 80);
    const locationInput = req.body?.location && typeof req.body.location === 'object' ? req.body.location : {};
    const polygon = sanitizePolygon(req.body?.polygon);
    const centroid = getPolygonCentroid(polygon, {
      lat: clampNumber(locationInput.lat, -90, 90, 0),
      lng: clampNumber(locationInput.lng, -180, 180, 0)
    });
    const payloadForAnalysis = {
      location: {
        state: String(locationInput.state || '').slice(0, 80),
        district: String(locationInput.district || '').slice(0, 120),
        lat: centroid.lat,
        lng: centroid.lng
      },
      geoFence: req.body?.geoFence && typeof req.body.geoFence === 'object' ? req.body.geoFence : {}
    };
    const analysis = analyzeRealEstateParcel(payloadForAnalysis);
    const now = Date.now();

    const nextParcel = {
      id,
      userId,
      name: String(req.body?.name || '').slice(0, 160) || `Parcel ${new Date(now).toLocaleDateString()}`,
      location: payloadForAnalysis.location,
      geoFence: payloadForAnalysis.geoFence,
      polygon,
      polygonAreaSqm: Math.round(estimatePolygonAreaSqm(polygon) * 100) / 100,
      analysis,
      createdAt: realEstateStore.parcels[id]?.createdAt || now,
      updatedAt: now
    };
    realEstateStore.parcels[id] = nextParcel;
    saveRealEstateStore();
    res.json({ success: true, parcel: nextParcel });
  } catch (error) {
    console.error('Real estate parcel save failed:', error);
    res.status(500).json({ error: 'Failed to save parcel.' });
  }
});

app.get('/api/realestate/parcels/:id/report/download', (req, res) => {
  const id = String(req.params.id || '');
  const parcel = realEstateStore.parcels[id];
  if (!parcel) return res.status(404).json({ error: 'Parcel not found.' });
  const report = toDueDiligenceReport(parcel);
  const fileName = `due_diligence_${id}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(report);
});

app.get('/monitor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
});

app.get('/api/health/live', (req, res) => {
  const snapshot = getLiveMonitorSnapshot();
  updateMonitorSeries(snapshot);
  res.json(snapshot);
});

app.get('/api/monitor/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  monitorClients.add(res);
  const initial = getLiveMonitorSnapshot();
  updateMonitorSeries(initial);
  res.write(`data: ${JSON.stringify(initial)}\n\n`);

  req.on('close', () => {
    monitorClients.delete(res);
  });
});

app.post('/api/alerts/test', async (req, res) => {
  try {
    const to = String(req.body?.to || ALERT_EMAIL_TO || '').trim();
    const title = String(req.body?.title || 'Mate AI Test Alert').trim();
    const text = String(req.body?.text || 'This is a test alert from Mate AI monitoring.').trim();
    if (!to) {
      return res.status(400).json({ error: 'Missing email recipient. Pass { "to": "you@example.com" }.' });
    }
    const sent = await sendEmailViaSmtp({ to, subject: title, text, html: '' });
    res.json({ success: true, sent });
  } catch (error) {
    res.status(400).json({ error: String(error && error.message ? error.message : 'Alert test failed') });
  }
});

app.get('/api/rag/status', (req, res) => {
  const sources = Object.keys(ragStore.bySource);
  res.json({
    sources: sources.length,
    chunks: ragStore.chunks.length,
    sourceIds: sources.slice(0, 100),
    updatedAt: ragStore.updatedAt
  });
});

setInterval(() => {
  const snapshot = getLiveMonitorSnapshot();
  updateMonitorSeries(snapshot);
  maybeTriggerMonitorAlert(snapshot);
}, 15 * 1000);

setInterval(() => {
  if (monitorClients.size === 0) return;
  const snapshot = getLiveMonitorSnapshot();
  updateMonitorSeries(snapshot);
  broadcastMonitorSnapshot(snapshot);
}, 2 * 1000);

setInterval(() => {
  cleanupPlatformSessions();
}, 60 * 1000);

setInterval(() => {
  flushMonitorStoreIfDirty(false);
}, 30 * 1000);

process.on('beforeExit', () => {
  flushMonitorStoreIfDirty(true);
});

process.on('SIGINT', () => {
  flushMonitorStoreIfDirty(true);
  process.exit(0);
});

process.on('SIGTERM', () => {
  flushMonitorStoreIfDirty(true);
  process.exit(0);
});

app.get('/api/web/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing query parameter: q' });
  }
  try {
    const hits = await retrieveWebContext(q, 5);
    res.json({ query: q, count: hits.length, results: hits });
  } catch (e) {
    res.status(500).json({ error: 'Web search failed' });
  }
});

app.get('/api/google/profile/config', (req, res) => {
  const cfg = getGoogleOAuthConfig();
  res.json({
    configured: isGoogleConfigured(),
    connected: Boolean(googleTokens && googleTokens.access_token),
    redirectUri: cfg.redirectUri,
    updatedAt: googleProfile.updatedAt || 0
  });
});

app.get('/api/google/profile/auth-url', (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(400).json({
      error:
        'Google OAuth is not configured with valid credentials. Set real GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.'
    });
  }
  const { url } = makeGoogleAuthUrl();
  res.json({ url });
});

app.get('/api/google/oauth/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const oauthError = String(req.query.error || '');

    if (oauthError) {
      return res.status(400).send(`Google OAuth failed: ${oauthError}`);
    }
    if (!code || !state) {
      return res.status(400).send('Missing code/state from Google OAuth callback.');
    }
    const stateCreatedAt = googleOAuthState.get(state);
    googleOAuthState.delete(state);
    if (!stateCreatedAt || Date.now() - stateCreatedAt > 15 * 60 * 1000) {
      return res.status(400).send('Invalid or expired OAuth state. Please reconnect from the app.');
    }

    const tokens = await exchangeGoogleCodeForToken(code);
    saveGoogleTokens(tokens);
    await fetchGoogleProfile();
    return res.redirect('/?profile=connected');
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    const msg = String(error && error.message ? error.message : '');
    if (msg.includes('invalid_client')) {
      return res
        .status(400)
        .send(
          'Google OAuth client is invalid. Update data/google_oauth.json with a real Web OAuth client_id/client_secret and exact redirect URI: http://localhost:3000/api/google/oauth/callback'
        );
    }
    return res.status(500).send('Google connection failed. Check server logs.');
  }
});

app.get('/api/google/profile', (req, res) => {
  res.json({
    configured: isGoogleConfigured(),
    connected: Boolean(googleTokens && googleTokens.access_token),
    updatedAt: googleProfile.updatedAt || 0,
    profile: googleProfile || {}
  });
});

app.post('/api/google/profile/sync', async (req, res) => {
  try {
    if (!isGoogleConfigured()) {
      return res.status(400).json({ error: 'Google OAuth not configured.' });
    }
    if (!googleTokens || !googleTokens.access_token) {
      return res.status(401).json({ error: 'Google account not connected.' });
    }
    const profile = await fetchGoogleProfile();
    res.json({
      success: true,
      email: profile.email || '',
      updatedAt: googleProfile.updatedAt || Date.now()
    });
  } catch (error) {
    console.error('Google profile sync failed:', error);
    res.status(500).json({ error: 'Google profile sync failed.' });
  }
});

app.post('/api/google/profile/photo', upload.single('photo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'photo is required' });
    }
    const mime = String(req.file.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files are allowed' });
    }
    googleProfile.customPicture = `/uploads/${req.file.filename}`;
    saveGoogleProfile();
    res.json({ success: true, customPicture: googleProfile.customPicture });
  } catch (error) {
    console.error('Google profile photo upload failed:', error);
    res.status(500).json({ error: 'Profile photo upload failed.' });
  }
});

app.post('/api/google/profile/disconnect', (req, res) => {
  saveGoogleTokens(null);
  googleProfile = { name: '', email: '', picture: '', customPicture: '', updatedAt: Date.now() };
  saveGoogleProfile();
  res.json({ success: true });
});

app.get('/api/admin/email/config', (req, res) => {
  const cfg = loadSmtpConfig();
  res.json({
    configured: isSmtpConfigured(cfg),
    host: cfg.host || '',
    port: cfg.port || 0,
    secure: Boolean(cfg.secure),
    from: cfg.from || ''
  });
});

app.post('/api/admin/send-email', async (req, res) => {
  try {
    const to = req.body?.to;
    const subject = req.body?.subject;
    const text = req.body?.text;
    const html = req.body?.html;
    const result = await sendEmailViaSmtp({ to, subject, text, html });
    res.json({ success: true, ...result });
  } catch (error) {
    const message = String(error && error.message ? error.message : 'Email send failed');
    res.status(400).json({ error: message });
  }
});

app.get('/api/admin/users', (req, res) => {
  const period = String(req.query.period || getCurrentPeriodKey());
  const users = Object.values(userQuotaStore.users || {}).map((u) => {
    const usage = getUserUsage(u.userId, period);
    return {
      userId: u.userId,
      plan: u.plan || 'free',
      active: Boolean(u.active),
      monthlyTokenLimit: Number(u.monthlyTokenLimit || 0),
      monthlyMessageLimit: Number(u.monthlyMessageLimit || 0),
      usage: {
        period,
        tokensUsed: Number(usage.tokensUsed || 0),
        messagesUsed: Number(usage.messagesUsed || 0)
      }
    };
  });
  res.json({ count: users.length, period, users });
});

app.post('/api/admin/users/upsert', (req, res) => {
  const userId = sanitizeUserId(req.body?.userId || req.body?.email || '');
  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }
  const account = ensureUserAccount(userId);
  if (typeof req.body?.plan === 'string') {
    account.plan = String(req.body.plan).trim().slice(0, 40) || account.plan;
  }
  if (typeof req.body?.active !== 'undefined') {
    account.active = Boolean(req.body.active);
  }
  if (typeof req.body?.monthlyTokenLimit !== 'undefined') {
    const v = Number(req.body.monthlyTokenLimit);
    if (!Number.isFinite(v) || v < 0) {
      return res.status(400).json({ error: 'monthlyTokenLimit must be a non-negative number.' });
    }
    account.monthlyTokenLimit = v;
  }
  if (typeof req.body?.monthlyMessageLimit !== 'undefined') {
    const v = Number(req.body.monthlyMessageLimit);
    if (!Number.isFinite(v) || v < 0) {
      return res.status(400).json({ error: 'monthlyMessageLimit must be a non-negative number.' });
    }
    account.monthlyMessageLimit = v;
  }
  account.updatedAt = Date.now();
  saveUserQuotaStore();
  res.json({ success: true, account });
});

app.get('/api/admin/quota/summary', (req, res) => {
  const userId = sanitizeUserId(req.query.userId || '');
  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required.' });
  }
  const account = ensureUserAccount(userId);
  const usage = getUserUsage(userId, String(req.query.period || getCurrentPeriodKey()));
  const tokenLimit = Number(account.monthlyTokenLimit || 0);
  const messageLimit = Number(account.monthlyMessageLimit || 0);
  res.json({
    userId,
    plan: account.plan || 'free',
    active: Boolean(account.active),
    period: usage.period,
    limits: {
      monthlyTokenLimit: tokenLimit,
      monthlyMessageLimit: messageLimit
    },
    usage: {
      tokensUsed: Number(usage.tokensUsed || 0),
      messagesUsed: Number(usage.messagesUsed || 0),
      tokensRemaining: tokenLimit > 0 ? Math.max(0, tokenLimit - Number(usage.tokensUsed || 0)) : -1,
      messagesRemaining: messageLimit > 0 ? Math.max(0, messageLimit - Number(usage.messagesUsed || 0)) : -1
    }
  });
});

app.post('/api/admin/quota/reset', (req, res) => {
  const userId = sanitizeUserId(req.body?.userId || '');
  const period = String(req.body?.period || getCurrentPeriodKey());
  if (userId) {
    const key = `${userId}:${period}`;
    delete userQuotaStore.usage[key];
  } else {
    for (const key of Object.keys(userQuotaStore.usage || {})) {
      if (key.endsWith(`:${period}`)) {
        delete userQuotaStore.usage[key];
      }
    }
  }
  saveUserQuotaStore();
  res.json({ success: true, period, userId: userId || null });
});

app.get('/api/cloud/status', (req, res) => {
  const cfg = loadAwsS3Config();
  res.json({
    configured: Boolean(cfg.region && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey),
    region: cfg.region || '',
    bucket: cfg.bucket || '',
    prefix: cfg.prefix || 'mate-ai'
  });
});

app.post('/api/cloud/push', async (req, res) => {
  try {
    const requested = Array.isArray(req.body?.files) ? req.body.files : [];
    const defaultFiles = [
      'data/chats.json',
      'data/rag_store.json',
      'data/google_profile.json',
      'data/user_quota.json'
    ];
    const files = requested.length > 0 ? requested : defaultFiles;
    const result = await pushDataFilesToS3(files);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Cloud push failed:', error);
    res.status(500).json({ error: error.message || 'Cloud push failed.' });
  }
});

app.get('/api/db/engines', (req, res) => {
  const store = loadDbConnections();
  res.json({
    supported: ['postgres', 'mysql', 'sqlite'],
    configured: {
      postgres: Array.isArray(store.postgres) ? store.postgres.map((c) => c.id).filter(Boolean) : [],
      mysql: Array.isArray(store.mysql) ? store.mysql.map((c) => c.id).filter(Boolean) : [],
      sqlite: Array.isArray(store.sqlite) ? store.sqlite.map((c) => c.id).filter(Boolean) : []
    }
  });
});

app.post('/api/db/execute', async (req, res) => {
  try {
    const engine = String(req.body?.engine || '').toLowerCase();
    const query = String(req.body?.query || '');
    const params = Array.isArray(req.body?.params) ? req.body.params : [];
    const connectionId = String(req.body?.connectionId || '');
    const allowWrite = Boolean(req.body?.allowWrite);
    const config = getConnectionConfig(engine, connectionId, req.body?.config);

    if (!engine || !query) {
      return res.status(400).json({ error: 'engine and query are required.' });
    }
    if (!config) {
      return res.status(400).json({ error: 'No DB connection config found. Add data/db_connections.json or pass config.' });
    }
    if (!allowWrite && !isReadOnlySql(query)) {
      return res.status(400).json({
        error: 'Only read-only SQL is allowed by default. Send allowWrite=true to run write queries.'
      });
    }

    const result = await executeSql(engine, config, query, params);
    res.json({ success: true, engine, ...result });
  } catch (error) {
    console.error('DB execute failed:', error);
    res.status(500).json({ error: error.message || 'DB execute failed.' });
  }
});

app.get('/api/system/stack', (req, res) => {
  try {
    let dependencies = {};
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      dependencies = pkg.dependencies || {};
    } catch (e) {
      dependencies = {};
    }

    const extractedSources = Object.keys(ragStore.bySource || {}).map((sourceId) => ({
      sourceId,
      chunkCount: (ragStore.bySource[sourceId] || []).length
    }));
    const uploadFiles = getUploadSummary();
    const outsourcedDomains = getOutsourcedDomainsFromChats();
    const ollama = getOllamaStatus();
    const groq = {
      enabled: Boolean(GROQ_API_KEY),
      provider: modelPolicy.provider,
      modelPrimary: modelPolicy.chat.primary,
      modelTrend: modelPolicy.chat.trend,
      modelFallback: modelPolicy.chat.fallback
    };

    res.json({
      app: {
        name: 'Mate AI',
        runtime: `Node ${process.version}`
      },
      libraries: dependencies,
      providers: {
        groq,
        ollama
      },
      training: {
        teacherModel: modelPolicy.training.teacherModel,
        baseFamily: modelPolicy.training.baseFamily
      },
      quotas: {
        enabled: true,
        freeDefaults: userQuotaStore.defaults?.free || {},
        trackedUsers: Object.keys(userQuotaStore.users || {}).length
      },
      extensions: [
        { name: 'Groq Chat Completions API', enabled: true },
        { name: 'Web RAG (DuckDuckGo + page extraction)', enabled: true },
        { name: 'Local RAG (upload chunk indexing)', enabled: true },
        { name: 'Feedback Capture (thumbs up/down)', enabled: true },
        { name: 'Google Account Link + Profile Media', enabled: isGoogleConfigured() },
        { name: 'Cloud Push (AWS S3)', enabled: true },
        { name: 'Multi-DB SQL Execute (Postgres/MySQL/SQLite)', enabled: true },
        { name: 'Domain Model Engine (Finance + Defense Learning)', enabled: true },
        { name: 'Finance ML Inference API (Python baseline)', enabled: fs.existsSync(financeMlModelFile) },
        { name: 'Experimental Parameter Loader + Validator', enabled: true },
        { name: 'PWA Service Worker Cache', enabled: true }
      ],
      experimental: {
        totalKeys: Object.keys(experimentalParams || {}).length,
        params: experimentalParams
      },
      extracted: {
        totalSources: extractedSources.length,
        totalChunks: ragStore.chunks.length,
        sources: extractedSources.slice(0, 200),
        uploads: uploadFiles
      },
      outsourced: {
        webDomainsCount: outsourcedDomains.length,
        webDomains: outsourcedDomains
      },
      updatedAt: Date.now()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to build stack summary' });
  }
});

// Save feedback on assistant message quality for future training
app.post('/api/chats/:id/feedback', (req, res) => {
  const userId = getRequestUserId(req);
  const chat = chats[req.params.id];
  if (!chat || !chatBelongsToUser(chat, userId)) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const { messageId, rating, issueType, notes, preferredAnswer } = req.body || {};
  const allowedRatings = new Set(['up', 'down']);
  if (!allowedRatings.has(rating)) {
    return res.status(400).json({ error: 'Invalid rating' });
  }
  if (!messageId || typeof messageId !== 'string') {
    return res.status(400).json({ error: 'messageId is required' });
  }

  const msg = (chat.messages || []).find((m) => m.id === messageId && m.role === 'assistant');
  if (!msg) {
    return res.status(404).json({ error: 'Assistant message not found' });
  }

  msg.feedback = {
    rating,
    issueType: typeof issueType === 'string' ? issueType.slice(0, 80) : '',
    notes: typeof notes === 'string' ? notes.slice(0, 500) : '',
    preferredAnswer:
      typeof preferredAnswer === 'string' ? preferredAnswer.slice(0, 4000) : '',
    at: Date.now()
  };
  chat.updatedAt = Date.now();
  saveChats();

  res.json({ success: true });
});

// File upload endpoint
app.post('/api/upload', upload.array('files', 10), (req, res) => {
  try {
    const files = req.files.map(file => {
      let indexed = false;
      let chunks = 0;
      let indexError = '';

      if (isTextFile(file)) {
        try {
          const fileText = fs.readFileSync(path.join(uploadsDir, file.filename), 'utf8');
          chunks = ingestRagDocument(file.filename, file.originalname, fileText);
          indexed = chunks > 0;
        } catch (e) {
          indexError = 'Could not parse as UTF-8 text';
        }
      }

      return {
        name: file.originalname,
        path: `/uploads/${file.filename}`,
        type: file.mimetype,
        size: file.size,
        ragIndexed: indexed,
        ragChunks: chunks,
        ragError: indexError
      };
    });
    res.json({ files });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});



// --- AGENTOS bridge proxy (keeps Agent OS separate) ---
app.post('/api/agentos/goal', async (req, res) => {
  try {
    const deviceId = sanitizePlatformId(req.body?.deviceId || '');
    const goal = String(req.body?.goal || '').trim();
    if (!deviceId || !goal) {
      return res.status(400).json({ error: 'deviceId and goal are required' });
    }
    const payload = {
      goal,
      plan: typeof req.body?.plan === 'string' ? req.body.plan.slice(0, 4000) : null,
      safety:
        req.body?.safety && typeof req.body.safety === 'object' && !Array.isArray(req.body.safety)
          ? req.body.safety
          : {}
    };
    const data = await bridgeFetch(`/api/agentos/devices/${deviceId}/goal`, payload, 'POST');
    res.json({ success: true, bridge: data });
  } catch (error) {
    console.error('AgentOS goal proxy error:', error);
    res.status(500).json({ error: error.message || 'AgentOS bridge error' });
  }
});

app.get('/api/agentos/devices', async (_req, res) => {
  try {
    const data = await bridgeFetch('/api/agentos/devices', null, 'GET');
    res.json({ success: true, bridge: data });
  } catch (error) {
    console.error('AgentOS list proxy error:', error);
    res.status(500).json({ error: error.message || 'AgentOS bridge error' });
  }
});

app.get('/api/agentos/devices/:id/telemetry', async (req, res) => {
  try {
    const deviceId = sanitizePlatformId(req.params.id || '');
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    const data = await bridgeFetch(`/api/agentos/devices/${deviceId}/telemetry`, null, 'GET');
    res.json({ success: true, bridge: data });
  } catch (error) {
    console.error('AgentOS telemetry proxy error:', error);
    res.status(500).json({ error: error.message || 'AgentOS bridge error' });
  }
});

// --- KubeOrbit live status via kubectl (falls back to placeholder if kubectl fails) ---
app.get('/api/kubeorbit/status', (_req, res) => {
  const context = process.env.KUBEORBIT_CONTEXT || '';
  const kube = (args) => {
    const base = ['kubectl'];
    if (context) base.push('--context', context);
    base.push(...args);
    try {
      const out = execSync(base.join(' '), { encoding: 'utf8' });
      return JSON.parse(out);
    } catch (e) {
      return null;
    }
  };

  const nodes = kube(['get', 'nodes', '-o', 'json']);
  const pods = kube(['get', 'pods', '-A', '-o', 'json']);
  const deploys = kube(['get', 'deploy', '-A', '-o', 'json']);
  const services = kube(['get', 'svc', '-A', '-o', 'json']);

  if (!nodes || !pods) {
    // fallback placeholder
    const jitter = (base, span) => Math.max(0, Math.round(base + (Math.random() - 0.5) * span));
    return res.json({
      cluster: {
        name: process.env.KUBEORBIT_CLUSTER || 'kubeorbit-local',
        context: context || 'n/a',
        region: process.env.KUBEORBIT_REGION || 'local',
        nodes: 1,
        cpuAllocPct: jitter(40, 12),
        memAllocPct: jitter(45, 12),
        podsRunning: jitter(5, 4),
        podsFailed: jitter(0, 1),
        deployments: 2,
        services: 2,
        updatedAt: Date.now()
      },
      workloads: []
    });
  }

  const nodeCount = (nodes.items || []).length;
  const podsRunning = (pods.items || []).filter(p => (p.status?.phase || '').toLowerCase() === 'running').length;
  const podsFailed = (pods.items || []).filter(p => (p.status?.phase || '').toLowerCase() === 'failed').length;
  const deployments = (deploys?.items || []).length;
  const svcCount = (services?.items || []).length;

  const workloads = (deploys?.items || []).map(d => {
    const ready = d.status?.readyReplicas || 0;
    const replicas = d.status?.replicas || 0;
    const failing = d.status?.unavailableReplicas || 0;
    return {
      name: d.metadata?.name || 'deployment',
      ns: d.metadata?.namespace || 'default',
      replicas,
      ready,
      image: d.spec?.template?.spec?.containers?.[0]?.image || 'unknown',
      status: ready === replicas && failing === 0 ? 'Running' : 'Degraded',
      failing
    };
  }).slice(0, 30); // cap for UI

  res.json({
    cluster: {
      name: process.env.KUBEORBIT_CLUSTER || (nodes?.metadata?.name || 'kubeorbit'),
      context: context || 'current',
      region: process.env.KUBEORBIT_REGION || 'local',
      nodes: nodeCount,
      cpuAllocPct: null, // not from kubectl without metrics-server
      memAllocPct: null,
      podsRunning,
      podsFailed,
      deployments,
      services: svcCount,
      updatedAt: Date.now()
    },
    workloads
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🤖 Mate AI is live!`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
  console.log(`💡 Make sure Ollama is running (ollama serve)\n`);
});
