"""Inspect wnjpn.db: schema, row counts, and Japanese-definition coverage."""
import sqlite3

db = sqlite3.connect("data/wnjpn.db")
db.text_factory = str
cur = db.cursor()

print("=== TABLES ===")
tables = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
for t in tables:
    n = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    cols = [c[1] for c in cur.execute(f"PRAGMA table_info({t})")]
    print(f"{t:16} {n:>9,}  ({', '.join(cols)})")

print("\n=== LANGUAGES PER TABLE ===")
for t, col in (("word", "lang"), ("synset_def", "lang"), ("synset_ex", "lang")):
    if t in tables:
        rows = cur.execute(
            f"SELECT {col}, COUNT(*) FROM {t} GROUP BY {col} ORDER BY 2 DESC").fetchall()
        print(f"{t}: {rows}")

print("\n=== JAPANESE DEFINITION COVERAGE ===")
total_syn = cur.execute("SELECT COUNT(*) FROM synset").fetchone()[0]
jpn_def = cur.execute(
    "SELECT COUNT(DISTINCT synset) FROM synset_def WHERE lang='jpn'").fetchone()[0]
jpn_word = cur.execute(
    "SELECT COUNT(DISTINCT synset) FROM sense JOIN word USING (wordid) WHERE word.lang='jpn'"
).fetchone()[0]
print(f"synsets total            : {total_syn:,}")
print(f"synsets w/ Japanese lemma: {jpn_word:,} ({jpn_word/total_syn:.1%})")
print(f"synsets w/ Japanese def  : {jpn_def:,} ({jpn_def/total_syn:.1%})")

# How many synsets have BOTH an English lemma to look up by and Japanese content?
both = cur.execute("""
    SELECT COUNT(DISTINCT s_en.synset)
    FROM sense s_en JOIN word w_en ON s_en.wordid = w_en.wordid AND w_en.lang='eng'
    WHERE s_en.synset IN (
        SELECT s2.synset FROM sense s2 JOIN word w2 ON s2.wordid = w2.wordid
        WHERE w2.lang='jpn')
""").fetchone()[0]
print(f"synsets reachable from English AND having Japanese lemmas: {both:,}")

print("\n=== SAMPLE: 'run' ===")
rows = cur.execute("""
    SELECT sy.synset, sy.pos,
           (SELECT d."def" FROM synset_def d WHERE d.synset=sy.synset AND d.lang='eng' LIMIT 1),
           (SELECT d."def" FROM synset_def d WHERE d.synset=sy.synset AND d.lang='jpn' LIMIT 1),
           (SELECT group_concat(w2.lemma, '/') FROM sense s2
              JOIN word w2 ON s2.wordid=w2.wordid AND w2.lang='jpn'
             WHERE s2.synset=sy.synset)
    FROM word w JOIN sense s ON s.wordid=w.wordid JOIN synset sy ON sy.synset=s.synset
    WHERE w.lemma='run' AND w.lang='eng'
    LIMIT 8
""").fetchall()
for synset, pos, edef, jdef, jlem in rows:
    print(f"\n  [{synset}] pos={pos}")
    print(f"    EN def: {edef}")
    print(f"    JA def: {jdef}")
    print(f"    JA lemmas: {jlem}")

db.close()
