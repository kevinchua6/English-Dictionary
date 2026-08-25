/**
 * Pass 3: merge JMdict postings with WordNet senses and shard for the client.
 *
 * JMdict supplies the Japanese words (with readings and commonness); WordNet
 * supplies the Japanese sense descriptions to group them under. An entry joins
 * a sense when one of its Japanese forms is also a lemma of that synset.
 *
 * Shards are named by the first two ASCII letters of the headword, so the
 * client fetches exactly one small file per lookup.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { shardFile } from '../web/search-core.js';

const OUT_DIR = 'web/dict';
const MAX_ENTRIES_PER_HEADWORD = 60;
const MAX_SIBLING_GLOSSES = 4;

/** Katakana only (including the long-vowel mark, middle dot and halfwidth kana). */
const KATAKANA_ONLY = /^[゠-ヿㇰ-ㇿｦ-ﾟ・ー\s]+$/;

console.log('loading intermediates...');
const entries = JSON.parse(fs.readFileSync('data/jm-entries.json', 'utf8'));

// Maps, not plain objects: "constructor" is an English headword, and on a plain
// object `postings["constructor"]` resolves up the prototype chain to a
// function whether or not the key is present.
const postings = new Map(Object.entries(JSON.parse(fs.readFileSync('data/jm-postings.json', 'utf8'))));
const wn = new Map(Object.entries(JSON.parse(fs.readFileSync('data/wn-senses.json', 'utf8'))));
// Keyed by English headword, so examples ride along in the shard the lookup
// already fetches rather than costing a second request.
const examples = new Map(Object.entries(JSON.parse(fs.readFileSync('data/examples.json', 'utf8'))));

const MIN_PREFIX = 2;
const MAX_PREFIX = 4;
const SPLIT_THRESHOLD = 300 * 1024; // raw JSON bytes before a shard is split further

/**
 * Shard prefix for a headword at a given depth. Non-alphanumerics are stripped
 * and short words are padded with '_', so every word maps to exactly one shard
 * and the client can compute the same prefix without consulting the data.
 */
function bucket(word, depth = MIN_PREFIX) {
  const cleaned = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  let out = '';
  for (let i = 0; i < depth; i++) {
    const ch = cleaned[i];
    out += ch && /[a-z0-9]/.test(ch) ? ch : '_';
  }
  return out;
}

/** Every Japanese surface form of an entry, used to join against WordNet lemmas. */
function formsOf(entry) {
  const out = [];
  for (const k of entry.k ?? []) out.push(k.t);
  for (const r of entry.r ?? []) out.push(r.t);
  return out;
}

/** Compact display record for one JMdict entry as matched by one gloss. */
function displayRecord(id, senseIdx, key) {
  const e = entries[id];
  if (!e) return null;
  const sense = e.s[senseIdx];
  if (!sense) return null;

  const kanji = e.k ?? [];
  const kana = e.r ?? [];
  const isCommon = kanji.some((k) => k.c) || kana.some((k) => k.c);

  // Exact, first-position gloss matches are the strongest signal of relevance.
  const glossIdx = sense.g.findIndex((g) => g.toLowerCase() === key);
  const exact = sense.g.some((g) => g.toLowerCase() === key);

  const rec = {
    i: id,
    w: kanji.length ? kanji[0].t : kana[0].t, // headword to display
  };
  if (kanji.length && kana.length) rec.y = kana[0].t; // reading, when kanji is shown
  if (isCommon) rec.c = 1;
  if (sense.p) rec.p = sense.p;
  if (sense.f) rec.f = sense.f;
  if (sense.m) rec.m = sense.m;
  if (sense.d) rec.d = sense.d;
  if (sense.i) rec.n = sense.i;

  // Sibling glosses disambiguate when no Japanese description is available.
  const siblings = sense.g.slice(0, MAX_SIBLING_GLOSSES);
  if (siblings.length) rec.g = siblings;

  rec._score =
    (isCommon ? 100 : 0) +
    (exact ? 50 : 0) +
    (glossIdx === 0 ? 25 : 0) +
    Math.max(0, 10 - senseIdx) +
    // A katakana transliteration is just the English word written in Japanese,
    // so it is the least useful answer whenever a native form is also offered
    // (ドッグ vs 犬). It still shows -- it just should not lead.
    (!kanji.length && KATAKANA_ONLY.test(rec.w) ? -30 : 0);

  return rec;
}

console.log('merging...');
const headwords = new Set([...postings.keys(), ...wn.keys()]);
console.log(`headwords: ${headwords.size.toLocaleString()}`);

const shards = new Map();
let senseGrouped = 0;
let ungrouped = 0;
let withExamples = 0;

for (const word of headwords) {
  const posting = postings.get(word) ?? [];

  // Build display records, de-duplicated by entry id (keep the best-scoring).
  const byId = new Map();
  for (const [id, senseIdx] of posting) {
    const rec = displayRecord(id, senseIdx, word);
    if (!rec) continue;
    const prev = byId.get(id);
    if (!prev || rec._score > prev._score) byId.set(id, rec);
  }
  let records = [...byId.values()].sort((a, b) => b._score - a._score);
  records = records.slice(0, MAX_ENTRIES_PER_HEADWORD);

  // Index entries by their Japanese surface forms so senses can claim them.
  const byForm = new Map();
  for (const rec of records) {
    for (const form of formsOf(entries[rec.i])) {
      if (!byForm.has(form)) byForm.set(form, []);
      byForm.get(form).push(rec);
    }
  }

  const claimed = new Set();
  const senses = [];

  for (const [idx, s] of (wn.get(word) ?? []).entries()) {
    const matched = [];
    const seen = new Set();
    for (const lemma of s.jl ?? []) {
      for (const rec of byForm.get(lemma) ?? []) {
        if (seen.has(rec.i)) continue;
        seen.add(rec.i);
        matched.push(rec);
      }
    }
    // A sense earns its place if it has a Japanese description or Japanese words.
    if (!s.jd && !matched.length && !(s.jl ?? []).length) continue;

    const sense = { p: s.p };
    if (s.jd) sense.jd = s.jd;
    if (s.ed) sense.ed = s.ed;
    if (s.jl?.length) sense.jl = s.jl.slice(0, 12);
    // Order the Japanese words by usefulness rather than WordNet's lemma order,
    // which otherwise leads "cat" with にゃんにゃん instead of 猫.
    if (matched.length) sense.e = matched.sort((a, b) => b._score - a._score);

    // WordNet orders senses by Princeton's frequency counts, which are a poor
    // fit for a dictionary: for "run" that puts the baseball sense first and
    // 走る seventeenth. Rank instead by how strongly JMdict corroborates the
    // sense -- a sense whose Japanese words are common JMdict headwords is the
    // one a reader is most likely looking for. WordNet order is the tiebreak.
    const commonHits = matched.filter((r) => r.c).length;
    sense._score =
      300 * Math.min(commonHits, 3) +
      40 * Math.min(matched.length, 5) +
      20 * Math.min((s.jl ?? []).length, 5) +
      (s.jd ? 10 : 0) -
      idx * 2;

    senses.push(sense);
  }

  senses.sort((a, b) => b._score - a._score);

  for (const sense of senses) {
    delete sense._score;
    if (!sense.e) continue;
    sense.e = sense.e.map((r) => {
      claimed.add(r.i);
      const { _score, ...rest } = r;
      return rest;
    });
  }

  const leftover = records
    .filter((r) => !claimed.has(r.i))
    .map(({ _score, ...rest }) => rest);

  if (!senses.length && !leftover.length) continue;

  const doc = { w: word };
  if (senses.length) {
    doc.sn = senses;
    senseGrouped++;
  }
  if (leftover.length) {
    doc.o = leftover;
    ungrouped++;
  }
  const ex = examples.get(word);
  if (ex) {
    doc.x = ex;
    withExamples++;
  }

  const b = bucket(word);
  if (!shards.has(b)) shards.set(b, {});
  shards.get(b)[word] = doc;
}

console.log(`headwords with Japanese sense groups: ${senseGrouped.toLocaleString()}`);
console.log(`headwords with ungrouped entries    : ${ungrouped.toLocaleString()}`);
console.log(`headwords with example sentences    : ${withExamples.toLocaleString()}`);

// Split oversized shards deeper until each is small enough to fetch on demand.
// Words that cannot be split further (identical prefixes) stay put.
for (let depth = MIN_PREFIX; depth < MAX_PREFIX; depth++) {
  for (const [prefix, docs] of [...shards]) {
    if (prefix.length !== depth) continue;
    if (JSON.stringify(docs).length <= SPLIT_THRESHOLD) continue;

    const children = new Map();
    for (const [word, doc] of Object.entries(docs)) {
      const child = bucket(word, depth + 1);
      if (!children.has(child)) children.set(child, {});
      children.get(child)[word] = doc;
    }
    if (children.size < 2) continue; // splitting would not help

    shards.delete(prefix);
    for (const [child, childDocs] of children) shards.set(child, childDocs);
  }
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`writing ${shards.size} shards...`);
let rawTotal = 0;
let gzTotal = 0;
const manifest = {};

for (const [b, docs] of shards) {
  const json = JSON.stringify(docs);
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(path.join(OUT_DIR, `${shardFile(b)}.json`), json);
  rawTotal += json.length;
  gzTotal += gz.length;
  manifest[b] = Object.keys(docs).length;
}

fs.writeFileSync(
  path.join(OUT_DIR, 'manifest.json'),
  JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    headwords: Object.values(manifest).reduce((a, b) => a + b, 0),
    minPrefix: MIN_PREFIX,
    maxPrefix: MAX_PREFIX,
    shards: manifest,
  })
);

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
console.log(`\nshards      : ${shards.size}`);
console.log(`raw total   : ${mb(rawTotal)}`);
console.log(`gzipped     : ${mb(gzTotal)}`);
console.log(`avg shard   : ${(rawTotal / shards.size / 1024).toFixed(0)} KB raw, ` +
  `${(gzTotal / shards.size / 1024).toFixed(0)} KB gz`);
const sizes = [...shards].map(([b, d]) => [b, JSON.stringify(d).length]).sort((a, b) => b[1] - a[1]);
console.log('largest     :', sizes.slice(0, 5).map(([b, s]) => `${b}=${(s / 1024).toFixed(0)}KB`).join(' '));
