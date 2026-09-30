// The open integration is the URL hash (`#gitlab`, `#claude-code`, `#copilot`, `#openai`).
import { isIntegrationLevel, type IntegrationLevelId } from "./integrationModel";

export function readIntegrationHash(): IntegrationLevelId | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "");
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return isIntegrationLevel(decoded) ? decoded : null;
}

export function publishIntegrationHash(id: IntegrationLevelId | null): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (id) {
    if (window.location.hash === `#${id}`) return;
    window.location.hash = id;
    return;
  }
  if (!window.location.hash) return;
  window.history.pushState(null, "", `${pathname}${search}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
