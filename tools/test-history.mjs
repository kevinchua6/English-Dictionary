/**
 * Unit test for the recent-searches store. Like test-bookmarks.mjs it needs no
 * server and no built index -- localStorage is stubbed, and it is the only
 * browser API the store touches.
 * Usage: node tools/test-history.mjs
 */
import assert from 'node:assert';

const cell = new Map();
globalThis.localStorage = {
  getItem: (k) => (cell.has(k) ? cell.get(k) : null),
  setItem: (k, v) => cell.set(k, String(v)),
  removeItem: (k) => cell.delete(k),
};

const h = await import('../web/history.js');

assert.deepStrictEqual(h.all(), [], 'starts empty');

h.add('run', '走る');
h.add('water', '水');
h.add('beautiful', '美しい');
assert.strictEqual(h.count(), 3);
assert.deepStrictEqual(h.all().map((v) => v.w), ['beautiful', 'water', 'run'], 'newest first');
assert.strictEqual(h.has('run'), true);

// A repeat search is one row, moved back to the top, with a refreshed gloss.
h.add('run', '走る、経営する');
assert.strictEqual(h.count(), 3, 'the same word is never listed twice');
assert.strictEqual(h.all()[0].w, 'run', 'searching again moves the word to the top');
assert.strictEqual(h.all()[0].ja, '走る、経営する', 'the gloss is refreshed on each visit');

// The list is unbounded on purpose: months of study must still be there.
for (let i = 0; i < 500; i++) h.add(`word${i}`, '');
assert.strictEqual(h.count(), 503, 'nothing is dropped as the list grows');
assert.strictEqual(h.all()[0].w, 'word499');

h.remove('word499');
assert.strictEqual(h.count(), 502);
assert.strictEqual(h.has('word499'), false);

h.clear();
assert.strictEqual(h.count(), 0);

// A reader whose storage is corrupt must still be able to look words up.
cell.set('history:v1', '{not json');
assert.deepStrictEqual(h.all(), [], 'unparseable storage reads as empty');
cell.set('history:v1', '[{"junk":1},{"w":"ok","ja":"","at":"2020-01-01"}]');
assert.deepStrictEqual(h.all().map((v) => v.w), ['ok'], 'malformed rows are dropped');

// A full quota sheds the oldest half rather than losing the newest search.
h.clear();
for (let i = 0; i < 10; i++) h.add(`w${i}`, '');
const real = globalThis.localStorage.setItem;
let refusals = 1;
globalThis.localStorage.setItem = (k, v) => {
  if (refusals-- > 0) throw new Error('QuotaExceededError');
  real(k, v);
};
h.add('fresh', '');
globalThis.localStorage.setItem = real;
const kept = h.all().map((v) => v.w);
assert.strictEqual(kept[0], 'fresh', 'the newest search survives a full quota');
assert.strictEqual(kept.length, 5, 'the oldest half is shed');
assert.ok(!kept.includes('w0'), 'and it is the oldest that goes');

globalThis.localStorage = {
  getItem() { throw new Error('storage disabled'); },
  setItem() { throw new Error('storage disabled'); },
  removeItem() { throw new Error('storage disabled'); },
};
assert.deepStrictEqual(h.all(), [], 'disabled storage does not throw');
assert.doesNotThrow(() => h.add('run', '走る'), 'recording into disabled storage is a no-op');

console.log('OK  history: 20 assertions passed');
