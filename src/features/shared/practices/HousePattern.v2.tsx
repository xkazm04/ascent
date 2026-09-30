// Prism house pattern: a hairline frame. The privacy guarantee is three facts, and the file-contents
// row is a void. Hue appears only when a pattern names its dimension.
import { Caption, DimensionLine, Frame, KeyValue, Lede, SectionHead, VoidMark, parseDimension } from "@/components/kit";
import { MIN_AGREEMENT, type MinedPractice } from "@/lib/org/practice-mining";
import { shapeProvenanceHint, shapeScopeLine } from "./housePatternViz";

// The shared hint keeps its em dashes for the Altimeter matrix. Prism copy uses a comma.
const plain = (s: string) => s.replaceAll(" — ", ", ").replaceAll("—", ", ");

function Lines({ title, lines }: { title: string; lines: { text: string; agreement: number }[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-2">
      <Caption>{title}</Caption>
      <ul className="mt-1 space-y-1">
        {lines.map((l) => (
          <li key={l.text} className="flex items-baseline justify-between gap-3 type-body-sm text-slate-200">
            <span>{l.text.replace(/^#+\s*/, "")}</span>
            <span className="shrink-0 text-slate-400" title="repositories that independently carry this">{l.agreement} agreed</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pattern({ m, reposWithShape }: { m: MinedPractice; reposWithShape: number }) {
  const dim = parseDimension(m.dimId);
  const share = reposWithShape > 0 ? m.exemplars.length / reposWithShape : null;
  const body = (
    <>
      <p className="text-slate-400">
        Shared by {m.exemplars.length} {m.exemplars.length === 1 ? "repository" : "repositories"}: {m.exemplars.join(", ")}.{" "}
        {m.gapRepos.length} {m.gapRepos.length === 1 ? "repository lacks" : "repositories lack"} it.
      </p>
      <Lines title="Shared outline" lines={m.outline} />
      <Lines title="Shared layout" lines={m.layout} />
    </>
  );
  if (!dim) {
    return (
      <div className="border-b border-divider py-3">
        <p className="type-body text-slate-100">{m.label}</p>
        {body}
      </div>
    );
  }
  return (
    <DimensionLine
      wide
      dimension={dim}
      label={m.label}
      value={share}
      display={share == null ? "not measured" : `${m.exemplars.length} share it`}
      detail={body}
    />
  );
}

export function HousePatternV2({ mined, reposWithShape }: { mined: MinedPractice[]; reposWithShape: number }) {
  const offerable = mined.filter((m) => m.offerable);
  const hasAnyPattern = mined.some((m) => m.outline.length > 0 || m.layout.length > 0);
  return (
    <Frame>
      <SectionHead
        eyebrow="House pattern"
        title="Your repositories"
        named={hasAnyPattern ? "share a shape." : "have not been read yet."}
        lede={plain(shapeProvenanceHint(MIN_AGREEMENT))}
        actions={<Caption>{shapeScopeLine(reposWithShape)}</Caption>}
      />
      <div className="mt-4">
        <KeyValue
          items={[
            { key: "Headings", value: "Read, and it travels" },
            { key: "Path layout", value: "Read, and it travels" },
            {
              key: "File contents",
              value: (
                <span className="inline-flex items-center gap-2">
                  <VoidMark label="File contents: not read" />
                  Not read
                </span>
              ),
              hint: "A body is never extracted, so there is nothing to send.",
            },
          ]}
        />
      </div>
      {reposWithShape === 0 && (
        <Lede className="mt-4">
          No repository has been scanned since practice-shape extraction shipped, so there is nothing to mine yet. Re-scan the fleet and this fills in with your own patterns.
        </Lede>
      )}
      {reposWithShape > 0 && !hasAnyPattern && (
        <Lede className="mt-4">
          Nothing is shared across {reposWithShape} scanned {reposWithShape === 1 ? "repository" : "repositories"} yet. A pattern needs at least {MIN_AGREEMENT} repositories to structure an artifact the same way. One strong repository&apos;s document is that team&apos;s document, not a house standard, and promoting it here would say otherwise.
        </Lede>
      )}
      {offerable.length > 0 && (
        <div className="mt-4">
          {offerable.map((m) => (
            <Pattern key={m.practiceId} m={m} reposWithShape={reposWithShape} />
          ))}
        </div>
      )}
      {hasAnyPattern && offerable.length === 0 && (
        <Lede className="mt-4">
          Your repositories do share structure, but no repository is far enough behind on those dimensions to be worth offering it to. That is a good state, not a missing feature.
        </Lede>
      )}
    </Frame>
  );
}
