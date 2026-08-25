# 英和辞典 — an ad-free English→Japanese dictionary

A static, ad-free, tracker-free English→Japanese dictionary for Japanese readers.
Sense definitions are shown **in Japanese**, results are grouped by meaning, and
everything works offline after first use.

No ads, no analytics, no login, no server — it is a folder of static files.

## Why it exists

Existing free E→J dictionaries are saturated with ads. This one is a static site
built from open data, so there is nothing to monetise and nothing to track.

## What makes the lookups usable

JMdict is a *Japanese→English* dictionary. Reversing it gives you Japanese words
for an English query, but every explanation around them is in English — which is
backwards for the intended reader. Two things fix that:

1. **Japanese sense definitions** come from Japanese WordNet, which has a
   Japanese definition for all 117,659 synsets. A search for `run` separates into
   走る行為 / 足で駆けるレース / 定期的に往復すること instead of an undifferentiated
   list of 60 Japanese words.
2. **All 266 JMdict tags are translated** — `v5r` → 五段動詞（ら行）, `vi` → 自動詞,
   `baseb` → 野球. Verified complete by `npm run check:tags`.

Two ranking decisions matter more than they sound:

- **Sense order.** WordNet orders senses by Princeton's English frequency counts,
  which is wrong for a dictionary: for `run` that puts *"a score in baseball"*
  first and 走る seventeenth. Senses are re-ranked by how strongly JMdict
  corroborates them — a sense whose Japanese words are common JMdict headwords
  is the one a reader most likely wants.
- **Katakana demotion.** A katakana transliteration is just the English word in
  Japanese script, so ウォーター loses to 水 for `water` when both are offered. It
  still appears; it just does not lead. Where no native form exists (`computer` →
  コンピュータ) it still ranks first.

Inflected input is handled by suffix stripping plus a table of irregular forms,
so `ran`, `ate`, `children`, `stopped`, `happier` and `knives` all resolve.

## Saved words

The ★ beside a headword saves it to a review list (単語帳), reachable from the
top bar. Each saved word keeps a short Japanese gloss so the list is readable on
its own, and the whole list exports as a versioned JSON file.

It lives in `localStorage` and nowhere else. There is no account to attach it to
and no server to sync it with, which is the point — but it also means the list is
per-browser and clearing site data erases it, so the export is the backup.

## Layout

```
data/          upstream sources + build intermediates (gitignored)
tools/         the build pipeline and its checks
web/           the deployable static site
web/dict/      3,273 generated index shards (85 MB raw, ~30 MB gzipped)
```

## Build

Requires Node 17+ and Python 3.

```sh
npm run fetch     # download JMdict + Japanese WordNet into data/
npm run build     # extract, merge, rank, shard -> web/dict/
npm run serve     # http://127.0.0.1:8777
```

`npm run fetch` resolves the newest JMdict release from the GitHub API. If the
version changed, update `SRC` at the top of `tools/extract-jmdict.mjs` before
building.

### Checks

```sh
npm run check:tags    # all 266 JMdict tags have a Japanese label
npm run check:index   # all 346,355 headwords resolve to the shard they live in
npm run test:e2e      # search assertions over HTTP (needs `npm run serve`)
npm run test:bookmarks # saved-words store, against a localStorage stub
npm run lookup run    # inspect one entry from the built index
```

`check:index` is the important one. The builder splits oversized shards to
deeper prefixes and the client re-derives the shard name independently; if those
two ever disagree, words silently become unfindable. Both sides import the same
`web/search-core.js` and the check confirms every headword round-trips.

## How delivery works

The index is split into prefix shards (`ru.json`, `comp.json`, …), sized so a
lookup fetches ~9 KB gzipped on average. Shards are split deeper until none is
oversized. The service worker precaches the app shell and caches shards as they
are used, so words a reader actually looks up stay available offline without
downloading the full 85 MB.

## Deploying

`web/` is the whole site — any static host works. Two server-side notes:

- Serve `web/dict/*.json` with gzip or brotli. The shards are ~3.5× smaller
  compressed and this is the single biggest performance factor.
- `web/dict/` is generated. It is committed so the site can be deployed
  directly; regenerate it with `npm run build` rather than editing it.

## Data sources and licensing

| Source | Provides | License |
| --- | --- | --- |
| [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (EDRDG) | Japanese words, readings, POS, commonness | CC BY-SA 4.0 |
| [Japanese WordNet](https://bond-lab.github.io/wnja/) (NICT / Bond et al.) | Japanese sense definitions | BSD-like |
| [Princeton WordNet](https://wordnet.princeton.edu/) | Synset structure underlying the above | WordNet license |

JMdict is CC BY-SA 4.0, so **the generated data in `web/dict/` is also
CC BY-SA 4.0** and any redistribution must carry the same license and
attribution. `web/about.html` carries the user-facing attribution — keep it.

## Known limitations

- The merge is mechanical, so some senses attract loosely related words and some
  Japanese WordNet lemmas are noisy. `about.html` says so to the reader.
- Japanese WordNet supplies Japanese lemmas for 48.6% of synsets; the rest have a
  Japanese definition but rely on JMdict for the actual translations.
- Only dictionary-form and common inflections resolve. Multi-word phrases work
  only when JMdict or WordNet has that exact phrase.
- Lookup is English→Japanese only. Japanese input is not searched.
