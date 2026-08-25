/**
 * 英和辞典 — client.
 *
 * The index is split into prefix shards; a lookup fetches exactly one of them
 * (usually ~9 KB gzipped) and everything after that is in-memory. Shards are
 * cached by the service worker, so repeated and offline lookups cost nothing.
 */

import { normalise, shardFor, lookup } from './search-core.js';

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
};

let manifest = null;
let tags = {};
let irregular = {};
const shardCache = new Map();

/** WordNet part-of-speech codes. 's' is an adjective satellite. */
const WN_POS = { n: '名詞', v: '動詞', a: '形容詞', s: '形容詞', r: '副詞' };

/* ---------------------------------------------------------------- loading */

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

  const initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    els.q.value = initial;
    search(initial);
  }
}

async function loadShard(name) {
  if (shardCache.has(name)) return shardCache.get(name);
  const p = fetch(`${DICT}/${name}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  shardCache.set(name, p);
  return p;
}

/* ----------------------------------------------------------------- search */

async function search(rawInput) {
  const query = normalise(rawInput);
  els.welcome.hidden = true;
  hideSuggest();

  if (!query) {
    els.results.innerHTML = '';
    els.status.textContent = '';
    els.welcome.hidden = false;
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

function render(doc, correctedFrom) {
  els.results.innerHTML = '';

  const header = el('div', 'word-header');
  header.append(el('h1', 'word', doc.w));
  els.results.append(header);

  if (correctedFrom) {
    els.results.append(
      el('p', 'corrected', `「${correctedFrom}」の見出し語として「${doc.w}」を表示しています。`)
    );
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
