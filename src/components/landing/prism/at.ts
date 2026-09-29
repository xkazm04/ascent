// Index into one of this landing's fixed-size tables (nine dimensions, five levels, four postures).
// The tables' lengths are invariants of the rubric, so a miss is a bug worth a loud RangeError rather
// than a silent `undefined` painted into a canvas.

export function at<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new RangeError(`prism: index ${i} outside a table of ${a.length}`);
  return v;
}
