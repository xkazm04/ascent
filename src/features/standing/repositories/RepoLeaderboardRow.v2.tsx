"use client";

// The Prism (v2) leaderboard row: the kit RepoRow with this module's measures in its `cells` and its controls in
// `actions`. Same props and same controls as RepoLeaderboardRow (v1); nothing here decides behaviour. An absent
// measure is the VoidMark, never a bare dash or a zero; a failed scan carries a glyph plus words, not a hue alone.
import { Chip, RepoRow, RepoRowCell, VoidMark } from "@/components/kit";
import { techChips } from "@/lib/org/tech-stack";
import { fmtCompact } from "@/lib/ui";
import { ScheduleSelectV2 } from "./ScheduleSelect.v2";
import { RepoRescanButton } from "./RepoRescanButton";
import { Sparkline } from "./Sparkline";
import { relAge, sum, type RepoFreshness } from "./RepoLeaderboardParts";
import type { LeaderRow } from "./useRepoLeaderboard";

const gap = (subject: string) => <VoidMark subject={subject} />;

export function RepoLeaderboardRowV2({
  r,
  slug,
  schedulable,
  hasSegments,
  selected,
  onToggle,
}: {
  r: LeaderRow & { freshness?: RepoFreshness | null };
  slug: string;
  schedulable: boolean;
  hasSegments: boolean;
  selected: boolean;
  onToggle: (fullName: string) => void;
}) {
  const l = r.latest;
  const a = r.activity;
  const f = r.freshness;
  const chips = r.techStack ? techChips(r.techStack) : [];
  const stack = chips.length > 0 ? [...chips.slice(0, 5).map((c) => <span key={c}>{c}</span>), chips.length > 5 ? <span key="more">+{chips.length - 5}</span> : null] : null;
  const scored = relAge(f?.scoredAt);
  const controls = relAge(f?.controlsAt);
  const flags = [
    r.lastScanStatus === "error" && (
      <Chip key="err" tone="danger" title={r.lastScanError ?? "The most recent scan attempt failed."}>
        ⚠ scan failed
      </Chip>
    ),
    r.aiConformance != null && (
      <Chip key="ai" title="`.ai/` standard conformance reported by this repo's doctor (node .ai/doctor.mjs --json)">
        .ai {r.aiConformance}%
      </Chip>
    ),
    f?.queued && (
      <Chip key="q" title="A scan for this repo is queued and will run in the background">
        queued
      </Chip>
    ),
  ].filter(Boolean);
  return (
    <RepoRow
      name={r.fullName}
      href={l ? `/report/${r.fullName}` : undefined}
      stack={stack}
      chips={flags.length > 0 ? flags : undefined}
      level={l?.level}
      score={l?.overall}
      scoreLabel={l ? `${r.fullName} overall score, level ${l.level}` : `${r.fullName} overall score`}
      leading={
        hasSegments ? (
          <input type="checkbox" checked={selected} onChange={() => onToggle(r.fullName)} aria-label={`Select ${r.fullName}`} className="accent-accent" />
        ) : undefined
      }
      cells={
        <>
          <RepoRowCell label="Commits" title="Commits over the past ~4 weeks, from GitHub">
            {a && a.commitsWeekly.length > 0 ? (
              <span className="flex items-center gap-2">
                <Sparkline values={a.commitsWeekly} color="currentColor" className="text-slate-300" ariaLabel={`${r.name} weekly commits, past ${a.commitsWeekly.length} weeks`} />
                <span title={`${sum(a.commitsWeekly).toLocaleString()} commits over the past ${a.commitsWeekly.length} weeks (from GitHub)`}>{sum(a.commitsWeekly).toLocaleString()}</span>
              </span>
            ) : (
              gap("Commits")
            )}
          </RepoRowCell>
          <RepoRowCell label="PRs" title={a ? `${a.prsTotal.toLocaleString()} total PRs` : undefined}>
            {a ? a.prsMerged.toLocaleString() : gap("Merged PRs")}
          </RepoRowCell>
          <RepoRowCell label="Lines" title={a ? `${a.locChanged.toLocaleString()} lines changed` : undefined}>
            {a && a.locChanged > 0 ? fmtCompact(a.locChanged) : gap("Lines changed")}
          </RepoRowCell>
          <RepoRowCell label="Freshness" title="Two speeds: the last paid score, and the last free control observation.">
            <span className="block" title={f?.scoredAt ? `Last scored ${f.scoredAt}` : "Never scored"}>
              Scored {scored ?? gap("Score age")}
            </span>
            <span className="block text-slate-400" title={f?.controlsAt ? `Controls last observed ${f.controlsAt}` : "Controls not observed yet"}>
              Controls {controls ?? gap("Controls age")}
            </span>
          </RepoRowCell>
        </>
      }
      actions={
        <>
          <ScheduleSelectV2 org={slug} fullName={r.fullName} schedule={r.scanSchedule} disabled={!schedulable} disabledHint="Autoscan scheduling requires the GitHub App." />
          {r.watched ? (
            <RepoRescanButton org={slug} fullName={r.fullName} disabled={!schedulable} disabledHint="Rescanning requires the GitHub App." />
          ) : (
            gap("Rescan (not watched)")
          )}
        </>
      }
    />
  );
}
