// One repo's guidance coherence. The score stays paper. Unmeasured is a void, never zero.
import Link from "next/link";
import { Caption, Chip, ChipRow, KeyValue, MonoPath, VoidMark } from "@/components/kit";
import { BASIS_LABEL, type RepoCoherenceRow } from "./guidanceCoherenceModel";

const plain = (s: string) => s.replaceAll(" — ", ", ").replaceAll("—", ", ");

export function CoherenceRepoV2({ r }: { r: RepoCoherenceRow }) {
  return (
    <article className="border-b border-divider py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Link href={`/report/${r.fullName}`} className="text-slate-100 hover:underline">
          <MonoPath>{r.fullName}</MonoPath>
        </Link>
        {r.coherence == null ? (
          <span className="inline-flex items-center gap-2 text-slate-400">
            <VoidMark label={`${r.fullName} coherence: not measured`} />
            not measured
          </span>
        ) : (
          <span className="tabular-nums text-slate-100">{r.coherence}</span>
        )}
      </div>
      <p className="mt-1 text-slate-400">{plain(r.verdict)}</p>
      {r.canonical && (
        <Caption>
          canonical: {r.canonical}
          {r.canonicalBasis ? `, ${BASIS_LABEL[r.canonicalBasis]}` : ""}
        </Caption>
      )}
      {r.projections.length > 0 && (
        <ChipRow className="mt-2">
          {r.projections.map((c) => (
            <Chip key={c.path} title={`${c.path}: ${c.state}`}>
              {c.path} {c.state}
            </Chip>
          ))}
        </ChipRow>
      )}
      {r.penalties.length > 0 && (
        <ul className="mt-3 space-y-1">
          {r.penalties.map((p) => (
            <li key={p.reason} className="text-slate-400">
              <span className="tabular-nums text-slate-200">{p.points} points withheld</span> {p.reason}
              <span className="mt-0.5 block"><MonoPath>{p.paths.join(" / ")}</MonoPath></span>
            </li>
          ))}
        </ul>
      )}
      {r.contradictions.length > 0 && (
        <KeyValue
          className="mt-3"
          layout="stack"
          items={r.contradictions.slice(0, 4).map((c) => ({
            key: `${c.kind} ${c.subject}${c.confidence === "possible" ? ", possible" : ""}`,
            value: `${c.a.path}: "${c.a.quote}"`,
            hint: `${c.b.path}: "${c.b.quote}"`,
          }))}
        />
      )}
    </article>
  );
}
