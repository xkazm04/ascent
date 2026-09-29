// Server-side read of the theme cookie. Reading cookies makes the caller dynamic: previously static
// marketing routes now render per request. That cost is duality scaffolding and goes away when one
// theme is retired (docs/design/KIT-REDESIGN-PROCESS.md, "Retiring the duality").
import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, type ThemeId } from "./theme";

export async function getTheme(): Promise<ThemeId> {
  const store = await cookies();
  return parseTheme(store.get(THEME_COOKIE)?.value);
}
