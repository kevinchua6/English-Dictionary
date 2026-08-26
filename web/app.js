/**
 * 英和辞典 — client.
 *
 * The index is split into prefix shards; a lookup fetches exactly one of them
 * (usually ~9 KB gzipped) and everything after that is in-memory. Shards are
 * cached by the service worker, so repeated and offline lookups cost nothing.
 */

import { normalise, shardFor, lookup, variants, shardFile } from './search-core.js';
import * as bookmarks from './bookmarks.js';
import * as speech from './speech.js';

const DICT = 'dict';

const els = {
  form: document.getElementById('searchForm'),
  q: document.getElementById('q'),
  suggest: document.getElementById('suggest'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  welcome: document.getElementById('welcome'),
  dictDate: document.getElementById('dictDate'),
  themeToggle: document.getElementById('themeToggle'),
  bookmarksToggle: document.getElementById('bookmarksToggle'),
  bookmarkCount: document.getElementById('bookmarkCount'),
  bookmarks: document.getElementById('bookmarks'),
  bookmarkList: document.getElementById('bookmarkList'),
  bookmarksEmpty: document.getElementById('bookmarksEmpty'),
  exportBookmarks: document.getElementById('exportBookmarks'),
  clearBookmarks: document.getElementById('clearBookmarks'),
};

let manifest = null;
let tags = {};
let irregular = {};
const shardCache = new Map();

/** WordNet part-of-speech codes. 's' is an adjective satellite. */
const WN_POS = { n: '名詞', v: '動詞', a: '形容詞', s: '形容詞', r: '副詞' };

/* ---------------------------------------------------------------- loading */

/** Where the build stamp of the shards currently in the cache is remembered. */
const BUILD_KEY = 'dictBuild';

/**
 * A rebuild rewrites the shards in place, and the service worker treats them as
 * immutable -- so a word looked up before the rebuild would keep showing its old
 * entry until sw.js bumps VERSION. Remembering which build the cached shards came
 * from closes that gap: the manifest is fetched network-first, so a changed stamp
 * is visible on the very next load, and dropping the shard caches is enough to
 * fix it. Cheap on a first visit, where there is nothing to delete.
 */
async function purgeStaleShards(build) {
  if (localStorage.getItem(BUILD_KEY) === build) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dict-')).map((k) => caches.delete(k)));
  } catch {
    // No CacheStorage (private mode, or plain http on a non-localhost host).
    // Nothing is cached in that case either, so there is nothing to recover from.
  }
  localStorage.setItem(BUILD_KEY, build);
}

async function boot() {
  const [m, t, irr] = await Promise.all([
    fetch(`${DICT}/manifest.json`).then((r) => r.json()),
    fetch('tags.json').then((r) => r.json()),
    fetch('irregular.json').then((r) => r.json()),
  ]);
  manifest = m;
  tags = t;
  delete irr._comment;
  irregular = irr;
  els.dictDate.textContent = `データ更新: ${m.generated}`;

  // Before the first shard is fetched. `generated` is the fallback for a
  // manifest built before the stamp existed -- correct, just day-granular.
  await purgeStaleShards(m.build ?? m.generated);

  const initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    els.q.value = initial;
    search(initial);
  }
}

async function loadShard(name) {
  if (shardCache.has(name)) return shardCache.get(name);
  const p = fetch(`${DICT}/${shardFile(name)}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  shardCache.set(name, p);
  return p;
}

/* ----------------------------------------------------------------- search */

async function search(rawInput) {
  const query = normalise(rawInput);
  closeBookmarks();
  els.welcome.hidden = true;
  hideSuggest();

  if (!query) {
    els.results.innerHTML = '';
    els.status.textContent = '';
    els.welcome.hidden = false;
    return;
  }

  // A saved word can be tapped before the index has finished loading.
  if (!manifest) {
    els.status.textContent = '辞書データを読み込んでいます…';
    return;
  }

  els.status.textContent = '検索中…';
  history.replaceState(null, '', `?q=${encodeURIComponent(rawInput)}`);

  const hit = await lookup({ manifest, irregular, loadShard }, rawInput);
  els.status.textContent = '';

  if (hit) render(hit.doc, hit.corrected ? hit.query : null);
  else await renderNotFound(query);
}

/* --------------------------------------------------------------- rendering */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Japanese label for a JMdict tag code, falling back to the raw code. */
function tagLabel(code) {
  return tags[code]?.ja ?? code;
}

function tagChips(entry) {
  const frag = document.createDocumentFragment();
  if (entry.c) frag.append(el('span', 'tag tag-common', '常用'));
  for (const group of ['p', 'f', 'm', 'd']) {
    for (const code of entry[group] ?? []) {
      const cat = tags[code]?.cat ?? 'pos';
      frag.append(el('span', `tag tag-${cat}`, tagLabel(code)));
    }
  }
  return frag;
}

function entryNode(entry) {
  const node = el('li', 'entry');

  const head = el('div', 'entry-head');
  head.append(el('span', 'jp-word', entry.w));
  if (entry.y) head.append(el('span', 'jp-reading', entry.y));
  node.append(head);

  const chips = el('div', 'tags');
  chips.append(tagChips(entry));
  if (chips.childNodes.length) node.append(chips);

  if (entry.n?.length) {
    node.append(el('p', 'entry-note', entry.n.join(' / ')));
  }
  if (entry.g?.length) {
    node.append(el('p', 'entry-gloss', entry.g.join('; ')));
  }
  return node;
}

function senseNode(sense, index) {
  const node = el('section', 'sense');

  const head = el('div', 'sense-head');
  head.append(el('span', 'sense-num', String(index + 1)));
  if (sense.p) head.append(el('span', `tag tag-pos`, WN_POS[sense.p] ?? sense.p));
  node.append(head);

  // The Japanese definition is the whole point of the WordNet layer.
  if (sense.jd) node.append(el('p', 'sense-def', sense.jd));

  if (sense.e?.length) {
    const list = el('ul', 'entries');
    for (const entry of sense.e) list.append(entryNode(entry));
    node.append(list);
  }

  // Japanese words WordNet knows for this sense that JMdict did not corroborate.
  const matched = new Set((sense.e ?? []).map((e) => e.w));
  const extra = (sense.jl ?? []).filter((w) => !matched.has(w));
  if (extra.length) {
    const p = el('p', 'sense-extra');
    p.append(el('span', 'sense-extra-label', 'その他の訳語：'));
    p.append(document.createTextNode(extra.join('、')));
    node.append(p);
  }

  if (sense.ed) {
    const d = el('details', 'sense-en');
    d.append(el('summary', null, '英語の語義'));
    d.append(el('p', null, sense.ed));
    node.append(d);
  }
  return node;
}

/**
 * The example sentence with the looked-up word marked.
 *
 * The build guarantees the word is in there, but not in which form -- "borrow"
 * is matched by "borrowed" -- so the same variant logic that resolves a query
 * finds it again here rather than the build spending bytes recording it.
 */
function highlightExample(sentence, word) {
  const frag = document.createDocumentFragment();
  const target = word.split(' ');
  // Odd indices are word tokens, even ones the punctuation between them.
  const parts = sentence.split(/([a-zA-Z']+)/);

  for (let i = 0; i < parts.length; i++) {
    const isWord = i % 2 === 1;
    if (!isWord) {
      frag.append(document.createTextNode(parts[i]));
      continue;
    }

    // Only the head of a phrase inflects, matching tools/extract-examples.mjs.
    const head = parts[i].toLowerCase();
    let end = -1;
    if (variants(head, irregular).includes(target[0])) {
      end = i;
      for (let t = 1; t < target.length; t++) {
        const next = i + 2 * t;
        if (parts[next]?.toLowerCase() !== target[t]) { end = -1; break; }
        end = next;
      }
    }

    if (end === -1) {
      frag.append(document.createTextNode(parts[i]));
      continue;
    }
    frag.append(el('mark', 'ex-hit', parts.slice(i, end + 1).join('')));
    i = end;
  }
  return frag;
}

function exampleNode(ja, en, word) {
  const node = el('li', 'example');
  const sentence = el('p', 'ex-en');
  sentence.append(highlightExample(en, word));
  node.append(sentence);
  node.append(el('p', 'ex-ja', ja));
  return node;
}

/**
 * The 🔊 beside the headword. Hidden until the device admits to having an
 * English voice, since a button that does nothing is worse than no button --
 * and the answer is not known until the voice list settles, which on Chrome
 * happens after the first result is already on screen.
 */
let speakSeq = 0;

function speakButton(word) {
  const btn = el('button', 'speak-btn', '🔊');
  btn.type = 'button';
  btn.hidden = true;
  btn.setAttribute('aria-label', `「${word}」の発音を聞く`);
  btn.title = '発音を聞く';
  speech.ready().then((ok) => { btn.hidden = !ok; });

  btn.addEventListener('click', async () => {
    // Only one utterance plays at a time, so a later tap owns the highlight --
    // the interrupted one must not switch it off on its way out.
    const seq = ++speakSeq;
    els.status.textContent = '';
    btn.classList.add('is-speaking');
    try {
      await speech.speak(word);
    } catch {
      els.status.textContent = speech.needsNetwork()
        ? 'この端末の英語音声はオンライン専用のため、再生できませんでした。'
        : '音声を再生できませんでした。';
    } finally {
      if (seq === speakSeq) btn.classList.remove('is-speaking');
    }
  });
  return btn;
}

function render(doc, correctedFrom) {
  els.results.innerHTML = '';

  const header = el('div', 'word-header');
  header.append(el('h1', 'word', doc.w));
  header.append(speakButton(doc.w));
  header.append(starButton(doc));
  els.results.append(header);

  if (correctedFrom) {
    els.results.append(
      el('p', 'corrected', `「${correctedFrom}」の見出し語として「${doc.w}」を表示しています。`)
    );
  }

  // Examples key on the English headword, not on a sense, so they sit with the
  // word itself. Three sentences is short enough not to push the senses down.
  if (doc.x?.length) {
    // Not 'examples' -- index.html already uses that class for the welcome
    // chips row, which style.css lays out as a flex row.
    const section = el('div', 'example-block');
    section.append(el('h2', 'section-title', '例文'));
    const list = el('ul', 'example-list');
    for (const [ja, en] of doc.x) list.append(exampleNode(ja, en, doc.w));
    section.append(list);
    els.results.append(section);
  }

  if (doc.sn?.length) {
    const section = el('div', 'senses');
    section.append(el('h2', 'section-title', '語義'));
    doc.sn.forEach((s, i) => section.append(senseNode(s, i)));
    els.results.append(section);
  }

  if (doc.o?.length) {
    const section = el('div', 'other');
    section.append(el('h2', 'section-title', doc.sn?.length ? 'その他の訳語' : '訳語'));
    const list = el('ul', 'entries');
    for (const entry of doc.o) list.append(entryNode(entry));
    section.append(list);
    els.results.append(section);
  }

  scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderNotFound(query) {
  els.status.textContent = '';
  els.results.innerHTML = '';
  els.results.append(el('p', 'notfound', `「${query}」は見つかりませんでした。`));

  const near = await prefixMatches(query, 12);
  if (near.length) {
    const box = el('div', 'didyoumean');
    box.append(el('h2', 'section-title', 'もしかして'));
    const list = el('ul', 'chips');
    for (const w of near) {
      const li = el('li');
      const b = el('button', 'chip', w);
      b.type = 'button';
      b.addEventListener('click', () => { els.q.value = w; search(w); });
      li.append(b);
      list.append(li);
    }
    box.append(list);
    els.results.append(box);
  }
}

/** Headwords in the query's own shard that start with it. */
async function prefixMatches(prefix, limit) {
  if (prefix.length < 2 || !manifest) return [];
  const name = shardFor(manifest, prefix);
  if (!name) return [];
  const shard = await loadShard(name);
  const out = [];
  for (const key of Object.keys(shard)) {
    if (key.startsWith(prefix) && key !== prefix) out.push(key);
    if (out.length >= limit * 4) break;
  }
  return out.sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).slice(0, limit);
}

/* -------------------------------------------------------------- bookmarks */

/** A short Japanese reminder of what the word meant, for the review list. */
function previewJa(doc) {
  const words = [];
  for (const s of doc.sn ?? []) {
    for (const e of s.e ?? []) if (!words.includes(e.w)) words.push(e.w);
    for (const w of s.jl ?? []) if (!words.includes(w)) words.push(w);
    if (words.length >= 3) break;
  }
  for (const e of doc.o ?? []) {
    if (words.length >= 3) break;
    if (!words.includes(e.w)) words.push(e.w);
  }
  return words.slice(0, 3).join('、');
}

function setStarState(btn, saved) {
  btn.textContent = saved ? '★' : '☆';
  btn.classList.toggle('is-on', saved);
  btn.setAttribute('aria-pressed', String(saved));
  btn.setAttribute('aria-label', saved ? '単語帳から削除' : '単語帳に保存');
  btn.title = saved ? '単語帳から削除' : '単語帳に保存';
}

function starButton(doc) {
  const btn = el('button', 'star-btn');
  btn.type = 'button';
  btn.dataset.word = doc.w;
  setStarState(btn, bookmarks.has(doc.w));
  btn.addEventListener('click', () => {
    setStarState(btn, bookmarks.toggle(doc.w, previewJa(doc)));
    refreshBookmarkCount();
  });
  return btn;
}

function refreshBookmarkCount() {
  const n = bookmarks.count();
  els.bookmarkCount.textContent = n > 99 ? '99+' : String(n);
  els.bookmarkCount.hidden = n === 0;
  els.bookmarksToggle.classList.toggle('is-on', n > 0);
}

function bookmarkNode(b) {
  const node = el('li', 'entry bookmark');

  const head = el('div', 'entry-head');
  const open = el('button', 'bookmark-word', b.w);
  open.type = 'button';
  open.addEventListener('click', () => { els.q.value = b.w; search(b.w); });
  head.append(open);
  if (b.ja) head.append(el('span', 'bookmark-ja', b.ja));
  node.append(head);

  const drop = el('button', 'star-btn star-small is-on', '★');
  drop.type = 'button';
  drop.title = '単語帳から削除';
  drop.setAttribute('aria-label', `「${b.w}」を単語帳から削除`);
  drop.addEventListener('click', () => {
    bookmarks.remove(b.w);
    refreshBookmarkCount();
    renderBookmarks();
    // The word on screen may be the one just dropped; keep its star honest.
    const shown = els.results.querySelector(`.star-btn[data-word="${CSS.escape(b.w)}"]`);
    if (shown) setStarState(shown, false);
  });
  node.append(drop);

  return node;
}

function renderBookmarks() {
  const list = bookmarks.all();
  els.bookmarkList.innerHTML = '';
  for (const b of list) els.bookmarkList.append(bookmarkNode(b));
  els.bookmarksEmpty.hidden = list.length > 0;
  els.exportBookmarks.disabled = list.length === 0;
  els.clearBookmarks.disabled = list.length === 0;
  // Also covers another tab having saved something since this one loaded.
  refreshBookmarkCount();
}

function openBookmarks() {
  renderBookmarks();
  els.bookmarks.hidden = false;
  els.welcome.hidden = true;
  els.results.hidden = true;
  els.bookmarksToggle.setAttribute('aria-expanded', 'true');
  els.bookmarksToggle.setAttribute('aria-label', '単語帳を閉じる');
  scrollTo({ top: 0, behavior: 'smooth' });
}

function closeBookmarks() {
  if (els.bookmarks.hidden) return;
  els.bookmarks.hidden = true;
  els.results.hidden = false;
  els.welcome.hidden = els.results.childNodes.length > 0;
  els.bookmarksToggle.setAttribute('aria-expanded', 'false');
  els.bookmarksToggle.setAttribute('aria-label', '単語帳を開く');
}

/** Save the list as a JSON file, entirely client-side. */
function downloadBookmarks() {
  const blob = new Blob([JSON.stringify(bookmarks.exportData(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = bookmarks.exportFilename();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Saved words live in localStorage alone, so the badge is correct before -- and
// even without -- the dictionary index.
refreshBookmarkCount();

els.bookmarksToggle.addEventListener('click', () => {
  if (els.bookmarks.hidden) openBookmarks();
  else closeBookmarks();
});

els.exportBookmarks.addEventListener('click', downloadBookmarks);

els.clearBookmarks.addEventListener('click', () => {
  if (!confirm('単語帳をすべて削除します。よろしいですか？')) return;
  bookmarks.clear();
  refreshBookmarkCount();
  renderBookmarks();
  for (const s of els.results.querySelectorAll('.star-btn')) setStarState(s, false);
});

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.bookmarks.hidden) closeBookmarks();
});

/* ------------------------------------------------------------ suggestions */

function hideSuggest() {
  els.suggest.hidden = true;
  els.suggest.innerHTML = '';
}

async function updateSuggest() {
  const query = normalise(els.q.value);
  if (query.length < 2) return hideSuggest();

  const matches = await prefixMatches(query, 8);
  if (!matches.length) return hideSuggest();

  els.suggest.innerHTML = '';
  for (const w of matches) {
    const li = el('li', 'suggest-item');
    li.setAttribute('role', 'option');
    li.textContent = w;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      els.q.value = w;
      search(w);
    });
    els.suggest.append(li);
  }
  els.suggest.hidden = false;
}

/* ----------------------------------------------------------------- wiring */

let debounce;
els.q.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(updateSuggest, 120);
});
els.q.addEventListener('blur', () => setTimeout(hideSuggest, 120));
els.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSuggest(); });

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  els.q.blur();
  search(els.q.value);
});

document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-word]');
  if (!chip) return;
  els.q.value = chip.dataset.word;
  search(chip.dataset.word);
});

// Theme: follow the system unless the reader has chosen otherwise.
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
els.themeToggle.addEventListener('click', () => {
  const current =
    document.documentElement.dataset.theme ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
});

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot().catch(() => {
  els.status.textContent = '辞書データを読み込めませんでした。通信状態を確認してください。';
});
