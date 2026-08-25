/**
 * Saved words ("単語帳"), kept in localStorage.
 *
 * Deliberately DOM-free and self-contained: the list is small, private to the
 * reader, and must survive offline, so it never leaves the device. Every access
 * is wrapped because localStorage throws outright in some private-browsing
 * modes -- a reader who cannot save words should still be able to look them up.
 */

const KEY = 'bookmarks:v1';
const FORMAT = 1;

/** @typedef {{ w: string, ja: string, at: string }} Bookmark */

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((b) => b && typeof b.w === 'string') : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Saved words, most recently added first. */
export function all() {
  return read().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function count() {
  return read().length;
}

export function has(word) {
  return read().some((b) => b.w === word);
}

/** Add unless already saved. Returns the resulting list. */
export function add(word, ja = '') {
  const list = read();
  if (!list.some((b) => b.w === word)) {
    list.push({ w: word, ja, at: new Date().toISOString() });
    write(list);
  }
  return all();
}

export function remove(word) {
  write(read().filter((b) => b.w !== word));
  return all();
}

/** Toggle and report the new state. */
export function toggle(word, ja = '') {
  if (has(word)) {
    remove(word);
    return false;
  }
  add(word, ja);
  return true;
}

export function clear() {
  write([]);
}

/**
 * The export payload. Versioned and self-describing so an old file is still
 * readable years later, or by something other than this app.
 */
export function exportData() {
  const list = all();
  return {
    format: FORMAT,
    app: 'eiwa-jiten',
    exported: new Date().toISOString(),
    count: list.length,
    bookmarks: list.map((b) => ({ word: b.w, ja: b.ja, added: b.at })),
  };
}

/** Filename with a date stamp, e.g. eiwa-bookmarks-2026-08-25.json */
export function exportFilename(now = new Date()) {
  return `eiwa-bookmarks-${now.toISOString().slice(0, 10)}.json`;
}
