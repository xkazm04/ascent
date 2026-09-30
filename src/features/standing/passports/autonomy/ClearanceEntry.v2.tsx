// One clearance in Prism: a repo row for the credential, then the conditions as facts.
// Status is a glyph and a word. The progress figure stays paper. A missing issue date is a void.
import { Chip, GhostAction, KeyValue, RepoRow, RepoRowCell, VoidMark, type KeyValueItem } from "@/components/kit";
import { reportPermalink, timeAgo } from "@/lib/ui";
import { TIER_META, type AutonomyGate, type GateStatus, type RepoAutonomy } from "./autonomyModel";

const GLYPH: Record<GateStatus, string> = { pass: "✓", partial: "·", fail: "×" };
const WORD: Record<GateStatus, string> = { pass: "passing", partial: "partial", fail: "failing" };

function gateValue(g: AutonomyGate) {
  if (g.held) return <span className="text-slate-400">unassessable</span>;
  return (
    <span>
      <span aria-hidden>{GLYPH[g.status]} </span>
      {WORD[g.status]} <span className="tabular-nums text-white">{g.score}</span>
    </span>
  );
}

function hintFor(g: AutonomyGate): string {
  const source =
    g.source === "derived"
      ? " Proxy, assembled from adjacent fields."
      : g.source === "mock"
        ? " Not observed: a placeholder for this prototype."
        : "";
  return `${g.evidence}${source}`;
}

function facts(repo: RepoAutonomy): KeyValueItem[] {
  const meta = TIER_META[repo.tier];
  const next = repo.nextTier != null ? TIER_META[repo.nextTier] : null;
  const further = repo.blocking.length - 1;
  return [
    { key: "Granted", value: meta.grant, hint: meta.blurb },
    ...repo.gates.map((g) => ({ key: g.label, value: gateValue(g), hint: hintFor(g) })),
    {
      key: next ? `Toward ${next.code}` : "Clearance",
      value: next ? (repo.blocking[0] ?? "All conditions met. Raise the clearance.") : "Top clearance held. This repo can run agents unattended.",
      hint: further > 0 ? `+ ${further} further condition${further === 1 ? "" : "s"}` : undefined,
    },
    {
      key: "Issued",
      value: repo.lastScanAt ? timeAgo(repo.lastScanAt) : <VoidMark subject="Issued" />,
      hint: `confidence ${Math.round(repo.confidence * 100)}%${repo.engine === "mock" ? " · placeholder scan" : ""}`,
    },
  ];
}

export function ClearanceEntryV2({ repo }: { repo: RepoAutonomy }) {
  const meta = TIER_META[repo.tier];
  const next = repo.nextTier != null ? TIER_META[repo.nextTier] : null;
  return (
    <>
      <RepoRow
        name={repo.fullName}
        href={reportPermalink(repo.fullName)}
        level={meta.code}
        score={repo.nextProgress}
        scoreLabel={next ? `${repo.name} is ${repo.nextProgress}% of the way to ${next.code}` : `${repo.name} holds the top clearance`}
        stack={
          <>
            <span className="basis-full">{repo.purpose || "No stated purpose."}</span>
            {repo.stack.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </>
        }
        chips={repo.engine === "mock" ? <Chip tone="neutral">placeholder scan</Chip> : undefined}
        cells={
          <>
            <RepoRowCell label="Automation">{repo.autoScore}</RepoRowCell>
            <RepoRowCell label="Production">{repo.prodScore}</RepoRowCell>
          </>
        }
        actions={<GhostAction href={reportPermalink(repo.fullName)}>Report</GhostAction>}
      />
      <li className="py-4">
        <KeyValue layout="stack" items={facts(repo)} />
      </li>
    </>
  );
}
