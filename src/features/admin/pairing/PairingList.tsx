"use client";

// The pairing ledger: every fleet repo with its local-path state, paired rows first (the server
// read orders them). Rows mutate through their own controls; a successful pair/unpair refreshes the
// server component so the ordering and badges stay server-derived — this list never re-sorts
// client-side, which would make a row jump under the cursor the moment it was paired.

import { useRouter } from "next/navigation";
import { SectionEmpty } from "@/components/org/shared/ui";
import { PairingRow } from "./PairingRow";
import type { PairingView } from "./pairingClient";

export function PairingList({ org, initial }: { org: string; initial: PairingView[] }) {
  const router = useRouter();
  if (initial.length === 0) {
    return <SectionEmpty>No repositories in scope yet — add one above, or import your org's fleet from Onboarding.</SectionEmpty>;
  }
  const paired = initial.filter((r) => r.localPath != null).length;
  return (
    <section aria-label="Local pairings">
      <p className="mb-2 font-mono text-xs text-slate-500">
        {paired}/{initial.length} paired · paths resolve on the server running Ascent
        {" · "}under Docker, mount your code and pair the in-container path
      </p>
      <ul className="rounded-xl border border-divider bg-surface/40">
        {initial.map((r) => (
          <PairingRow key={r.fullName} org={org} row={r} onChanged={() => router.refresh()} />
        ))}
      </ul>
    </section>
  );
}
