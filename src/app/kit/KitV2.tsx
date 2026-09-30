// The "v2 language" specimen: every v2 primitive and the upgraded parts, each beside a crop of the landing it
// is measured from (public/dev/kit-ref/*.png, taken from /?landing=prism at 1440x900). In Prism the two columns
// should read as the same identity; in Altimeter the kit column is the shipped fallback. Synthetic data only.
import {
  Caption, Chip, ChipRow, DataTable, CELL, CELL_NUM, DimensionLine, Display, EvidencePanel, Eyebrow, Frame, GhostAction,
  HonestyTag, LevelNav, Lede, MonoPath, Panel, Plate, PrimaryAction, SectionHead, Segmented, SpectralRule, StatStrip, StatTile,
} from "@/components/kit";

const LEVELS = [
  { name: "Manual", band: [0, 24], cells: [false, false, false, false, false, false, false, false, false] },
  { name: "Augmented", band: [45, 64], cells: [true, true, true, false, true, true, false, false, false] },
  { name: "Autonomous", band: [85, 100], cells: [true, true, true, true, true, true, true, true, true] },
] as const;

function Row({ name, note, crop, children }: { name: string; note?: string; crop?: string; children: React.ReactNode }) {
  return (
    <div data-specimen={`v2-${name}`} className="grid gap-4 border-t border-divider py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <p className="font-mono type-mono-sm text-slate-300">{name}</p>
        {note && <p className="type-note text-slate-500">{note}</p>}
        {crop ? (
          // eslint-disable-next-line @next/next/no-img-element -- a dev-only reference crop; next/image adds nothing
          <img src={`/dev/kit-ref/${crop}.png`} alt={`Landing reference: ${name}`} className="max-w-full rounded-[3px] border border-divider bg-black" />
        ) : (
          <p className="type-note text-slate-600">No landing crop: the landing has no dense surface (decision D1).</p>
        )}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

export function KitV2() {
  return (
    <section className="space-y-2" data-specimen="v2">
      <SectionHead
        as="h2"
        eyebrow="v2 language"
        title="The landing's structure,"
        named="as parts."
        lede="Left: a crop of the landing the part is measured from. Right: the kit part in the active theme. Spec: docs/design/KIT-V2-LANGUAGE.md."
      />
      <Row name="Display + Eyebrow + Lede" crop="sechead" note="Statement 300, named phrase 600, eyebrow with the spectral tick, lede capped at 34em.">
        <Eyebrow>The AI-native engineering index</Eyebrow>
        <Display as="h3" level="page" named="Read its spectrum.">
          How AI-native is your engineering?
        </Display>
        <Lede>Ascent splits a repository&apos;s evidence into nine lines and reads each one on its own.</Lede>
        <div className="flex flex-wrap items-baseline gap-6">
          <Display as="p" level="figure">89</Display>
          <Display as="p" level="named">Fix first</Display>
          <Caption>13px caption, mute</Caption>
          <Caption tone="note">15px note, dim</Caption>
          <MonoPath>src/score/guardband.ts</MonoPath>
        </div>
      </Row>
      <Row name="PrimaryAction + GhostAction" crop="actions" note="Paper block with the spectrum underline; hairline ghost. Radius 3px.">
        <div className="flex flex-wrap items-center gap-4 pb-1">
          <PrimaryAction href="/launch">Scan a repository</PrimaryAction>
          <GhostAction href="/org/kiro">Open the org demo</GhostAction>
        </div>
      </Row>
      <Row name="Segmented" crop="segmented" note="Hairline frame, active = paper block.">
        <Segmented label="Team size" options={[{ key: "solo", label: "Solo" }, { key: "team", label: "Team" }, { key: "org", label: "Org" }]} value="org" onSelect={undefined} />
      </Row>
      <Row name="SectionHead" crop="sechead">
        <SectionHead eyebrow="Identity" title="One line in." named="Nine lines out." lede="The whole identity is the product's one act." actions={<GhostAction href="#">Export</GhostAction>} />
      </Row>
      <Row name="Frame + SpectralRule" note="A hairline-ruled band, no box. The rule is the one decorative use of the spectrum.">
        <Frame edge="both" pad="md">
          <Caption>Section content sits on a rule, not in a card.</Caption>
        </Frame>
        <SpectralRule thickness={3} />
        <SpectralRule thickness={2} dimensions={[3, 5, 7]} />
      </Row>
      <Row name="Patterns" note="Quiet background textures, each with a meaning: grid = measured, dots = working surface, hatch = not measured, spectral = dominant section.">
        <div className="grid gap-3 sm:grid-cols-4">
          {(["grid", "dots", "hatch", "spectral"] as const).map((p) => (
            <Frame key={p} edge="both" pad="lg" pattern={p}>
              <Caption>{p}</Caption>
            </Frame>
          ))}
        </div>
      </Row>
      <Row name="DimensionLine" note="Width is the value; hue names the dimension; unmeasured is an empty track; invented values carry a tag.">
        <div>
          <DimensionLine dimension={1} label="AI Tooling & Conventions" value={0.15} display="15%" />
          <DimensionLine dimension={4} label="Agentic Workflows" value={0.12} display="12%" selected />
          <DimensionLine dimension={9} label="Supply Chain & Security" value={0.78} display="78" honesty="illustrative" />
          <DimensionLine dimension={7} label="Commit & Velocity Signals" value={null} display="not measured" />
        </div>
      </Row>
      <Row name="Plate" crop="plates" note="Evidence found is bright, missing is a dark absorption line.">
        {LEVELS.map((l, i) => (
          <Plate key={l.name} name={l.name} band={l.band} cells={l.cells} selected={i === 1} honesty={i === 0 ? "stylised" : undefined} />
        ))}
      </Row>
      <Row name="EvidencePanel" crop="evidence" note="The one boxed object of a surface. Border and glow take the dimension's hue.">
        <EvidencePanel
          dimension={3}
          honesty="illustrative"
          title=".github/workflows/ci.yml"
          via="the CI analyzer"
          code={["on: [pull_request]", "jobs:", "  test:", "    runs-on: ubuntu-latest"]}
          facts={[{ label: "Analyzer", value: "D3 CI/CD & Delivery, deterministic" }, { label: "Supports", value: "L3 Augmented (45-64)" }]}
          guard="The model may quote and explain this line. It cannot move the score outside the analyzer's guardband."
          footer={<LevelNav trail={[{ label: "Ascent", href: "#" }, { label: "D3", href: "#" }, { label: "Evidence 1" }]} back={{ label: "Back to D3", href: "#" }} prev={{ label: "Prev", href: "#" }} next={{ label: "Next", href: "#" }} />}
        />
      </Row>
      <Row name="HonestyTag + Chip" note="Amber tags are the only non-spectral saturated chip; a dimension chip takes its hue in Prism.">
        <div className="flex flex-wrap items-center gap-3">
          <HonestyTag kind="illustrative" />
          <HonestyTag kind="stylised" />
        </div>
        <ChipRow>
          <Chip dimension={2}>D2 Testing</Chip>
          <Chip dimension={6}>D6 Guardrails</Chip>
          <Chip tone="neutral">neutral</Chip>
        </ChipRow>
      </Row>
      <Row name="Upgraded parts: Panel, StatStrip, DataTable" note="Same API as kit-0; in Prism they take the 4px shape, light figures and sans table heads.">
        <Panel pad="sm">
          <Caption>Panel: a boxed focus object at 4px with a hairline.</Caption>
        </Panel>
        <StatStrip cols={3}>
          <StatTile label="Org maturity" value="89" sub="L5 Autonomous" />
          <StatTile label="AI adoption" value="86" />
          <StatTile label="Repos scanned" value="2/2" />
        </StatStrip>
        <DataTable head={<tr><th className={CELL}>Repo</th><th className={CELL_NUM}>Score</th></tr>}>
          <tr><td className={CELL}>kp</td><td className={CELL_NUM}>88</td></tr>
          <tr><td className={CELL}>systedo-case</td><td className={CELL_NUM}>90</td></tr>
        </DataTable>
      </Row>
    </section>
  );
}
