const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHAT_PATH = path.join(ROOT, 'data', 'chats.json');
const OUT_DIR = path.join(ROOT, 'training_data');
const OUT_FILE = path.join(OUT_DIR, 'preferences.jsonl');

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function main() {
  if (!fs.existsSync(CHAT_PATH)) {
    throw new Error(`Missing input file: ${CHAT_PATH}`);
  }
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const chats = JSON.parse(fs.readFileSync(CHAT_PATH, 'utf8'));
  const rows = [];

  for (const chat of Object.values(chats || {})) {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i];
      if (!msg || msg.role !== 'assistant' || !msg.feedback) continue;
      if (msg.feedback.rating !== 'down') continue;

      const preferred = normalize(msg.feedback.preferredAnswer);
      const rejected = normalize(msg.content);
      if (!preferred || !rejected) continue;

      const context = messages
        .slice(Math.max(0, i - 8), i)
        .map((m) => ({ role: m.role, content: normalize(m.content) }))
        .filter((m) => m.content);

      rows.push({
        chatId: chat.id || null,
        prompt: context,
        chosen: preferred,
        rejected
      });
    }
  }

  const lines = rows.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(OUT_FILE, lines ? `${lines}\n` : '', 'utf8');
  console.log(`Wrote ${rows.length} preference pairs to ${OUT_FILE}`);
}

main();
