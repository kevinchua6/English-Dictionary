/**
 * Search logic shared by the browser app and the build-time tests.
 *
 * Kept free of DOM and Node APIs so both can import it directly: if the client
 * and the verifier ever computed shard names differently, words would silently
 * become unfindable.
 */

/** Reduce input to an index key. Must match tools/extract-jmdict.mjs. */
export function normalise(text) {
  let s = String(text).toLowerCase();
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/[.,;:!?"'`]+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^to\s+/, '');
  s = s.replace(/^(a|an|the)\s+/, '');
  return s.trim();
}

/** Shard prefix at a given depth. Must match tools/build-index.mjs. */
export function bucket(word, depth) {
  const cleaned = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  let out = '';
  for (let i = 0; i < depth; i++) {
    const ch = cleaned[i];
    out += ch && /[a-z0-9]/.test(ch) ? ch : '_';
  }
  return out;
}

/**
 * Windows reserves these basenames for character devices, whatever the
 * extension or directory. "prn" is a real headword (pro re nata), so the bucket
 * exists -- and while Node and Python open `prn.json` happily, git refuses to
 * stage it, which makes the shard uncommittable.
 */
const RESERVED_BASENAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/**
 * Filename stem for a shard bucket. The manifest stays keyed by bucket; only
 * the file on disk is renamed. Every reader of web/dict/ must derive this the
 * same way or the shard becomes unfetchable.
 */
export function shardFile(bucket) {
  return RESERVED_BASENAME.test(bucket) ? `${bucket}-shard` : bucket;
}

/** Longest shard prefix present in the manifest for this word. */
export function shardFor(manifest, word) {
  for (let d = manifest.maxPrefix; d >= manifest.minPrefix; d--) {
    const b = bucket(word, d);
    if (manifest.shards[b] !== undefined) return b;
  }
  return null;
}

/**
 * Dictionary-form candidates for a possibly inflected word, best guess first.
 * Irregular forms come from a table; the rest is suffix stripping.
 */
export function variants(word, irregular = {}) {
  const out = [];
  const add = (w) => {
    if (w && w.length > 1 && !out.includes(w)) out.push(w);
  };

  add(word);
  if (irregular[word]) add(irregular[word]);

  // The doubled consonant sits between stem and suffix (swim+m+ing), so it can
  // only be undone once the suffix is off.
  const undouble = (stem) => stem.replace(/([bcdfghjklmnpqrstvwxz])\1$/, '$1');

  if (word.endsWith('ies')) add(word.slice(0, -3) + 'y'); // studies -> study
  if (word.endsWith('ier')) add(word.slice(0, -3) + 'y'); // happier -> happy
  if (word.endsWith('iest')) add(word.slice(0, -4) + 'y'); // happiest -> happy
  if (word.endsWith('ily')) add(word.slice(0, -3) + 'y'); // happily -> happy
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s')) add(word.slice(0, -1));
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    add(stem);
    add(stem + 'e'); // making -> make
    add(undouble(stem)); // swimming -> swim
  }
  if (word.endsWith('ed')) {
    const stem = word.slice(0, -2);
    add(stem);
    add(word.slice(0, -1)); // liked -> like
    add(undouble(stem)); // stopped -> stop
  }
  if (word.endsWith('er')) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
  }
  if (word.endsWith('est')) {
    add(word.slice(0, -3));
    add(word.slice(0, -2));
  }
  if (word.endsWith('ly')) add(word.slice(0, -2));
  return out;
}

/**
 * How useful a result is to a reader. Senses backed by real JMdict entries --
 * especially common ones -- count for far more than bare WordNet synsets, so
 * that "ate" prefers 食べる over 阿手, a goddess who happens to match exactly.
 */
export function scoreDoc(doc) {
  let score = 0;
  for (const s of doc.sn ?? []) {
    if (s.e?.length) {
      score += 12 + s.e.filter((e) => e.c).length * 6;
    } else if (s.jl?.length) {
      score += 2;
    } else {
      score += 1;
    }
  }
  for (const e of doc.o ?? []) score += e.c ? 4 : 1;
  return score;
}

/** True when a result contains at least one everyday JMdict headword. */
function hasCommonEntry(doc) {
  for (const s of doc.sn ?? []) if ((s.e ?? []).some((e) => e.c)) return true;
  return (doc.o ?? []).some((e) => e.c);
}

// The typed form wins ties, but only strongly when it is itself a well-attested
// headword: "swimming" should stay 水泳 rather than fall back to 泳ぐ, while
// "ate" must be free to lose to "eat" (its only exact match is 阿手, a goddess).
const ORIGINAL_BONUS_ATTESTED = 60;
const ORIGINAL_BONUS_WEAK = 5;

/**
 * Resolve a query to the best available entry.
 * `loadShard(name)` returns (a promise of) the shard object.
 */
export async function lookup({ manifest, irregular, loadShard }, rawInput) {
  const query = normalise(rawInput);
  if (!query) return null;

  const candidates = variants(query, irregular);
  let best = null;

  for (const [i, candidate] of candidates.entries()) {
    const name = shardFor(manifest, candidate);
    if (!name) continue;
    const shard = await loadShard(name);
    const doc = shard?.[candidate];
    if (!doc) continue;

    let score = scoreDoc(doc);
    if (i === 0) {
      score += hasCommonEntry(doc) ? ORIGINAL_BONUS_ATTESTED : ORIGINAL_BONUS_WEAK;
    }
    if (!best || score > best.score) best = { doc, matched: candidate, score };
  }

  if (!best) return null;
  return { doc: best.doc, matched: best.matched, query, corrected: best.matched !== query };
}
