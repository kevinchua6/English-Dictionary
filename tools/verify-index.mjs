/**
 * Verify every headword is reachable by the client's shard resolution.
 *
 * The builder splits oversized shards to deeper prefixes; the client
 * independently re-derives which shard to fetch. If those two ever disagree,
 * words silently become unfindable, so check all of them.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'web/dict';
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

// --- client logic, copied verbatim from web/app.js ---
function bucket(word, depth) {
  const cleaned = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  let out = '';
  for (let i = 0; i < depth; i++) {
    const ch = cleaned[i];
    out += ch && /[a-z0-9]/.test(ch) ? ch : '_';
  }
  return out;
}
function shardFor(word) {
  for (let d = manifest.maxPrefix; d >= manifest.minPrefix; d--) {
    const b = bucket(word, d);
    if (manifest.shards[b] !== undefined) return b;
  }
  return null;
}

let checked = 0;
let unreachable = 0;
let missingFile = 0;
const samples = [];

for (const shardName of Object.keys(manifest.shards)) {
  const file = path.join(DIR, `${shardName}.json`);
  if (!fs.existsSync(file)) {
    missingFile++;
    console.log(`MISSING FILE: ${shardName}.json`);
    continue;
  }
  const docs = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const word of Object.keys(docs)) {
    checked++;
    const resolved = shardFor(word);
    if (resolved !== shardName) {
      unreachable++;
      if (samples.length < 10) samples.push(`"${word}" is in ${shardName} but resolves to ${resolved}`);
    }
  }
}

console.log(`headwords checked : ${checked.toLocaleString()}`);
console.log(`manifest total    : ${manifest.headwords.toLocaleString()}`);
console.log(`missing shard file: ${missingFile}`);
console.log(`UNREACHABLE       : ${unreachable.toLocaleString()}`);
for (const s of samples) console.log(`  ${s}`);

if (unreachable || missingFile || checked !== manifest.headwords) {
  console.log('\nFAIL');
  process.exit(1);
}
console.log('\nOK: every headword resolves to the shard it lives in.');
