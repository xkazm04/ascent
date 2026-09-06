"use client";

// theme-architecture: the three-state preference (light / dark / system) against a simulated
// platform preference; the resolved theme rebinds the scope root and NO component re-renders
// differently. The completeness gate proves every role bound in every theme and every contract pair
// above the contrast floor; "drop a role from light" plants the characteristic defect (a binding
// defined in only one state) so the preview shows what an unbound role does: it falls to the
// inherited value, silently. A nested scope (the opposite theme inside the app) falls out for free.

import { COLOR_ROLES, CONTRAST_FLOOR, completeness, resolveTheme, THEMES, type ColorRole, type Preference, type ThemeId } from "./tokens";
import { Choice, Readout, Region } from "./sceneParts";

export function ThemeRegion({
  pref,
  platform,
  dropped,
  onPref,
  onPlatform,
  onDrop,
}: {
  pref: Preference;
  platform: ThemeId;
  dropped: ColorRole | null;
  onPref: (p: Preference) => void;
  onPlatform: (t: ThemeId) => void;
  onDrop: (r: ColorRole | null) => void;
}) {
  const resolved = resolveTheme(pref, platform);
  const rows = completeness(dropped ? { theme: "light", role: dropped } : null);
  const failures = rows.filter((r) => !r.bound || (r.contrast !== null && r.contrast < CONTRAST_FLOOR));
  const other: ThemeId = resolved === "dark" ? "light" : "dark";
  const nested: Record<string, string> = {};
  for (const role of COLOR_ROLES) nested[`--sx-${role}`] = THEMES[other][role];
  return (
    <Region technique="theme-architecture" title="Rebinding at the root" note="Explicit choice wins in both directions; system follows the platform. Components never ask which theme.">
      <div className="space-y-2">
        <Choice label="preference" value={pref} options={["light", "dark", "system"] as const} onChange={onPref} />
        <Choice label="platform says" value={platform} options={["light", "dark"] as const} onChange={onPlatform} />
        <Readout label="resolved" value={<span data-resolved={resolved}>{resolved}</span>} />
        <Readout label="components branching on theme" value="0" />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="type-caption text-slate-500">completeness gate: every role, every theme, every pair above {CONTRAST_FLOOR}:1</p>
          <table className="mt-1 w-full type-caption">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="font-normal">role</th>
                <th className="font-normal">light</th>
                <th className="font-normal">dark</th>
              </tr>
            </thead>
            <tbody>
              {COLOR_ROLES.map((role) => (
                <tr key={role} className="border-t border-divider text-slate-300">
                  <td className="py-0.5 font-mono">{role}</td>
                  {(["light", "dark"] as const).map((t) => {
                    const r = rows.find((x) => x.theme === t && x.role === role);
                    const low = r?.contrast !== null && r?.contrast !== undefined && r.contrast < CONTRAST_FLOOR;
                    const cls = !r?.bound ? "text-danger" : low ? "text-warn" : "text-slate-500";
                    return (
                      <td key={t} className={`py-0.5 ${cls}`} data-cell={`${t}:${role}`} data-bound={r?.bound}>
                        {!r?.bound ? "unbound" : r.contrast === null ? "bound" : `${r.contrast.toFixed(1)}:1`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="focus-ring mt-2 rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 hover:border-accent" aria-pressed={dropped !== null} onClick={() => onDrop(dropped ? null : "foreground-muted")}>
            {dropped ? "restore foreground-muted in light" : "drop foreground-muted from light"}
          </button>
          <Readout label="gate" value={<span data-completeness={failures.length ? "fail" : "pass"}>{failures.length ? `${failures.length} failing` : "complete"}</span>} tone={failures.length ? "text-danger" : "text-success-soft"} />
        </div>
        <div>
          <p className="type-caption text-slate-500">nested scope: the {other} bindings inside a {resolved} app</p>
          <div className="mt-1 rounded-lg border p-2" style={{ ...nested, background: "var(--sx-surface)", borderColor: "var(--sx-border)", color: "var(--sx-foreground)" }} data-nested-theme={other}>
            <p className="type-caption">a preview pane</p>
            <p className="type-caption" style={{ color: "var(--sx-foreground-muted)" }}>
              same markup, other bindings
            </p>
          </div>
          <p className="mt-2 type-caption text-slate-500">
            {dropped ? "In light, muted text now inherits the foreground: the role resolved to nothing and nothing failed loudly." : "Every role resolves in every reachable state."}
          </p>
        </div>
      </div>
    </Region>
  );
}
