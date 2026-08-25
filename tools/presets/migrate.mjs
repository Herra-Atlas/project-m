// One-shot migration script: convert flat preset JSON files in
// tools/presets/*.json into per-macro folders under tools/presets/<id>/,
// each containing macro.json + ai-chat.json + logs.jsonl.
//
// Field shape in old files was inconsistent: some use `title`, some use
// `name`. The current app expects `title`. We normalise on read.
//
// Run with: node tools/presets/migrate.mjs
//
// Safe to run repeatedly — it skips folders whose macro.json already
// matches what we'd write.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

const files = fs
  .readdirSync(root)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => f !== 'package.json');

let migrated = 0;
let skipped = 0;

for (const file of files) {
  const filePath = path.join(root, file);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  // Normalise legacy `name` → `title`.
  if (typeof raw.title !== 'string' && typeof raw.name === 'string') {
    raw.title = raw.name;
  }
  delete raw.name;
  delete raw.exportedAt; // not used by the runtime

  // Derive an id from the filename if missing.
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    raw.id = path.basename(file, '.json');
  }

  if (typeof raw.title !== 'string' || raw.title.length === 0) {
    console.error(`SKIP ${file}: no title or name field`);
    skipped++;
    continue;
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.connections)) {
    console.error(`SKIP ${file}: missing nodes/connections arrays`);
    skipped++;
    continue;
  }

  const id = raw.id;
  const folder = path.join(root, id);
  const target = path.join(folder, 'macro.json');

  // Skip if existing macro.json already has the same id+title.
  if (fs.existsSync(target)) {
    try {
      const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (existing.id === raw.id && existing.title === raw.title) {
        console.log(`SKIP ${file}: already migrated at ${path.relative(process.cwd(), target)}`);
        continue;
      }
    } catch {
      // fall through to overwrite
    }
  }

  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(target, JSON.stringify(raw, null, 2) + '\n');

  // Seed empty ai-chat.json + logs.jsonl so the folder is self-contained.
  const chatPath = path.join(folder, 'ai-chat.json');
  if (!fs.existsSync(chatPath)) {
    fs.writeFileSync(
      chatPath,
      JSON.stringify({ version: 1, messages: [] }, null, 2) + '\n',
    );
  }
  const logsPath = path.join(folder, 'logs.jsonl');
  if (!fs.existsSync(logsPath)) {
    fs.writeFileSync(logsPath, '');
  }
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });

  // Remove the flat file only if the migration succeeded.
  fs.unlinkSync(filePath);

  console.log(`MIGRATED ${file} -> ${path.relative(process.cwd(), folder)}/`);
  migrated++;
}

console.log(`\nDone. migrated=${migrated} skipped=${skipped}`);