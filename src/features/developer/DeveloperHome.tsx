// The Developer route's entry. Server component: reads the theme once (cookie) and hands it to the client
// shell, which owns the preview state and picks the composition. Never read cookies in the client file.
import { getTheme } from "@/lib/theme/server";
import { DeveloperHomeShell } from "./DeveloperHomeShell";
import type { DeveloperView } from "@/lib/org/developer-view";

export async function DeveloperHome({ view, slug }: { view: DeveloperView; slug: string }) {
  return <DeveloperHomeShell view={view} slug={slug} theme={await getTheme()} />;
}
