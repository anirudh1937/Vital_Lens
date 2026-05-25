const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TRAIN_FILE = path.join(ROOT, 'training_data', 'train.jsonl');
const VALID_FILE = path.join(ROOT, 'training_data', 'valid.jsonl');

const MIN_TRAIN_EXAMPLES = Number(process.env.MIN_TRAIN_EXAMPLES || 1);
const MIN_VALID_EXAMPLES = Number(process.env.MIN_VALID_EXAMPLES || 1);
const MIN_ASSISTANT_CHARS = Number(process.env.MIN_ASSISTANT_CHARS || 20);
const MAX_ASSISTANT_CHARS = Number(process.env.MAX_ASSISTANT_CHARS || 2500);

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function validateRows(rows, splitName) {
  const errors = [];

  rows.forEach((row, idx) => {
    if (!Array.isArray(row.messages) || row.messages.length < 2) {
      errors.push(`${splitName}[${idx}] invalid messages array`);
      return;
    }

    const assistant = row.messages[row.messages.length - 1];
    if (assistant.role !== 'assistant') {
      errors.push(`${splitName}[${idx}] last message must be assistant`);
      return;
    }

    const len = String(assistant.content || '').length;
    if (len < MIN_ASSISTANT_CHARS || len > MAX_ASSISTANT_CHARS) {
      errors.push(
        `${splitName}[${idx}] assistant length out of range (${len}, expected ${MIN_ASSISTANT_CHARS}-${MAX_ASSISTANT_CHARS})`
      );
    }
  });

  return errors;
}

function main() {
  const train = readJsonl(TRAIN_FILE);
  const valid = readJsonl(VALID_FILE);

  const errors = [
    ...validateRows(train, 'train'),
    ...validateRows(valid, 'valid')
  ];

  if (train.length < MIN_TRAIN_EXAMPLES) {
    errors.push(`train split too small: ${train.length} < ${MIN_TRAIN_EXAMPLES}`);
  }
  if (valid.length < MIN_VALID_EXAMPLES) {
    errors.push(`valid split too small: ${valid.length} < ${MIN_VALID_EXAMPLES}`);
  }

  if (errors.length > 0) {
    console.error('Quality gate failed:');
    for (const err of errors.slice(0, 25)) {
      console.error(`- ${err}`);
    }
    if (errors.length > 25) {
      console.error(`- ... and ${errors.length - 25} more`);
    }
    process.exit(1);
  }

  console.log('Quality gate passed.');
  console.log(`train=${train.length}, valid=${valid.length}`);
}

main();
