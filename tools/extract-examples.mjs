/**
 * Pass 2b: index Tatoeba example sentences by ENGLISH headword.
 *
 * JMdict attaches these pairs to Japanese senses, but the English side is a
 * translation of the Japanese sentence rather than a sentence built around the
 * English word: 経営する is glossed "run", and its example translates as "He
 * manages a company." Keyed the Japanese way, 52.8% of attachments would show a
 * sentence that never uses the word the reader looked up.
 *
 * So the join runs the other way. Each sentence is tokenised on the English
 * side and attached to the headwords it actually contains, which makes the word
 * appearing in the example a property of the build rather than a hope.
 *
 * Reads:  the JMdict examples build, plus the headword sets from passes 1 and 2
 * Emits:  data/examples.json  english headword -> [[japanese, english], ...]
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const { variants } = await import(pathToFileURL('web/search-core.js').href);

const SRC = 'data/jmdict-examples-eng-3.6.2.json';
const MAX_PER_HEADWORD = 3;

/** Longest token window considered, so phrasal headwords ("give up") match. */
const MAX_PHRASE = 3;

const irregular = JSON.parse(fs.readFileSync('web/irregular.json', 'utf8'));

// A sentence is only useful against a word the site can actually display, which
// is the union build-index.mjs iterates over.
console.log('loading headwords...');
const postings = JSON.parse(fs.readFileSync('data/jm-postings.json', 'utf8'));
const wn = JSON.parse(fs.readFileSync('data/wn-senses.json', 'utf8'));
const headwords = new Set([...Object.keys(postings), ...Object.keys(wn)]);
console.log(`headwords: ${headwords.size.toLocaleString()}`);

console.log('reading JMdict examples...');
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// The same pair is attached to many senses; keep one copy, keyed by Tatoeba id.
const pairs = new Map();
for (const w of raw.words) {
  for (const sense of w.sense) {
    for (const ex of sense.examples ?? []) {
      const id = ex.source?.value;
      if (!id || pairs.has(id)) continue;
      const ja = (ex.sentences ?? []).find((s) => s.lang === 'jpn')?.text;
      const en = (ex.sentences ?? []).find((s) => s.lang === 'eng')?.text;
      if (ja && en) pairs.set(id, [ja, en]);
    }
  }
}
console.log(`distinct sentence pairs: ${pairs.size.toLocaleString()}`);

/**
 * How good a sentence is as the example a learner reads first.
 *
 * Short enough to parse, long enough to show the word doing something, and
 * not a fragment of dialogue that only makes sense with its other half.
 */
function score(en, ja, inflected) {
  const words = en.split(/\s+/).length;
  let s = 0;

  // A learner looking up "run" is served better by "run" than by "outrunning".
  if (!inflected) s += 30;

  // Readable band. Beyond it, the example teaches sentence-parsing, not a word.
  if (words >= 4 && words <= 14) s += 40;
  else if (words >= 3 && words <= 18) s += 15;
  else s -= 20;

  if (/[.!?]$/.test(en.trim())) s += 10;
  if (/^["'“]|["'”]\s|\.\.\./.test(en)) s -= 25; // dialogue halves, trailing-off
  if (ja.length > 60) s -= 15;

  return s;
}

console.log('indexing by english headword...');
const index = new Map();

for (const [ja, en] of pairs.values()) {
  const tokens = en.toLowerCase().match(/[a-z']+/g) ?? [];
  const claimed = new Set();

  for (let i = 0; i < tokens.length; i++) {
    for (let n = MAX_PHRASE; n >= 1; n--) {
      if (i + n > tokens.length) break;
      const window = tokens.slice(i, i + n);

      // Only the head of a phrase inflects ("gave up" -> "give up"), so the
      // tail is matched literally.
      const tail = window.slice(1).join(' ');
      for (const [vi, head] of variants(window[0], irregular).entries()) {
        const key = tail ? `${head} ${tail}` : head;
        if (!headwords.has(key) || claimed.has(key)) continue;
        claimed.add(key);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ ja, en, s: score(en, ja, vi > 0) });
        break; // best variant for this window wins, as lookup() would resolve it
      }
    }
  }
}

console.log('ranking...');
const out = {};
let slots = 0;
for (const [key, list] of index) {
  slots += list.length;
  out[key] = list
    .sort((a, b) => b.s - a.s || a.en.length - b.en.length)
    .slice(0, MAX_PER_HEADWORD)
    .map((x) => [x.ja, x.en]);
}

fs.writeFileSync('data/examples.json', JSON.stringify(out));

const size = fs.statSync('data/examples.json').size;
console.log(`\nheadwords with examples : ${index.size.toLocaleString()}`);
console.log(`candidate slots         : ${slots.toLocaleString()}`);
console.log(`kept (max ${MAX_PER_HEADWORD}/headword) : ` +
  `${Object.values(out).reduce((a, b) => a + b.length, 0).toLocaleString()}`);
console.log(`data/examples.json      : ${(size / 1e6).toFixed(1)} MB`);
