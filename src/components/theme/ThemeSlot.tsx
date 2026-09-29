// Server wrapper: reads the theme cookie once and hands it to the client switch, so the selected tab is
// right in the first HTML (no post-mount correction).
import { getTheme } from "@/lib/theme/server";
import { ThemeSwitch } from "./ThemeSwitch";

export async function ThemeSlot() {
  return <ThemeSwitch initial={await getTheme()} />;
}
