"""Pass 1: extract English lemma -> Japanese sense data from wnjpn.db.

Emits data/wn-senses.json:
    { "<english lemma>": [ { s, p, jd, jl, ed }, ... ] }

    s  = synset id            p  = part of speech (n/v/a/r/s)
    jd = Japanese definition  jl = Japanese lemmas
    ed = English definition (kept as a secondary hint, gloss examples stripped)
"""
import json
import sqlite3
from collections import defaultdict

DB = "data/wnjpn.db"
OUT = "data/wn-senses.json"

db = sqlite3.connect(DB)
db.text_factory = str
cur = db.cursor()

# --- Japanese definitions, one per synset (prefer the lowest sid = primary) ---
print("loading Japanese definitions...")
jdefs = {}
for synset, sid, text in cur.execute(
    'SELECT synset, sid, "def" FROM synset_def WHERE lang=\'jpn\' ORDER BY synset, sid'
):
    if synset not in jdefs:
        jdefs[synset] = text.strip()

# --- English definitions (strip the trailing quoted usage examples) ---
print("loading English definitions...")
edefs = {}
for synset, sid, text in cur.execute(
    'SELECT synset, sid, "def" FROM synset_def WHERE lang=\'eng\' ORDER BY synset, sid'
):
    if synset not in edefs:
        edefs[synset] = text.split(";")[0].strip()

# --- Japanese lemmas per synset, ordered by sense rank ---
print("loading Japanese lemmas...")
jlemmas = defaultdict(list)
for synset, lemma in cur.execute(
    "SELECT s.synset, w.lemma FROM sense s JOIN word w ON s.wordid = w.wordid "
    "WHERE w.lang='jpn' ORDER BY s.synset, CAST(s.rank AS INTEGER)"
):
    lemma = lemma.strip()
    if lemma and lemma not in jlemmas[synset]:
        jlemmas[synset].append(lemma)

# --- English lemma -> synsets, ordered by sense rank (rank 1 = most common) ---
print("building English lemma index...")
out = defaultdict(list)
rows = cur.execute(
    "SELECT w.lemma, s.synset, sy.pos, s.rank "
    "FROM sense s JOIN word w ON s.wordid = w.wordid "
    "JOIN synset sy ON sy.synset = s.synset "
    "WHERE w.lang='eng' "
    "ORDER BY w.lemma, CAST(s.rank AS INTEGER)"
)

for lemma, synset, pos, rank in rows:
    lemma = lemma.replace("_", " ").strip().lower()
    if not lemma:
        continue
    jl = jlemmas.get(synset, [])
    jd = jdefs.get(synset)
    # A synset with neither a Japanese definition nor Japanese words is useless here.
    if not jd and not jl:
        continue
    rec = {"s": synset, "p": pos}
    if jd:
        rec["jd"] = jd
    if jl:
        rec["jl"] = jl
    ed = edefs.get(synset)
    if ed:
        rec["ed"] = ed
    out[lemma].append(rec)

db.close()

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

total_senses = sum(len(v) for v in out.values())
with_jl = sum(1 for v in out.values() if any("jl" in r for r in v))
print(f"\nEnglish lemmas   : {len(out):,}")
print(f"senses           : {total_senses:,}")
print(f"lemmas w/ JA word: {with_jl:,} ({with_jl/len(out):.1%})")
print(f"wrote {OUT}")
