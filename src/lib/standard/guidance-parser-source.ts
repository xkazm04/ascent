// One authoring source for the zero-dependency scripts' guidance reader.
// Inlined into both emitted scripts; no imports or template-literal embed hazards.
export const GUIDANCE_PARSER_SOURCE = String.raw`function parseGuidance(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^guidance:[ \t]*\r?$/.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^[^\s#]/.test(lines[end])) end++;
  const content = lines.slice(start + 1, end);
  const indentOf = (line) => line.match(/^[ \t]*/)[0].length;
  const fieldIndent = Math.min(...content.filter((line) => line.trim() && !/^\s*#/.test(line)).map(indentOf));
  const gblock = content.filter((line) => indentOf(line) === fieldIndent).join('\n');
  const cm = gblock.match(/^\s+canonical:\s*(.+)$/m);
  const canonical = cm ? cm[1].trim().replace(/^"|"$/g, '') : '';
  const rows = [];
  let projectionIndent = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    const heading = line.match(/^([ \t]+)projections:[ \t]*\r?$/);
    if (heading && heading[1].length === fieldIndent) { projectionIndent = fieldIndent; continue; }
    if (projectionIndent === null || !line.trim() || /^\s*#/.test(line)) continue;
    if (indentOf(line) <= projectionIndent) { projectionIndent = null; continue; }
    const m = line.match(/^\s+-\s*\{\s*agent:\s*([^,]+),\s*path:\s*([^,]+),/);
    if (m) rows.push({ agent: m[1].trim().replace(/^"|"$/g, ''), path: m[2].trim().replace(/^"|"$/g, ''), line: i });
  }
  return { lines, canonical, rows };
}`;
