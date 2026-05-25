const { spawn } = require('child_process');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const baseUrl = 'http://127.0.0.1:3001';
const child = spawn(process.execPath, ['server.js'], {
  cwd,
  env: { ...process.env, PORT: '3001' },
  stdio: ['ignore', 'pipe', 'pipe']
});

child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));

function stop(code = 0) {
  if (!child.killed) child.kill();
  process.exit(code);
}

async function run() {
  await new Promise((resolve) => setTimeout(resolve, 1400));

  const htmlRes = await fetch(`${baseUrl}/real-estate`);
  if (!htmlRes.ok) throw new Error(`/real-estate failed: ${htmlRes.status}`);
  console.log('REALESTATE_PAGE_OK', htmlRes.status);

  const baselineRes = await fetch(`${baseUrl}/api/realestate/baselines`);
  if (!baselineRes.ok) throw new Error(`baselines failed: ${baselineRes.status}`);
  const baseline = await baselineRes.json();
  console.log('REALESTATE_BASELINE_OK', Boolean(baseline.states && baseline.states.default));

  const analyzeRes = await fetch(`${baseUrl}/api/realestate/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: { state: 'Telangana', district: 'Hyderabad', lat: 17.385, lng: 78.4867 },
      geoFence: {
        titleClear: true,
        legalDispute: false,
        ecoSensitive: false,
        forestZone: false,
        floodPlain: false,
        highwayAccessKm: 3,
        metroDistanceKm: 2,
        airportDistanceKm: 25,
        socialInfraScore: 80,
        upcomingProjectsScore: 83,
        utilityReadinessScore: 76,
        crimeRiskScore: 28,
        climateRiskScore: 30
      }
    })
  });
  if (!analyzeRes.ok) throw new Error(`analyze failed: ${analyzeRes.status}`);
  const analysis = await analyzeRes.json();
  const score = analysis && analysis.result && analysis.result.scoring
    ? analysis.result.scoring.suitabilityScore
    : 0;
  console.log('REALESTATE_ANALYZE_OK', score);

  const saveRes = await fetch(`${baseUrl}/api/realestate/parcels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'smoke-user',
      name: 'Smoke Parcel',
      location: { state: 'Telangana', district: 'Hyderabad', lat: 17.39, lng: 78.48 },
      polygon: [
        { lat: 17.39, lng: 78.48 },
        { lat: 17.391, lng: 78.483 },
        { lat: 17.388, lng: 78.485 }
      ],
      geoFence: {
        titleClear: true,
        legalDispute: false,
        ecoSensitive: false,
        forestZone: false,
        floodPlain: false,
        highwayAccessKm: 3,
        metroDistanceKm: 2,
        airportDistanceKm: 25,
        socialInfraScore: 80,
        upcomingProjectsScore: 83,
        utilityReadinessScore: 76,
        crimeRiskScore: 28,
        climateRiskScore: 30
      }
    })
  });
  if (!saveRes.ok) throw new Error(`parcel save failed: ${saveRes.status}`);
  const saved = await saveRes.json();
  const parcelId = saved && saved.parcel && saved.parcel.id ? saved.parcel.id : '';
  if (!parcelId) throw new Error('parcel id missing');
  console.log('REALESTATE_SAVE_OK', parcelId);

  const historyRes = await fetch(`${baseUrl}/api/realestate/parcels?userId=smoke-user`);
  if (!historyRes.ok) throw new Error(`history failed: ${historyRes.status}`);
  const history = await historyRes.json();
  const historyCount = Array.isArray(history.parcels) ? history.parcels.length : 0;
  console.log('REALESTATE_HISTORY_OK', historyCount);

  const reportRes = await fetch(`${baseUrl}/api/realestate/parcels/${parcelId}/report/download`);
  if (!reportRes.ok) throw new Error(`report failed: ${reportRes.status}`);
  const reportText = await reportRes.text();
  console.log('REALESTATE_REPORT_OK', reportText.includes('Due Diligence Report'));

  stop(0);
}

run().catch((err) => {
  console.error('REALESTATE_SMOKE_ERROR', err && err.message ? err.message : err);
  stop(1);
});

setTimeout(() => {
  console.error('REALESTATE_SMOKE_ERROR timeout waiting for checks');
  stop(1);
}, 15000);
