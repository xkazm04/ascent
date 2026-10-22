// The Developer route's entry. Server component: hands the view to the client
// shell, which owns the preview state. Never read cookies in the client file.
import { DeveloperHomeShell } from "./DeveloperHomeShell";
import type { DeveloperView } from "@/lib/org/developer-view";

export async function DeveloperHome({ view, slug }: { view: DeveloperView; slug: string }) {
  return <DeveloperHomeShell view={view} slug={slug} />;
}
