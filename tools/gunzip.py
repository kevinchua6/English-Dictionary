"""Decompress a .gz file. Usage: python tools/gunzip.py <src.gz> <dest>"""
import gzip
import shutil
import sys

src, dest = sys.argv[1], sys.argv[2]
with gzip.open(src, "rb") as fin, open(dest, "wb") as fout:
    shutil.copyfileobj(fin, fout, length=1 << 20)
print(f"wrote {dest}")
