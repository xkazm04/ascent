// The kit's parts, each in its states, on synthetic data. Server component: nothing here fetches.
import {
  Chip,
  ChipRow,
  DataTable,
  CELL,
  CELL_NUM,
  HEAD_CELL,
  KeyValue,
  ListRow,
  ListRows,
  Panel,
  RowList,
  Section,
  Segmented,
  SettingRow,
  StatStrip,
  StatTile,
  Toolbar,
  ToolbarReadout,
} from "@/components/kit";

const TABLE_ROWS = [
  { repo: "sample-api", dim: 1, score: 72, note: "guidance present" },
  { repo: "sample-web", dim: 2, score: 58, note: "tests thin" },
  { repo: "sample-infra", dim: 3, score: 81, note: "gates enforced" },
];

function Part({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" data-specimen={name}>
      <h2 className="type-label tracking-[0.22em] text-slate-500">{name}</h2>
      {children}
    </section>
  );
}

export function KitParts() {
  return (
    <div className="space-y-10">
      <Part name="Panel · base / strong / accent">
        <div className="grid gap-4 md:grid-cols-3">
          <Panel>
            <p className="type-body text-slate-300">Base panel, p-6. The default boxed region.</p>
          </Panel>
          <Panel tone="strong" pad="sm">
            <p className="type-body text-slate-300">Strong tone, p-5, behind a chart.</p>
          </Panel>
          <Panel tone="accent" pad="sm">
            <p className="type-body text-slate-300">Accent tone: the highlighted band.</p>
          </Panel>
        </div>
      </Part>

      <Part name="Section · page / lg / sm">
        <Panel className="space-y-6">
          <Section size="page" kicker="Kicker" title="A page-level heading" intro="An intro line under the title, in the readable muted tone." />
          <Section size="lg" title="A dashboard section heading" intro="Standalone section on a working surface." right={<Chip>right slot</Chip>} />
          <Section size="sm" title="An in-card heading" />
        </Panel>
      </Part>

      <Part name="StatStrip · StatTile (plain, link, delta, goal)">
        <StatStrip>
          <StatTile label="Org maturity" value={72} sub="sample" />
          <StatTile label="With delta" value={64} delta={3} deltaLabel="vs 30d ago" />
          <StatTile label="As a link" value={18} href="#kit" sub="opens evidence" />
          <StatTile label="With goal" value={58} goal={{ target: 70, label: "behind pace", color: "#f97316" }} />
        </StatStrip>
      </Part>

      <Part name="KeyValue · row / stack">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel pad="sm">
            <KeyValue items={[{ key: "Branch", value: "ascent/runner" }, { key: "Repos", value: "2 paired", hint: "of 2 watched" }, { key: "Mode", value: "local" }]} />
          </Panel>
          <Panel pad="sm">
            <KeyValue layout="stack" items={[{ key: "Owner", value: "sample-org" }, { key: "Window", value: "last 90 days" }]} />
          </Panel>
        </div>
      </Part>

      <Part name="ListRows · ListRow (link, plain, trailing) and RowList">
        <div className="grid gap-4 md:grid-cols-2">
          <Panel tone="accent" pad="none" className="px-4 py-3">
            <ListRows>
              <ListRow href="#kit" leading={1} title="A linked, ranked row" detail="Detail line in muted text" trailing={<span className="type-mono-sm text-slate-400">trailing</span>} />
              <ListRow leading={2} title="A plain row" detail="No link, no trailing" />
            </ListRows>
          </Panel>
          <RowList>
            <li className="px-4 py-3 type-body text-slate-300">A row in a divided list frame</li>
            <li className="px-4 py-3 type-body text-slate-300">Each row owns its layout</li>
          </RowList>
        </div>
      </Part>

      <Part name="ChipRow · Chip (tones, dimensions 1 to 9)">
        <ChipRow>
          <Chip>neutral</Chip>
          <Chip tone="success">success</Chip>
          <Chip tone="warn">warn</Chip>
          <Chip tone="danger">danger</Chip>
          <Chip tone="accent">accent</Chip>
        </ChipRow>
        <ChipRow>
          {Array.from({ length: 9 }, (_, i) => (
            <Chip key={i} dimension={i + 1}>
              D{i + 1}
            </Chip>
          ))}
        </ChipRow>
      </Part>

      <Part name="Toolbar · Segmented (solid, soft)">
        <Toolbar
          left={<ToolbarReadout>Showing · last 90 days</ToolbarReadout>}
          right={
            <>
              <Segmented label="Period" value="90d" options={[{ key: "30d", label: "30 days" }, { key: "90d", label: "90 days" }, { key: "all", label: "All time" }]} />
              <Segmented nav variant="soft" label="Views" value="ledger" options={[{ key: "ledger", label: "Ledger", href: "#kit" }, { key: "cockpit", label: "Cockpit", href: "#kit" }]} />
            </>
          }
        />
      </Part>

      <Part name="SettingRow">
        <Panel pad="sm">
          <SettingRow label="Scheduled rescans" description="Re-scan watched repositories on a schedule." control={<Chip tone="success">on</Chip>} />
          <SettingRow label="Retention" description="How long private scans are kept." status="Managed by your plan" control={<Chip>90 days</Chip>} />
        </Panel>
      </Part>

      <Part name="DataTable · head, rows, numeric cells, sticky">
        <DataTable
          caption="Specimen rows"
          minWidth={480}
          maxHeight="12rem"
          head={
            <tr>
              <th className={HEAD_CELL}>Repo</th>
              <th className={HEAD_CELL}>Dimension</th>
              <th className={`${HEAD_CELL} text-right`}>Score</th>
              <th className={HEAD_CELL}>Note</th>
            </tr>
          }
        >
          {TABLE_ROWS.map((r) => (
            <tr key={r.repo}>
              <td className={`${CELL} font-medium text-white`}>{r.repo}</td>
              <td className={CELL}>
                <Chip dimension={r.dim}>D{r.dim}</Chip>
              </td>
              <td className={`${CELL_NUM} text-slate-200`}>{r.score}</td>
              <td className={`${CELL} text-slate-400`}>{r.note}</td>
            </tr>
          ))}
        </DataTable>
      </Part>
    </div>
  );
}
