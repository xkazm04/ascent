// No published stance. One statement, then the four things a stance draws. The editor sits
// under this frame, owned by StanceFrame. The gate distinction lives in the lede.
import { Eyebrow, HairlineGrid, SectionHead } from "@/components/kit";

const BULLETS = [
  { label: "Checkpoint", text: "Which tools and models may cross into org code at all." },
  { label: "Bands", text: "Review requirements per autonomy tier, fed by each repo's real passport tier." },
  { label: "Sealed", text: "Repos and paths closed to AI authorship entirely." },
  { label: "Proof", text: "What a change must carry to show which side of the line it came from." },
];

export function StanceEmptyV2({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  return (
    <div>
      <SectionHead
        eyebrow={`${slug}, perimeter undrawn`}
        title="There is no line."
        lede="Every repo is treated the same by every agent. Without a published stance the fleet has one undifferentiated risk surface: a docs PR and a migration get the same review, and nothing marks the paths that should never be agent-authored. Draw the perimeter once and every repo inherits a band. The maturity gate above is the bar that can fail a change. A published stance is declared policy, and it is not that bar."
      />
      <HairlineGrid className="mt-6 sm:grid-cols-2 lg:grid-cols-4">
        {BULLETS.map((b) => (
          <div key={b.label} className="bg-ink px-4 py-3.5">
            <Eyebrow>{b.label}</Eyebrow>
            <p className="mt-2 type-body-sm text-slate-300">{b.text}</p>
          </div>
        ))}
      </HairlineGrid>
      <p className="mt-6 type-body-sm text-slate-400">
        {canEdit
          ? "Draft the stance below, then publish v1 so repos adopt it as a committed AI_POLICY.md."
          : "An org owner publishes the stance. Once live, this section reads the fleet against it."}
      </p>
    </div>
  );
}
