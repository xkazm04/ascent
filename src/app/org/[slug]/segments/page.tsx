import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The Segments view was consolidated into the Repositories page as its "?tab=segments" tab (the two
// Fleet views became one). This route is kept only as a permanent redirect so existing links,
// bookmarks, and the removed left-rail item resolve to the merged location instead of 404-ing.
export default async function OrgSegmentsRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/org/${slug}/repositories?tab=segments`);
}
