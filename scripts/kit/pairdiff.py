"""Pixel diff of two shot directories: python scripts/kit/pairdiff.py <before-dir> <after-dir> [filter-substring]
Prints changed pixels (threshold 30) per matching file and the bounding box of the change. Exit 1 on any diff."""
import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]
flt = sys.argv[3] if len(sys.argv) > 3 else ""
bad = 0
for f in sorted(os.listdir(b)):
    if not f.endswith(".png") or flt not in f or not os.path.exists(os.path.join(a, f)):
        continue
    x, y = Image.open(os.path.join(a, f)).convert("RGB"), Image.open(os.path.join(b, f)).convert("RGB")
    if x.size != y.size:
        print(f"SIZE {f} {x.size} vs {y.size}"); bad += 1; continue
    d = ImageChops.difference(x, y).convert("L").point(lambda v: 255 if v > 30 else 0)
    n = sum(1 for v in d.getdata() if v)
    print(f"{'DIFF' if n else 'same'} {f} px={n} bbox={d.getbbox()}")
    bad += 1 if n else 0
sys.exit(1 if bad else 0)
