// Pure DOM probes the scene uses to SEE the target rather than a proxy (gate-sees-target): the
// sequential-focus walk (what Tab would reach), the accessible-name computation in precedence order,
// and the described-by chain. No React. jsdom runs no layout, so the walk reasons from attributes the
// way sequential focus navigation does: `inert` and `hidden` ancestors, `disabled`, `tabindex="-1"`.

export const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Every element Tab could land on under `root`, in document order. */
export function tabStops(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.getAttribute("tabindex") === "-1") return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.closest("[inert]") || el.closest("[hidden]")) return false;
    return true;
  });
}

export type NameSource = "aria-labelledby" | "aria-label" | "label" | "content" | "placeholder" | "title" | "none";

/** The accessible name, computed in precedence order, and WHICH source won. */
export function computeName(el: HTMLElement): { name: string; source: NameSource } {
  const doc = el.ownerDocument;
  const byIds = (attr: string) =>
    (el.getAttribute(attr) ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
  const labelledBy = byIds("aria-labelledby");
  if (labelledBy) return { name: labelledBy, source: "aria-labelledby" };
  const ariaLabel = el.getAttribute("aria-label")?.trim();
  if (ariaLabel) return { name: ariaLabel, source: "aria-label" };
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = Array.from(el.labels ?? []).map((l) => l.textContent?.trim() ?? "").filter(Boolean);
    if (labels.length) return { name: labels.join(" "), source: "label" };
  } else {
    const content = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (content) return { name: content, source: "content" };
  }
  const placeholder = el.getAttribute("placeholder")?.trim();
  if (placeholder) return { name: placeholder, source: "placeholder" };
  const title = el.getAttribute("title")?.trim();
  if (title) return { name: title, source: "title" };
  return { name: "", source: "none" };
}

/** The accessible description: every `aria-describedby` target, in the order the attribute lists. */
export function computeDescription(el: HTMLElement): string {
  const doc = el.ownerDocument;
  return (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(". ");
}

export type GateReport = {
  controlsExamined: number;
  nameless: string[];
  stops: number;
  stopsInHiddenSubtrees: number;
  liveRegions: number;
};

/**
 * The scene's automated gate, run over its own DOM. Every count carries its predicate in the region
 * copy (count-carries-predicate); zero controls examined is a FAILED RUN, never a pass
 * (failure-not-empty-success) — the caller reads `controlsExamined` before it reads anything else.
 */
export function runGates(root: ParentNode): GateReport {
  const controls = Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea"));
  const nameless = controls.filter((el) => computeName(el).name === "" && !el.closest("[aria-hidden='true']")).map((el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ""));
  const stops = tabStops(root);
  const leaks = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute("tabindex") !== "-1" && !(el as HTMLButtonElement).disabled && el.closest("[data-visually-hidden='true']") && !el.closest("[inert]") && !el.closest("[hidden]"),
  );
  return {
    controlsExamined: controls.length,
    nameless,
    stops: stops.length,
    stopsInHiddenSubtrees: leaks.length,
    liveRegions: root.querySelectorAll("[aria-live]").length,
  };
}
