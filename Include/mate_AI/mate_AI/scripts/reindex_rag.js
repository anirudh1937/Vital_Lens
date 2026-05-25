const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const RAG_FILE = path.join(DATA_DIR, 'rag_store.json');

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

function isTextPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.txt', '.md', '.json', '.csv', '.log', '.html', '.xml'].includes(ext);
}

function main() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log('No uploads directory found.');
    return;
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const files = fs.readdirSync(UPLOADS_DIR);
  const ragStore = { chunks: [], bySource: {}, updatedAt: Date.now() };
  let indexedFiles = 0;

  for (const name of files) {
    const full = path.join(UPLOADS_DIR, name);
    if (!fs.statSync(full).isFile()) continue;
    if (!isTextPath(full)) continue;

    let text = '';
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      continue;
    }
    const chunks = chunkText(text);
    if (chunks.length === 0) continue;

    ragStore.bySource[name] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const id = `${name}:${i}`;
      ragStore.chunks.push({
        id,
        sourceId: name,
        sourceName: name,
        text: chunks[i],
        tokenCount: tokenize(chunks[i]).length,
        createdAt: Date.now()
      });
      ragStore.bySource[name].push(id);
    }
    indexedFiles += 1;
  }

  fs.writeFileSync(RAG_FILE, JSON.stringify(ragStore, null, 2));
  console.log(`RAG reindex complete: files=${indexedFiles}, chunks=${ragStore.chunks.length}`);
}

main();
