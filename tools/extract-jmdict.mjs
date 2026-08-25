/**
 * Pass 2: turn JMdict (a J->E dictionary) into an E->J posting list.
 *
 * Emits:
 *   data/jm-entries.json  id -> { k: kanji forms, r: kana forms, s: senses }
 *   data/jm-postings.json normalised English key -> [[entryId, senseIdx], ...]
 */
import fs from 'node:fs';

// The "examples" build: the same 218,577 entries as jmdict-eng, plus Tatoeba
// sentence pairs. tools/extract-examples.mjs reads the same file.
const SRC = 'data/jmdict-examples-eng-3.6.2.json';

/**
 * Reduce a gloss to a search key: lowercase, drop parentheticals and the
 * infinitive "to " that JMdict prefixes onto every verb gloss, squash space.
 */
function normalise(gloss) {
  let s = gloss.toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' '); // "(of a machine) to run" -> " to run"
  s = s.replace(/[.,;:!?"'`]+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^to\s+/, ''); // verbs: "to run" -> "run"
  s = s.replace(/^(a|an|the)\s+/, '');
  return s.trim();
}

console.log('reading JMdict...');
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
console.log(`entries: ${raw.words.length.toLocaleString()}`);

const entries = {};
const postings = new Map();

// Search-only forms exist for lookup, not display; drop them from output.
const HIDDEN_FORM = new Set(['sK', 'sk']);

let senseCount = 0;
let glossCount = 0;

for (const w of raw.words) {
  const kanji = w.kanji
    .filter((k) => !k.tags.some((t) => HIDDEN_FORM.has(t)))
    .map((k) => (k.common ? { t: k.text, c: 1 } : { t: k.text }));

  const kana = w.kana
    .filter((k) => !k.tags.some((t) => HIDDEN_FORM.has(t)))
    .map((k) => (k.common ? { t: k.text, c: 1 } : { t: k.text }));

  if (!kanji.length && !kana.length) continue;

  const senses = [];
  for (const sense of w.sense) {
    const glosses = sense.gloss.filter((g) => g.lang === 'eng').map((g) => g.text);
    if (!glosses.length) continue;

    const rec = { g: glosses };
    if (sense.partOfSpeech.length) rec.p = sense.partOfSpeech;
    if (sense.field.length) rec.f = sense.field;
    if (sense.misc.length) rec.m = sense.misc;
    if (sense.dialect.length) rec.d = sense.dialect;
    if (sense.info.length) rec.i = sense.info;

    const senseIdx = senses.length;
    senses.push(rec);
    senseCount++;

    for (const g of glosses) {
      glossCount++;
      const key = normalise(g);
      if (!key) continue;
      let list = postings.get(key);
      if (!list) postings.set(key, (list = []));
      list.push([w.id, senseIdx]);
    }
  }

  if (!senses.length) continue;

  const e = { s: senses };
  if (kanji.length) e.k = kanji;
  if (kana.length) e.r = kana;
  entries[w.id] = e;
}

console.log('writing...');
fs.writeFileSync('data/jm-entries.json', JSON.stringify(entries));
fs.writeFileSync(
  'data/jm-postings.json',
  JSON.stringify(Object.fromEntries([...postings].sort(([a], [b]) => (a < b ? -1 : 1))))
);

console.log(`\nentries kept : ${Object.keys(entries).length.toLocaleString()}`);
console.log(`senses       : ${senseCount.toLocaleString()}`);
console.log(`glosses      : ${glossCount.toLocaleString()}`);
console.log(`search keys  : ${postings.size.toLocaleString()}`);
