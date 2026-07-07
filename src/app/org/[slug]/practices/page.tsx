import { getOrgPractices, getOrgRollup, getPlaybookAdoption, listPlaybooks } from "@/lib/db";
import { resolveStackScope } from "@/lib/org/scope";
import { DIMENSIONS } from "@/lib/maturity/model";
import { PracticesView } from "@/components/org/practices/PracticesView";

export const dynamic = "force-dynamic";

export default async function OrgPractices({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  // Optional tech-stack scope (Feature 3b): the MINED library honors a ?stack= param; the switcher's
  // client wrapper renders the tab strip + shared modals.
  const { techGroupId } = await resolveStackScope(slug, sp);
  const [playbooks, adoption, rollup, practices] = await Promise.all([
    listPlaybooks(slug),
    getPlaybookAdoption(slug),
    getOrgRollup(slug),
    getOrgPractices(slug, null, techGroupId),
  ]);
  const dimOptions = DIMENSIONS.map((d) => ({ id: d.id, label: d.name }));
  const repoOptions = (rollup?.repos ?? []).map((r) => r.fullName).sort();

  return (
    <PracticesView
      slug={slug}
      initialPlaybooks={playbooks ?? []}
      practices={practices ?? []}
      adoption={adoption}
      dimOptions={dimOptions}
      repoOptions={repoOptions}
    />
  );
}
