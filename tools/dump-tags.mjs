import fs from 'node:fs';

const fd = fs.openSync('data/jmdict-eng-3.6.2.json', 'r');
const buf = Buffer.alloc(300000);
const n = fs.readSync(fd, buf, 0, 300000, 0);
fs.closeSync(fd);

const head = buf.toString('utf8', 0, n);
const start = head.indexOf('"tags":');
const end = head.indexOf('},', start);
const tags = JSON.parse(head.slice(start + '"tags":'.length, end + 1));

const sorted = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
fs.writeFileSync('data/tags-en.json', JSON.stringify(Object.fromEntries(sorted), null, 2));
for (const [k, v] of sorted) console.log(`${k}\t${v}`);
