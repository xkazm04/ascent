// Browser-side theme write, kept out of the component so the switch stays a pure view of its props.
import { THEME_KEY, themeAttr, themeCookieString, type ThemeId } from "./theme";

export function applyTheme(next: ThemeId): void {
  const attr = themeAttr(next);
  if (attr) document.documentElement.dataset.theme = attr;
  else delete document.documentElement.dataset.theme;
  document.cookie = themeCookieString(next);
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    /* storage blocked: the cookie alone carries the choice */
  }
}
