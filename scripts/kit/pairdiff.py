# Pair-diff two shot directories: python scripts/kit/pairdiff.py <before> <after> [threshold]
# Prints changed-pixel counts per matching file; 0 = identical. Expects shoot.mjs (scroll pinned) names.
import sys, os
from PIL import Image
import numpy as np
a, b = sys.argv[1], sys.argv[2]; thr = int(sys.argv[3]) if len(sys.argv) > 3 else 30
bad = 0
for f in sorted(os.listdir(a)):
    if not f.endswith(".png") or not os.path.exists(os.path.join(b, f)): continue
    A = np.asarray(Image.open(os.path.join(a, f)).convert("RGB")).astype(int)
    B = np.asarray(Image.open(os.path.join(b, f)).convert("RGB")).astype(int)
    if A.shape != B.shape: print(f, "SIZE", A.shape, B.shape); bad += 1; continue
    d = int((abs(A - B).sum(2) > thr).sum()); bad += d > 0
    print(f, d)
sys.exit(1 if bad else 0)
