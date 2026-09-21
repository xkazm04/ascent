// "Since you last looked" — the briefing card. Renders exactly what `deriveBriefing` decided: nothing
// at all when nothing happened, a named failure when it could not derive, otherwise at most five lines,
// each a door (an anchor into the section that proves it) whose count carries its predicate as a title.

import { Kicker, Surface } from "@/components/ui";
import type { Briefing } from "./briefingModel";

const READ_WORDS: Record<string, string> = {
  drives: "the runner",
  anchor: "when you last looked",
  runs: "the runs",
  plans: "the plans",
  directions: "the directions",
  lessons: "the lessons",
};

export function LedgerBriefing({ briefing }: { briefing: Briefing | null }) {
  if (!briefing) return null;
  if (briefing.kind === "error") {
    return (
      <Surface role="status" className="px-5 py-4" data-testid="ledger-briefing-error">
        <Kicker tone="muted">Since you last looked</Kicker>
        <p className="mt-2 type-body-sm text-warn">
          Could not derive the briefing — {briefing.missing.map((m) => READ_WORDS[m] ?? m).join(", ") || "a read"} could not be read.
          The sections below say what they could load.
        </p>
      </Surface>
    );
  }
  return (
    <Surface className="px-5 py-4" data-testid="ledger-briefing">
      <Kicker>{briefing.window === "since you last looked" ? "Since you last looked" : "In the last 24 hours"}</Kicker>
      {briefing.window !== "since you last looked" && (
        <p className="mt-1 type-caption text-slate-500">There is no record of your last visit, so this covers the last 24 hours.</p>
      )}
      <ul className="mt-3 space-y-1.5">
        {briefing.lines.map((l) => (
          <li key={l.id}>
            <a
              href={l.href}
              title={l.predicate}
              data-line={l.id}
              className="focus-ring group flex items-baseline gap-2 rounded type-body text-slate-200 hover:text-white"
            >
              <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.current ? "bg-warn" : "bg-accent/70"}`} />
              <span className="underline decoration-divider underline-offset-4 group-hover:decoration-accent">{l.text}</span>
            </a>
          </li>
        ))}
      </ul>
      {briefing.overflow.length > 0 && (
        <p className="mt-2 type-caption text-slate-500" title={briefing.overflow.map((l) => l.text).join(" · ")}>
          …and {briefing.overflow.length} quieter {briefing.overflow.length === 1 ? "change" : "changes"}
        </p>
      )}
    </Surface>
  );
}
