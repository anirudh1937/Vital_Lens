const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const CHAT_PATH = path.join(DATA_DIR, 'chats.json');
const OUT_DIR = path.join(ROOT, 'training_data');

const TRAIN_RATIO = 0.9;
const MAX_SYSTEM_PROMPT_CHARS = 1000;
const INCLUDE_UNRATED = process.env.INCLUDE_UNRATED === '1';

function seededShuffle(arr, seed = 42) {
  let state = seed;
  const next = () => {
    state = (1664525 * state + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function buildExamples(chatsObj) {
  const chatList = Object.values(chatsObj || {});
  const examples = [];

  for (const chat of chatList) {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const context = [];

    for (const msg of messages) {
      const role = msg && msg.role;
      const content = normalize(msg && msg.content);
      if (!content || !role) continue;

      if (role === 'assistant') {
        const feedbackRating =
          msg && msg.feedback && typeof msg.feedback.rating === 'string'
            ? msg.feedback.rating
            : '';
        if (feedbackRating === 'down') {
          context.push({ role, content });
          continue;
        }
        if (!INCLUDE_UNRATED && feedbackRating !== 'up') {
          context.push({ role, content });
          continue;
        }

        const latestUser = [...context].reverse().find((m) => m.role === 'user');
        if (!latestUser) {
          context.push({ role, content });
          continue;
        }

        examples.push({
          chatId: chat.id || null,
          quality: feedbackRating === 'up' ? 'preferred' : 'unrated',
          messages: [
            {
              role: 'system',
              content: 'You are Mate AI. Be concise, practical, and honest. Keep a warm, brotherly tone.'
            },
            ...context.slice(-8),
            { role: 'assistant', content }
          ]
        });
      }

      context.push({ role, content });
    }
  }

  return examples;
}

function writeJsonl(filePath, rows) {
  const lines = rows.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(filePath, lines ? `${lines}\n` : '', 'utf8');
}

function main() {
  if (!fs.existsSync(CHAT_PATH)) {
    throw new Error(`Missing input file: ${CHAT_PATH}`);
  }

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const chatsObj = JSON.parse(fs.readFileSync(CHAT_PATH, 'utf8'));
  let examples = buildExamples(chatsObj);
  examples = examples.filter((ex) => {
    const assistant = ex.messages[ex.messages.length - 1];
    if (!assistant || assistant.role !== 'assistant') return false;
    const c = assistant.content || '';
    return c.length > 2 && c.length < MAX_SYSTEM_PROMPT_CHARS;
  });

  seededShuffle(examples);

  const splitIdx = Math.floor(examples.length * TRAIN_RATIO);
  const train = examples.slice(0, splitIdx);
  const valid = examples.slice(splitIdx);

  const trainPath = path.join(OUT_DIR, 'train.jsonl');
  const validPath = path.join(OUT_DIR, 'valid.jsonl');
  const statsPath = path.join(OUT_DIR, 'stats.json');

  writeJsonl(trainPath, train);
  writeJsonl(validPath, valid);
  fs.writeFileSync(
    statsPath,
    JSON.stringify(
      {
        totalExamples: examples.length,
        trainExamples: train.length,
        validExamples: valid.length,
        generatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Wrote ${train.length} train and ${valid.length} valid examples to ${OUT_DIR}`);
  if (!INCLUDE_UNRATED) {
    console.log('Used only feedback-rated "up" assistant messages. Set INCLUDE_UNRATED=1 to bootstrap.');
  }
}

main();
