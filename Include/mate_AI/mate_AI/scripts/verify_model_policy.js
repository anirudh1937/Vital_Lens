const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODEL_POLICY_FILE = path.join(ROOT, 'data', 'model_policy.json');
const KEY_FILE = path.join(ROOT, 'Groq_api_key.txt');

function readJsonSafe(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function getApiKey() {
  const envKey = String(process.env.GROQ_API_KEY || '').trim();
  if (envKey) return envKey;
  if (!fs.existsSync(KEY_FILE)) return '';
  return String(fs.readFileSync(KEY_FILE, 'utf8') || '').trim();
}

function collectRequiredModels(policy) {
  const required = new Set();
  const chat = policy && policy.chat && typeof policy.chat === 'object' ? policy.chat : {};
  const training = policy && policy.training && typeof policy.training === 'object' ? policy.training : {};
  for (const id of [chat.primary, chat.trend, chat.fallback, training.teacherModel]) {
    const modelId = String(id || '').trim();
    if (modelId) required.add(modelId);
  }
  return Array.from(required);
}

async function fetchGroqModelIds(apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq model catalog request failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const payload = await res.json();
  const rows = Array.isArray(payload && payload.data) ? payload.data : [];
  return rows
    .map((row) => String((row && row.id) || '').trim())
    .filter(Boolean);
}

async function main() {
  const policy = readJsonSafe(MODEL_POLICY_FILE, {});
  const requiredModels = collectRequiredModels(policy);
  if (requiredModels.length === 0) {
    console.error('Model policy has no model IDs. Update data/model_policy.json first.');
    process.exit(1);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('GROQ API key missing. Set GROQ_API_KEY or fill Groq_api_key.txt.');
    process.exit(1);
  }

  const available = new Set(await fetchGroqModelIds(apiKey));
  const missing = requiredModels.filter((id) => !available.has(id));

  if (missing.length > 0) {
    console.error('Model policy verification failed. These model IDs were not found in Groq catalog:');
    for (const id of missing) {
      console.error(`- ${id}`);
    }
    console.error('Update data/model_policy.json with currently available models.');
    process.exit(1);
  }

  console.log('Model policy verification passed.');
  console.log(`checked=${requiredModels.length}`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
