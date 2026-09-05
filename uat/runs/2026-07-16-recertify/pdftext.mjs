import fs from 'fs'; import zlib from 'zlib';
const buf = fs.readFileSync(new URL('./briefing.pdf', import.meta.url));
let i = 0;
const re = new RegExp('\\((?:[^()\\\\]|\\\\.)*\\)', 'g');
while ((i = buf.indexOf(Buffer.from('stream'), i)) !== -1) {
  let s = i + 6; while (buf[s] === 0x0d || buf[s] === 0x0a) s++;
  const e = buf.indexOf(Buffer.from('endstream'), s);
  if (e === -1) break;
  try {
    const inf = zlib.inflateSync(buf.slice(s, e)).toString('latin1');
    const strs = inf.match(re) || [];
    if (strs.length) console.log(strs.join(' '));
  } catch {}
  i = e;
}
