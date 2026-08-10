// Minimal PDF text extractor for UAT evidence. react-pdf emits its glyphs as <hex> tokens inside
// TJ arrays, so a naive "(...)" literal scraper returns nothing — decode the hex runs instead.
// Usage: node _pdftext.mjs <file.pdf>
import fs from "node:fs";
import zlib from "node:zlib";

const buf = fs.readFileSync(process.argv[2]);
const latin = buf.toString("latin1");

const streams = [];
let idx = 0;
for (;;) {
  const k = latin.indexOf("stream", idx);
  if (k < 0) break;
  let st = k + "stream".length;
  if (latin[st] === "\r") st++;
  if (latin[st] === "\n") st++;
  const e = latin.indexOf("endstream", st);
  if (e < 0) break;
  try {
    streams.push(zlib.inflateSync(buf.subarray(st, e)).toString("latin1"));
  } catch {
    /* not a flate stream */
  }
  idx = e + 1;
}

const hexToStr = (h) => {
  let s = "";
  for (let i = 0; i + 1 < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return s;
};

const lines = [];
for (const content of streams) {
  // Each BT ... ET block is one painted text run.
  for (const m of content.matchAll(/BT([\s\S]*?)ET/g)) {
    const block = m[1];
    let piece = "";
    for (const t of block.matchAll(/<([0-9a-fA-F]+)>/g)) piece += hexToStr(t[1]);
    for (const t of block.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj/g)) piece += t[1];
    if (piece.trim()) lines.push(piece);
  }
}

console.log(lines.join("").replace(/[ \t]+/g, " ").trim());
console.error(`\n[${lines.length} text runs from ${streams.length} streams]`);
