/**
 * Recent searches ("検索履歴"), kept in localStorage.
 *
 * Same shape and the same offline-first reasoning as bookmarks.js: DOM-free,
 * every access wrapped, nothing ever leaves the device. The list is deliberately
 * unbounded -- a reader looking back over months of study should find the word
 * they half-remember from March, not the last twenty. The only thing that can
 * cut it short is the browser's own storage quota, and even that is handled by
 * shedding the oldest entries rather than by imposing a cap up front.
 */

const KEY = 'history:v1';

/** @typedef {{ w: string, ja: string, at: string }} Visit */

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.w === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Persist, and if the quota is already full make room instead of dropping the
 * write. Halving is crude but it happens perhaps once in the life of the list,
 * and it costs the oldest searches -- the ones least likely to be wanted --
 * rather than the one the reader just made.
 */
function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    // Keep the newest half, then put it back into stored order -- oldest first,
    // which is what `add` appends to and what `sorted` reads as the tiebreak.
    const kept = sorted(list).slice(0, Math.floor(list.length / 2)).reverse();
    if (!kept.length) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(kept));
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Newest first. Two searches can share a millisecond -- tapping through the
 * suggestion list, or a script driving the app -- and then the timestamps tie,
 * so stored position breaks it: `add` always appends, so later means newer.
 */
function sorted(list) {
  return list
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (a.v.at < b.v.at ? 1 : a.v.at > b.v.at ? -1 : b.i - a.i))
    .map(({ v }) => v);
}

/** Every search made, most recent first. */
export function all() {
  return sorted(read());
}

export function count() {
  return read().length;
}

export function has(word) {
  return read().some((v) => v.w === word);
}

/**
 * Record a visit. A word searched again moves back to the top rather than
 * appearing twice -- "recent searches" is a set of words in time order, and a
 * reader drilling the same word ten times wants one row, not ten.
 *
 * `ja` refreshes on every visit so an entry saved before the gloss was known
 * (or before a dictionary rebuild) catches up.
 */
export function add(word, ja = '') {
  const list = read().filter((v) => v.w !== word);
  list.push({ w: word, ja, at: new Date().toISOString() });
  write(list);
  return all();
}

export function remove(word) {
  write(read().filter((v) => v.w !== word));
  return all();
}

export function clear() {
  write([]);
}
