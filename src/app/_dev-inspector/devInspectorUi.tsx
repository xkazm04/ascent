"use client";

/**
 * Presentational chrome for {@link DevInspector} — the idle Inspect chip,
 * cursor-anchored source label, breadcrumb HUD, and nav-mode hint.
 * Kept separate so the inspector component stays focused on state + wiring
 * (and so each file stays small). Dev-only; never ships to production.
 */

import { useState, type CSSProperties } from "react";

import { ACCENT, DIM, OK, Z } from "./devInspectorMarks";
import { chipLeft, formatHudCopy, isLibraryPath, splitLoc, type LocEntry } from "./devLocate";

export { HighlightBox, Z } from "./devInspectorMarks";

// Chip layout invariants, named so the placement math and the CSS enforce the SAME numbers.
// CHIP_H: rendered chip height (11px font × 1.4 line-height + 2×1px padding ≈ 17px, rounded up with
// margin) — drives the flip-above/below threshold and the vertical offsets. CHIP_MAX_W: the widest
// the chip may render; maxWidth + ellipsis below ENFORCE it (previously the chip was nowrap with no
// maxWidth, so a long `SomeVeryLongComponentName.tsx:1234` overflowed the right edge). The `left`
// clamp uses the chip's ESTIMATED OWN width (chipLeft) rather than this ceiling — clamping a short
// label against 260px pushed it far from the element it labels near the right edge.
const CHIP_H = 20;
const CHIP_MAX_W = 260;

/** A compact `File.tsx:line` chip pinned to the cursor's element. */
export function SourceLabel({ rect, loc }: { rect: DOMRect; loc: string }) {
  const { file } = splitLoc(loc);
  const above = rect.top > CHIP_H + 2; // room for the chip (+2px gap) above the box?
  const top = above ? rect.top - CHIP_H : Math.min(rect.top + 2, window.innerHeight - (CHIP_H + 2));
  const left = chipLeft(rect.left, file, window.innerWidth, { maxWidth: CHIP_MAX_W });
  return (
    <div
      style={{
        position: "fixed",
        top,
        left,
        zIndex: Z,
        pointerEvents: "none",
        font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#0b1220",
        background: ACCENT,
        borderRadius: 4,
        padding: "1px 6px",
        fontWeight: 700,
        whiteSpace: "nowrap",
        maxWidth: CHIP_MAX_W,
        overflow: "hidden",
        textOverflow: "ellipsis",
        boxSizing: "border-box",
        boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
      }}
    >
      {file}
    </div>
  );
}

function CrumbRow({
  entry,
  isDefault,
  skipped,
  onCopy,
}: {
  entry: LocEntry;
  isDefault: boolean;
  /** True when this row sits ABOVE the default target in the chain — i.e. the default right-click
   *  deliberately skipped it as library code. Badged so the redirect is visible, not silent. */
  skipped: boolean;
  onCopy: (loc: string) => void;
}) {
  const { dir, file } = splitLoc(entry.loc);
  const lib = isLibraryPath(entry.path);
  // Hover affordance (inline styles can't carry a :hover): brighten the default row and give the
  // resting rows a faint fill on hover, so a crumb reads as clickable before you click it.
  const [hovered, setHovered] = useState(false);
  const background = isDefault
    ? `${ACCENT}${hovered ? "33" : "22"}`
    : hovered
      ? "rgba(255,255,255,0.06)"
      : "transparent";
  return (
    <button
      type="button"
      onClick={() => onCopy(formatHudCopy(entry.loc))}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={`Copy ${entry.loc}`}
      className="focus-ring"
      style={{
        display: "flex",
        gap: 2,
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        background,
        border: "none",
        borderRadius: 4,
        padding: "2px 4px",
        font: "inherit",
        wordBreak: "break-all",
      }}
    >
      <span style={{ color: ACCENT, opacity: isDefault ? 1 : 0 }}>▶</span>
      <span style={{ color: "#6b7280" }}>{dir}</span>
      <span style={{ color: lib ? "#9ca3af" : "#f1f5f9", fontWeight: 600 }}>{file}</span>
      {skipped && (
        <span style={{ color: DIM, fontSize: 10, alignSelf: "center", whiteSpace: "nowrap" }}>
          skipped (library)
        </span>
      )}
    </button>
  );
}

const PANEL: CSSProperties = {
  position: "fixed",
  left: 12,
  bottom: 12,
  maxWidth: 460,
  pointerEvents: "auto",
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#e5e7eb",
  background: "rgba(17,24,39,0.94)",
  border: `1px solid ${ACCENT}66`,
  borderRadius: 8,
  boxShadow: "0 8px 28px rgba(0,0,0,0.5)",
  padding: "8px 10px",
  backdropFilter: "blur(4px)",
};

const HUD_BTN: CSSProperties = {
  background: "transparent",
  border: `1px solid ${ACCENT}66`,
  borderRadius: 4,
  color: ACCENT,
  cursor: "pointer",
  font: "inherit",
  lineHeight: 1,
  padding: "1px 5px",
};

function HudBtn({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="focus-ring" style={HUD_BTN}>
      {children}
    </button>
  );
}

export function InspectorHud({
  copied,
  copyOk,
  mappingOn,
  crumbs,
  unstamped,
  defaultLoc,
  onCopy,
}: {
  copied: string | null;
  copyOk: boolean;
  mappingOn: boolean;
  crumbs: LocEntry[];
  /** The pointer is over an element with no `data-loc` in its ancestry (as opposed to: the pointer
   *  hasn't moved yet). Two states that both produce an empty crumb list and must NOT look alike. */
  unstamped: boolean;
  defaultLoc: string | null;
  onCopy: (loc: string) => void;
}) {
  // The fixed panel occludes whatever lives in its corner, and insideHud deliberately ignores events
  // over it — so anything underneath (toasts, chat launchers, cookie banners) was uninspectable. A
  // corner toggle flips it to the other side so the covered region becomes reachable.
  const [onRight, setOnRight] = useState(false);
  return (
    // No data-devinspector here: the armed-mode portal wrapper (DevInspector.tsx) already carries it
    // and is an ancestor of this panel, so the insideHud closest() hit-test resolves through it.
    <div style={onRight ? { ...PANEL, left: "auto", right: 12 } : PANEL}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        {/* role=status/aria-live: the Copied/failed swap is the only confirmation right-click did
            anything — announce it to screen readers instead of leaving it visual-only. */}
        <div
          role="status"
          aria-live="polite"
          style={{ color: copied ? (copyOk ? OK : "#fca5a5") : ACCENT, fontWeight: 700 }}
        >
          {copied ? (copyOk ? "Copied ✓" : "Copy failed") : "⌖ DevInspector"}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {defaultLoc ? (
            <>
              <HudBtn label={`Copy ${defaultLoc}`} onClick={() => onCopy(formatHudCopy(defaultLoc, "claude"))}>
                path:line
              </HudBtn>
              <HudBtn
                label={`Copy editor deep-link code -g ${defaultLoc}`}
                onClick={() => onCopy(formatHudCopy(defaultLoc, "vscode"))}
              >
                code -g
              </HudBtn>
            </>
          ) : null}
          <HudBtn
            label={`Move panel to the bottom-${onRight ? "left" : "right"} corner`}
            onClick={() => setOnRight((r) => !r)}
          >
            ⇄
          </HudBtn>
        </div>
      </div>
      {copied ? (
        <div style={{ wordBreak: "break-all" }}>{copied}</div>
      ) : !mappingOn ? (
        <div style={{ color: "#fca5a5", lineHeight: 1.6 }}>
          Source mapping is OFF. Relaunch with:
          <div style={{ color: ACCENT, marginTop: 2 }}>npm run dev:inspect</div>
        </div>
      ) : crumbs.length ? (
        (() => {
          // Rows above the default were SKIPPED by the library heuristic — badge them so a redirected
          // default copy target is visible in the HUD instead of failing silently (dev-inspector #1).
          const defaultIndex = defaultLoc !== null ? crumbs.findIndex((c) => c.loc === defaultLoc) : -1;
          return crumbs.map((c, i) => (
            <CrumbRow
              key={`${c.loc}-${i}`}
              entry={c}
              isDefault={defaultLoc !== null && c.loc === defaultLoc}
              skipped={defaultIndex > 0 && i < defaultIndex}
              onCopy={onCopy}
            />
          ));
        })()
      ) : unstamped ? (
        // Stamps exist in the document (mappingOn) but not on anything under the cursor — a portal, an
        // unstamped module, or a subtree the transform skipped. Naming it is the whole point: an empty
        // highlight that reads like "hover something" is indistinguishable from a broken tool.
        <div style={{ color: "#fbbf24", lineHeight: 1.6 }}>
          No source stamp on this element.
          <div style={{ color: "#9ca3af", fontSize: 11 }}>
            It comes from an unstamped module or a portal — try a parent element.
          </div>
        </div>
      ) : (
        <div style={{ color: "#9ca3af" }}>Hover a component…</div>
      )}
      <div style={{ color: "#6b7280", marginTop: 6, fontSize: 11 }}>
        right-click: path:line · HUD: path:line or code -g · Alt+right-click: this element · click a row · Esc: exit
      </div>
    </div>
  );
}

/** Small bottom-left hint shown after `;`, prompting the second key. */
export function NavHint() {
  return (
    <div data-devinspector style={{ ...PANEL, pointerEvents: "none" }}>
      <span style={{ color: ACCENT, fontWeight: 700 }}>⌖ keyboard mode</span>
      <span style={{ color: "#9ca3af" }}>
        : press <b style={{ color: "#f1f5f9" }}>i</b> to inspect ·{" "}
        <b style={{ color: "#f1f5f9" }}>Esc</b> to cancel
      </span>
    </div>
  );
}

/** Bottom-right idle/armed control: one-click arm, or the mapping-off hint. */
export function InspectChip({ mappingOn, onArm }: { mappingOn: boolean; onArm: () => void }) {
  const style: CSSProperties = {
    ...PANEL,
    left: "auto",
    right: 12,
    zIndex: Z,
    pointerEvents: "auto",
    fontWeight: 700,
    color: mappingOn ? ACCENT : "#fca5a5",
    cursor: mappingOn ? "pointer" : "default",
  };
  if (!mappingOn) {
    return (
      <div data-devinspector role="status" style={style}>
        mapping off → npm run dev:inspect
      </div>
    );
  }
  return (
    <button type="button" data-devinspector onClick={onArm} aria-label="Inspect ; i" className="focus-ring" style={style}>
      Inspect `; i`
    </button>
  );
}
