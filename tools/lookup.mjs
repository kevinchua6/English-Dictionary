/** Dev lookup against the built shards. Usage: node tools/lookup.mjs run */
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('web/dict/manifest.json', 'utf8'));
const tags = JSON.parse(fs.readFileSync('data/tags-ja.json', 'utf8'));
const word = (process.argv[2] ?? 'run').toLowerCase();

function bucket(w, depth) {
  const cleaned = w.toLowerCase().replace(/[^a-z0-9]/g, '');
  let out = '';
  for (let i = 0; i < depth; i++) {
    const ch = cleaned[i];
    out += ch && /[a-z0-9]/.test(ch) ? ch : '_';
  }
  return out;
}

let shardName = null;
for (let d = manifest.maxPrefix; d >= manifest.minPrefix; d--) {
  const b = bucket(word, d);
  if (manifest.shards[b] !== undefined) { shardName = b; break; }
}
if (!shardName) { console.log('no shard'); process.exit(0); }

const shard = JSON.parse(fs.readFileSync(`web/dict/${shardName}.json`, 'utf8'));
const doc = shard[word];
console.log(`shard=${shardName}.json  headwords in shard=${manifest.shards[shardName]}`);
if (!doc) { console.log(`"${word}" not found`); process.exit(0); }

const ja = (t) => tags[t]?.ja ?? t;
const fmt = (e) => {
  const head = e.y ? `${e.w}（${e.y}）` : e.w;
  const bits = [];
  if (e.c) bits.push('常用');
  if (e.p) bits.push(e.p.map(ja).join('・'));
  if (e.f) bits.push(e.f.map(ja).join('・'));
  if (e.m) bits.push(e.m.map(ja).join('・'));
  return `      ${head}${bits.length ? '  [' + bits.join(' / ') + ']' : ''}` +
    (e.g ? `\n         ${e.g.join('; ')}` : '');
};

console.log(`\n=== ${doc.w} ===`);
for (const [i, s] of (doc.sn ?? []).entries()) {
  console.log(`\n  ${i + 1}. (${s.p}) ${s.jd ?? '—'}`);
  if (s.ed) console.log(`     en: ${s.ed}`);
  if (s.jl) console.log(`     WordNet訳: ${s.jl.join('、')}`);
  for (const e of s.e ?? []) console.log(fmt(e));
}
if (doc.o) {
  console.log(`\n  --- その他 (${doc.o.length}) ---`);
  for (const e of doc.o.slice(0, 6)) console.log(fmt(e));
}
