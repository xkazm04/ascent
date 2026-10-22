// Prism is the only look; no cookie is read, so callers stay static. Kept (as a constant) only until the
// per-tab composition branches are collapsed.
import type { ThemeId } from "./theme";

export async function getTheme(): Promise<ThemeId> {
  return "prism";
}
