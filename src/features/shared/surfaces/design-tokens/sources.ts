// Source excerpts for the mechanism drawer, verbatim from this scene's own files (tokens.ts,
// motionLadder.ts, lint.ts and the panels). String constants so the drawer needs no build step; when
// the code moves, these move with it in the same commit.

export const SRC_TAXONOMY = `// tokens.ts: layer 1 is a ramp with no meaning; layer 2 is roles with a one-sentence definition
export const PRIMITIVES = { slate: { 50: "#f8fafc", …, 950: "#080d1a" }, azure: { 500: "#3b9eff", 700: "#1d6fd1" }, … };
export const COLOR_ROLES = ["surface", "surface-raised", "foreground", "foreground-muted", "border", "accent", "on-accent", "danger"];
export const ROLE_DEFINITION = { "foreground-muted": "secondary text: metadata, footnotes", … };
// TaxonomyPanel.tsx: the admission desk. Grammar first, then the three tests; the default is the nearest role
const VALUE_IN_NAME   = /(gr[ae]y|blue|red|green|azure|slate|amber|\\d{2,})/i;
const ADDRESS_IN_NAME = /(page|screen|settings|header|footer|modal|sidebar|table|form)/i;
export function judgeName(name) {
  if (VALUE_IN_NAME.test(n))   return { ok: false, reason: "refused: the value is in the name; names carry intent, bindings carry values" };
  if (ADDRESS_IN_NAME.test(n)) return { ok: false, reason: "refused: a street address, not a role" };
  if (!GRAMMAR.test(n))        return { ok: false, reason: "refused: the grammar is <axis>-<role>[-<variant>][-<state>]" };
  return { ok: true, reason: "grammar holds; now the three tests" };
}
const earns = judged.ok && passes === TESTS.length;   // recurring intent, variance, owner-answerable`;

export const SRC_THEME = `// tokens.ts: a theme is a complete binding set; the three-state model resolves at one place
export const THEMES = { dark: { surface: PRIMITIVES.slate[900], …, "on-accent": PRIMITIVES.slate[950] }, light: { … } };
export function resolveTheme(pref, platform) { return pref === "system" ? platform : pref; }
export function completeness(dropped) {          // every role bound in every theme, every pair above the floor
  for (const theme of ["light", "dark"]) for (const role of COLOR_ROLES) {
    const bound = !(dropped && dropped.theme === theme && dropped.role === role);
    const contrast = bound && pair ? contrastRatio(THEMES[theme][role], THEMES[theme][pair[1]]) : null;
  }
}
// scopeVars(): the generated mirror on the scope root; a dropped role is simply ABSENT
for (const role of COLOR_ROLES) {
  if (s.dropped && s.dropped.theme === s.theme && s.dropped.role === role) continue;
  out[\`--sx-\${role}\`] = THEMES[s.theme][role];
}
// Preview.tsx: the card references role names only, never a theme
<p style={{ fontSize: v("type-caption"), color: v("foreground-muted") }}>{PREVIEW_REPO.meta}</p>`;

export const SRC_PARITY = `// motionLadder.ts: strategy 3, the gated mirror; the gate refuses to certify an empty read
export function parityCheck(authority, mirror) {
  if (a.length === 0 || m.length === 0)
    return { status: "broken", members: 0, findings: ["instrument read 0 … members: refusing to report"] };
  for (const k of a) {
    if (!(k in mirror)) findings.push(\`\${k}: missing from the mirror\`);
    else if (mirror[k] !== authority[k]) findings.push(\`\${k}: authority \${authority[k]}ms, mirror \${mirror[k]}ms\`);
  }
  for (const k of m) if (!(k in authority)) findings.push(\`\${k}: phantom, exists only in the mirror\`);
  return { status: findings.length ? "drift" : "parity", members: a.length, findings };
}
// tokens.ts + Preview.tsx: strategy 1, one source, generated mirror
for (const role of SPACE_ROLES) out[\`--sx-\${role}\`] = \`\${DENSITY[s.density][role]}px\`;   // style layer, generated
const rowH = DENSITY[density]["row-h"];   // script layer: the authority, not a remembered 36
<svg width={width} height={rowH} data-row-h={rowH}>`;

export const SRC_ENFORCEMENT = `// lint.ts: ban + pointer, and severity as the design decision
const RULES = [
  { test: /text-\\[\\d+px\\]/,     equivalent: "type-caption (the recipe, not a size)" },
  { test: /#[0-9a-f]{6}/i,       equivalent: "a color role: surface, border, foreground" },
  { test: /duration-\\[\\d+ms\\]/, equivalent: "duration-base (the ladder; 187ms is between steps)" },
];
export function verdict(open, severity, baseline) {
  if (severity === "warn")  return { passes: true, line: \`build passes with \${open} warnings: nothing enforced\` };
  if (severity === "error") return open === 0 ? { passes: true, … } : { passes: false, line: \`build fails: \${open} raw values with equivalents\` };
  return open > baseline ? { passes: false, line: \`build fails: \${open} exceeds the \${baseline} baseline\` }
                         : { passes: true,  line: \`build passes: \${open} of \${baseline} baseline, burning down\` };
}
export function suppressionPosture(count) { return count <= 10 ? "policy" : count < 100 ? "watch" : "dialect"; }
// EnforcementPanel.tsx: the baseline is the debt snapshotted when the ratchet was wired
const baseline = findings.filter((f) => !f.suppressed).length;
const open = baseline + added - suppressedExtra;`;

export const SRC_MOTION = `// motionLadder.ts: a ladder of named steps; reduced motion rebinds it at the token layer
export const DURATION_MS = { instant: 60, fast: 120, base: 240, slow: 400, deliberate: 640 } as const;
export const EASING = { enter: "cubic-bezier(0.16, 1, 0.3, 1)", exit: …, move: …, expressive: … } as const;
const TRAVEL_STEPS = ["fast", "base", "slow", "deliberate"];
export function ladderFor(reduced) {
  const out = { ...DURATION_MS };
  if (reduced) for (const s of TRAVEL_STEPS) out[s] = REDUCED_EPSILON_MS;   // 1ms, never 0: transitionend still fires
  return out;
}
export function motionVars(reduced) {
  for (const s of STEPS) out[\`--sx-duration-\${s}\`] = \`\${ladder[s]}ms\`;
  for (const r of EASING_ROLES) out[\`--sx-ease-\${r}\`] = reduced && r === "expressive" ? EASING.move : EASING[r];
}
// MotionPanel.tsx: the chip references the variable and never reads the preference
<span style={{ transform: out ? "translateX(72px)" : "translateX(0)",
               transition: \`transform var(--sx-duration-\${step}) var(--sx-ease-move)\` }} />`;

export const SRC_AXES = `// tokens.ts: each axis rebinds a DISJOINT slice of the vocabulary
export const DENSITY = { comfortable: { "space-card": 16, "space-row": 10, "row-h": 36 }, compact: { "space-card": 10, "space-row": 4, "row-h": 24 } };
export const TYPE_BASE_PX = { "type-caption": 13, "type-body": 15, "type-figure": 25 };
export const AXIS_OWNERSHIP = { theme: COLOR_ROLES, density: SPACE_ROLES, "text-scale": TYPE_ROLES };
for (const role of SPACE_ROLES) out[\`--sx-\${role}\`] = \`\${DENSITY[s.density][role]}px\`;
for (const role of TYPE_ROLES)  out[\`--sx-\${role}\`] = \`\${Math.round(TYPE_BASE_PX[role] * s.scale)}px\`;
// AxesPanel.tsx: the unit-discipline prerequisite, as arithmetic over the authority
const needed = Math.round(TYPE_BASE_PX["type-body"] * scale * LINE_HEIGHT * LINES);
const clipped = needed > FIXED_PX;
<div style={{ height: FIXED_PX }} className="overflow-hidden">                 // px box: clips at 1.15x
<div style={{ minHeight: \`\${LINES * LINE_HEIGHT}em\`, fontSize: "var(--sx-type-body)" }}>  // em box: grows`;
