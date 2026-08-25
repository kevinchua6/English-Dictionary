import fs from 'node:fs';

const en = JSON.parse(fs.readFileSync('data/tags-en.json', 'utf8'));
const ja = JSON.parse(fs.readFileSync('data/tags-ja.json', 'utf8'));
delete ja._comment;

const enKeys = new Set(Object.keys(en));
const jaKeys = new Set(Object.keys(ja));

const missing = [...enKeys].filter((k) => !jaKeys.has(k));
const extra = [...jaKeys].filter((k) => !enKeys.has(k));

console.log(`JMdict tags : ${enKeys.size}`);
console.log(`translated  : ${jaKeys.size}`);
console.log(`missing     : ${missing.length}${missing.length ? ' -> ' + missing.join(', ') : ''}`);
console.log(`extra       : ${extra.length}${extra.length ? ' -> ' + extra.join(', ') : ''}`);

const cats = {};
for (const v of Object.values(ja)) cats[v.cat] = (cats[v.cat] ?? 0) + 1;
console.log('by category :', cats);

if (missing.length || extra.length) process.exit(1);
console.log('\nOK: tag vocabulary fully covered.');
