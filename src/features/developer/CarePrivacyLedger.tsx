"use client";

// The privacy ledger — the page's load-bearing trust surface, and now an absence you can SEE.
//
// It used to make its guarantee in prose: "The mentor runs on your machine. This is what it is
// allowed to send", over a two-column list whose right cell said "never" for the locked rows. A
// promise is the wrong shape for a privacy claim — the reader has to trust it, and prose cannot
// enforce it. (It was not even enforcing itself: "locked" was decided by `/never/i` over the row's
// note, which quietly classified "Per-person rows in org mode" as a switch left off.)
//
// So the guarantee is drawn, on the same MatrixGrid the org-side ledger uses. Transcripts, prompts,
// diffs and per-person rows are void in BOTH columns: nothing is sent, and there is no switch that
// could send it. Guarded by `CarePrivacyLedger.dom.test.tsx`, which seeds a ledger claiming those
// rows ARE shared and proves the cells stay empty.

import { Kicker } from "@/components/ui";
import { SectionEmpty } from "@/components/org/shared/ui";
import { Legend, MatrixGrid, StateSwatch } from "@/components/org/viz";
import { timeAgo } from "@/lib/ui";
import { CareAction, CareCopyAction } from "./CareBits";
import { CARE_LEDGER_AXES, careLedgerRows, careNeverSentCount } from "./careLedgerRows";
import type { DeveloperView } from "@/lib/org/developer-view";

export function CareSetupStrip({ setup }: { setup: DeveloperView["setup"] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <span className="type-mono-sm tabular-nums text-slate-400">
        mentor{" "}
        <span className={setup.mentorInstalled ? "text-success-soft" : "text-slate-600"}>
          {setup.mentorInstalled ? "installed" : "not installed"}
        </span>
      </span>
      <span className="type-mono-sm tabular-nums text-slate-400">
        retro hook{" "}
        <span className={setup.hookInstalled ? "text-success-soft" : "text-slate-600"}>
          {setup.hookInstalled ? "on" : "off"}
        </span>
      </span>
      <span className="type-mono-sm tabular-nums text-slate-400">
        last share <span className="text-slate-300">{setup.lastShareAt ? timeAgo(setup.lastShareAt) : "never"}</span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {setup.mentorInstalled ? (
          <CareAction label="Share again" intent="mentor.share" />
        ) : (
          <CareAction label="Install the mentor" intent="mentor.install" />
        )}
        {/* The install path's one real action: the command is on the page to take, by button or by
            hand. The other Care buttons log their intent; a label saying "Copy" cannot. */}
        <CareCopyAction command="npx ascent mentor init" />
      </div>
    </div>
  );
}

export function CarePrivacyLedger({ setup }: { setup: DeveloperView["setup"] }) {
  if (setup.sharing.length === 0) {
    return <SectionEmpty>Nothing is shared, because the mentor has never run here.</SectionEmpty>;
  }

  const rows = careLedgerRows(setup.sharing);
  const never = careNeverSentCount(setup.sharing);
  const sent = setup.sharing.length - never;

  return (
    <div className="mt-4">
      <Kicker tone="muted">
        {setup.sharing.length} fields · {never} with no switch at all
      </Kicker>
      <MatrixGrid
        className="mt-2 max-w-md"
        title="What the mentor on your machine may send"
        axes={CARE_LEDGER_AXES}
        rows={rows}
      />
      {/* Domain labels over the SHARED marks (`StateSwatch`, painted by the same `stateFill` the
          matrix uses). The canonical wording — "Measured", "No measurement" — is about
          observations; these cells are about consent, and a legend that reads wrong is prose in
          another costume. */}
      <Legend
        className="mt-3"
        extra={[
          ...(sent > 0
            ? [
                {
                  id: "sent",
                  label: "Sent on share",
                  swatch: <StateSwatch state="measured" />,
                  hint: "Leaves your machine only when you run `mentor share`, and only as the count named in the row.",
                },
              ]
            : []),
          {
            id: "switch",
            label: "Your switch",
            swatch: <StateSwatch state="decided" />,
            hint: "A person decides this row — you — and can decide otherwise at any time.",
          },
          {
            id: "never",
            label: "No switch exists",
            swatch: <StateSwatch state="missing" />,
            hint: "Void on both axes: nothing is sent and there is no control that could send it. Not a setting left off — a thing the mentor never collects.",
          },
        ]}
      />
    </div>
  );
}
