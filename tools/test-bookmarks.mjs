/**
 * Unit test for the saved-words store. Needs no server and no built index:
 * localStorage is stubbed, which is also the only browser API the store uses.
 * Usage: node tools/test-bookmarks.mjs
 */
import assert from 'node:assert';

const cell = new Map();
globalThis.localStorage = {
  getItem: (k) => (cell.has(k) ? cell.get(k) : null),
  setItem: (k, v) => cell.set(k, String(v)),
  removeItem: (k) => cell.delete(k),
};

// Imported after the stub exists; the module reads storage on first call only,
// but keeping the order explicit avoids a trap for later edits.
const b = await import('../web/bookmarks.js');

assert.deepStrictEqual(b.all(), [], 'starts empty');

b.add('run', '走る、駆ける');
b.add('run', 'ignored');
assert.strictEqual(b.count(), 1, 'the same word is never saved twice');
assert.strictEqual(b.has('run'), true);

assert.strictEqual(b.toggle('water', '水'), true, 'toggle saves');
assert.strictEqual(b.toggle('water'), false, 'toggle removes');
assert.strictEqual(b.count(), 1);

b.add('beautiful', '美しい');
const list = b.all();
assert.strictEqual(list.length, 2);
assert.ok(list[0].at >= list[1].at, 'newest first, so review starts with what is fresh');

const data = b.exportData();
assert.strictEqual(data.format, 1);
assert.strictEqual(data.count, 2);
assert.deepStrictEqual(data.bookmarks.map((x) => x.word).sort(), ['beautiful', 'run']);
assert.ok(data.bookmarks.every((x) => 'ja' in x && x.added), 'export carries gloss and date');
JSON.parse(JSON.stringify(data)); // the export must survive a round trip
assert.strictEqual(
  b.exportFilename(new Date('2026-08-25T10:00:00Z')),
  'eiwa-bookmarks-2026-08-25.json'
);

b.remove('run');
assert.strictEqual(b.count(), 1);
b.clear();
assert.strictEqual(b.count(), 0);

// A reader whose storage is corrupt or full must still be able to look words up.
cell.set('bookmarks:v1', '{not json');
assert.deepStrictEqual(b.all(), [], 'unparseable storage reads as empty');
cell.set('bookmarks:v1', '[{"junk":1},{"w":"ok","ja":"","at":"2020-01-01"}]');
assert.deepStrictEqual(b.all().map((x) => x.w), ['ok'], 'malformed rows are dropped');

globalThis.localStorage = {
  getItem() { throw new Error('storage disabled'); },
  setItem() { throw new Error('storage disabled'); },
  removeItem() { throw new Error('storage disabled'); },
};
assert.deepStrictEqual(b.all(), [], 'disabled storage does not throw');
assert.doesNotThrow(() => b.add('run', '走る'), 'saving into disabled storage is a no-op');

console.log('OK  bookmarks: 16 assertions passed');
