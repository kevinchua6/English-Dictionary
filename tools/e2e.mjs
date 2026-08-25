/**
 * End-to-end search test over HTTP, driving the same search-core module the
 * browser uses. Usage: node tools/e2e.mjs [baseUrl]
 */
import http from 'node:http';
import fs from 'node:fs';
import { lookup, variants, shardFile } from '../web/search-core.js';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8777';

/** Minimal GET-as-JSON; this Node build predates global fetch. */
function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

const manifest = await getJson(`${BASE}/dict/manifest.json`);
const irregular = JSON.parse(fs.readFileSync('web/irregular.json', 'utf8'));
delete irregular._comment;

const shardCache = new Map();
const loadShard = (name) => {
  if (!shardCache.has(name)) {
    shardCache.set(name, getJson(`${BASE}/dict/${shardFile(name)}.json`).catch(() => ({})));
  }
  return shardCache.get(name);
};
const ctx = { manifest, irregular, loadShard };

/** [query, expected Japanese word that must appear somewhere in the result] */
const TESTS = [
  ['run', '走る'],
  ['running', null],
  ['ran', '走る'],
  ['beautiful', '美しい'],
  ['charge', null],
  ['commitment', null],
  ['to run', '走る'],
  ['cats', '猫'],
  ['studies', null],
  ['happier', '幸せ'],
  ['quickly', null],
  ['computer', 'コンピュータ'],
  ['water', '水'],
  ['go', '行く'],
  ['went', '行く'],
  ['children', '子供'],
  ['better', null],
  ['take place', null],
  ['ate', '食べる'],
  ['swimming', '水泳'],
  ['the dog', '犬'],
  ['a book', '本'],
  ['stopped', '止まる'],
  ['making', '作る'],
  ['knives', 'ナイフ'],
];

/** Every Japanese word anywhere in a result document. */
function allWords(doc) {
  const out = new Set();
  for (const s of doc.sn ?? []) {
    for (const e of s.e ?? []) out.add(e.w);
    for (const w of s.jl ?? []) out.add(w);
  }
  for (const e of doc.o ?? []) out.add(e.w);
  return out;
}

let found = 0;
let passed = 0;
const failures = [];

for (const [query, expect] of TESTS) {
  const hit = await lookup(ctx, query);
  if (!hit) {
    console.log(`MISS  ${query}`);
    failures.push(`${query}: no result`);
    continue;
  }
  found++;

  const { doc, matched } = hit;
  const first = doc.sn?.[0];
  const jp = first?.e?.[0]?.w ?? first?.jl?.[0] ?? doc.o?.[0]?.w ?? '—';
  const via = matched !== hit.query ? ` (via "${matched}")` : '';

  let mark = 'OK  ';
  if (expect) {
    if (allWords(doc).has(expect)) passed++;
    else { mark = 'BAD '; failures.push(`${query}: expected ${expect}, got ${jp}`); }
  } else {
    passed++;
  }

  console.log(`${mark}  ${query.padEnd(12)} -> ${jp}   語義${doc.sn?.length ?? 0} その他${doc.o?.length ?? 0}${via}`);
  if (first?.jd) console.log(`         ${first.jd}`);
}

console.log(`\nresolved: ${found}/${TESTS.length}   assertions passed: ${passed}/${TESTS.length}`);

/* ------------------------------------------------------- example sentences */

// The point of keying examples on the English side is that the sentence is
// guaranteed to use the word. If that ever stops holding, the feature is worse
// than nothing -- it shows a learner a sentence without the word they looked up.
const EXAMPLE_TESTS = ['run', 'water', 'tired', 'angry', 'borrow', 'give up', 'holiday'];

console.log('\nexample sentences:');
let exChecked = 0;
for (const query of EXAMPLE_TESTS) {
  const hit = await lookup(ctx, query);
  const doc = hit?.doc;
  if (!doc?.x?.length) {
    failures.push(`${query}: no example sentences`);
    console.log(`MISS  ${query}`);
    continue;
  }
  for (const [ja, en] of doc.x) {
    exChecked++;
    const target = doc.w.split(' ');
    const tokens = en.toLowerCase().match(/[a-z']+/g) ?? [];
    const uses = tokens.some((tok, i) =>
      variants(tok, irregular).includes(target[0]) &&
      target.every((part, t) => t === 0 || tokens[i + t] === part));
    if (!uses) failures.push(`${query}: example does not use the word: ${en}`);
    if (!ja) failures.push(`${query}: example missing Japanese: ${en}`);
  }
  console.log(`OK    ${query.padEnd(12)} ${doc.x.length} 例文 | ${doc.x[0][1]}`);
}
console.log(`\nexample sentences checked: ${exChecked}`);
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\nOK');
