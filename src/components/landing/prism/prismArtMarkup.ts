// One drawn motif per dimension (line art, one hue each). Generators return the INNER markup of a
// 400x400 svg as a string built only from constants in this file, so it is safe to inject; the wrapper
// element is PrismArt.tsx. `reduced` drops the SMIL motion paths (animateMotion) and parks each runner
// on a fixed point, which is the calm version of the same drawing.

const INF = "M200 200C240 140 330 140 330 200C330 260 240 260 200 200C160 140 70 140 70 200C70 260 160 260 200 200Z";
const ORB = "M50 200a150 58 0 1 0 300 0a150 58 0 1 0 -300 0";

function gear(cx: number, cy: number, r: number, teeth: number, depth: number): string {
  let s = "";
  const step = (Math.PI * 2) / teeth;
  for (let j = 0; j < teeth; j++) {
    const a = j * step;
    const pts: Array<[number, number]> = [[r, a], [r + depth, a + step * 0.2], [r + depth, a + step * 0.48], [r, a + step * 0.68]];
    pts.forEach((p, k) => {
      s += `${j === 0 && k === 0 ? "M" : "L"}${(cx + p[0] * Math.cos(p[1])).toFixed(1)} ${(cy + p[0] * Math.sin(p[1])).toFixed(1)}`;
    });
  }
  return `${s}Z`;
}

function motion(reduced: boolean, path: string, dur: number, begin = 0): string {
  return reduced ? "" : `<animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${path}"/>`;
}

import { at } from "./at";

type Maker = (reduced: boolean) => string;

const tests: Maker = () => {
  let s = "";
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 86 + c * 60;
      const y = 86 + r * 60;
      s += `<rect class="d ${(r + c) % 3 ? "" : "o6"}" x="${x}" y="${y}" width="46" height="46" rx="9"/>`;
      s += r === 2 && c === 1
        ? `<path class="d o6" d="M${x + 15} ${y + 15}l16 16M${x + 31} ${y + 15}l-16 16"/>`
        : `<path class="d tick" style="animation-delay:${(0.4 + (r * 4 + c) * 0.06).toFixed(2)}s" d="M${x + 12} ${y + 24}l8 8l15 -17"/>`;
    }
  }
  return `${s}<path class="scan" d="M64 0H336"/>`;
};

const ART: readonly Maker[] = [
  () => '<rect class="d o3" x="84" y="60" width="176" height="226" rx="12"/><rect class="d o6" x="112" y="88" width="176" height="226" rx="12"/><rect class="d" x="140" y="116" width="176" height="226" rx="12"/><path class="d w" d="M166 154h54"/><path class="d" d="M166 188h120M166 212h92M166 236h112M166 260h70M166 284h104M166 308h84"/><circle class="core blink" cx="262" cy="260" r="4"/><path class="d o6" d="M58 330l-22 18 22 18M92 330l22 18-22 18"/>',
  tests,
  (rm) => `<path class="d" d="${INF}"/><path class="d o3" d="${INF}" transform="translate(200 200) scale(1.2) translate(-200 -200)"/><circle class="node" cx="330" cy="200" r="9"/><circle class="node" cx="70" cy="200" r="9"/><circle class="node" cx="200" cy="200" r="9"/><text class="lbl" x="70" y="300">build</text><text class="lbl" x="200" y="300">gate</text><text class="lbl" x="330" y="300">ship</text><circle class="runner" r="6" cx="0" cy="0">${motion(rm, INF, 5)}</circle>${rm ? '<circle class="runner" cx="270" cy="156" r="6"/>' : ""}`,
  (rm) => {
    let s = '<circle class="d" cx="200" cy="200" r="28"/><circle class="core" cx="200" cy="200" r="9"/>';
    [0, 60, 120].forEach((a, k) => {
      s += `<g transform="rotate(${a} 200 200)"><path class="d ${k ? "o6" : ""}" d="${ORB}"/><circle class="runner" r="7" cx="${rm ? 350 : 0}" cy="${rm ? 200 : 0}">${motion(rm, ORB, 6 + k * 2, -k * 1.7)}</circle></g>`;
    });
    return s;
  },
  () => '<path class="d" d="M200 116C168 98 112 94 64 108V300C112 286 168 290 200 308Z"/><path class="d" d="M200 116C232 98 288 94 336 108V300C288 286 232 290 200 308Z"/><path class="d o6" d="M88 142C122 134 156 136 180 146M88 170C122 162 156 164 180 174M88 198C122 190 156 192 180 202M88 226C122 218 156 220 180 230M88 254C122 246 150 248 170 256"/><path class="d o6" d="M312 170C278 162 244 164 220 174M312 198C278 190 244 192 220 202M312 226C278 218 244 220 220 230M312 254C282 246 250 248 230 256"/><path class="d w" d="M270 100V156l12 -10 12 10V98"/>',
  () => '<rect class="d" x="56" y="160" width="288" height="64" rx="16"/><rect class="d o6" x="152" y="174" width="96" height="36" rx="18"/><path class="d o6" d="M184 170v44M216 170v44"/><circle class="bubble" cx="200" cy="192" r="11"/><path class="d o3" d="M76 160v-14M104 160v-9M132 160v-14M268 160v-14M296 160v-9M324 160v-14"/><path class="d" d="M40 300C120 284 280 284 360 300"/><path class="d o6" d="M40 322C120 306 280 306 360 322"/><path class="d o6" d="M72 294v56M136 288v60M200 286v62M264 288v60M328 294v56"/>',
  (rm) => {
    let s = '<path class="d" d="M40 210H360"/><path class="d o6" d="M100 210C130 210 130 140 160 140H240C270 140 270 210 300 210"/><path class="d o6" d="M140 210C160 210 170 280 200 280H250"/>';
    [60, 100, 140, 180, 220, 260, 300, 340].forEach((x) => {
      s += `<circle class="node" cx="${x}" cy="210" r="8"/>`;
    });
    s += `<circle class="node" cx="180" cy="140" r="7"/><circle class="node" cx="220" cy="140" r="7"/><circle class="node" cx="230" cy="280" r="7"/><text class="lbl" x="200" y="118">agent branch</text><text class="lbl" x="226" y="316">open</text><circle class="runner" r="5" cx="${rm ? 260 : 0}" cy="${rm ? 210 : 0}">${motion(rm, "M40 210H360", 3.4)}</circle>`;
    return s;
  },
  () => `<g class="spin" style="transform-origin:170px 186px"><path class="d" d="${gear(170, 186, 72, 12, 15)}"/><circle class="d o6" cx="170" cy="186" r="26"/><path class="d o3" d="M170 160v52M144 186h52"/></g><g class="spin rev" style="transform-origin:276px 272px"><path class="d o6" d="${gear(276, 272, 44, 8, 13)}"/><circle class="d o3" cx="276" cy="272" r="13"/></g><path class="d o3" d="M52 340H348"/>`,
  () => '<rect class="d" x="30" y="186" width="84" height="40" rx="20"/><rect class="d o6" x="92" y="197" width="80" height="18" rx="9"/><rect class="d" x="150" y="186" width="84" height="40" rx="20"/><path class="d w" d="M300 104L366 128V200C366 250 338 284 300 302C262 284 234 250 234 200V128Z"/><path class="d" d="M272 202l20 20 36 -40"/><path class="d o3" d="M300 128V280"/>',
];

/** Inner svg markup for dimension `i`. */
export function artMarkup(i: number, reduced: boolean): string {
  return at(ART, i)(reduced);
}
