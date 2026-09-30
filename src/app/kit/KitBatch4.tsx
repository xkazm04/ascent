"use client";

// Kit batch 4 specimen (2026-09-30): FormField with its controls, the pressable ListRow and the non-hue
// Ladder / CellMark. Synthetic data only; nothing here is a measurement.
import { CellMark, FormField, Input, Ladder, ListRow, RowList, Select, Textarea } from "@/components/kit";

function Row({ name, note, children }: { name: string; note: string; children: React.ReactNode }) {
  return (
    <div data-specimen={`b4-${name}`} className="grid gap-4 border-t border-divider py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <p className="font-mono type-mono-sm text-slate-300">{name}</p>
        <p className="type-note text-slate-400">{note}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

export function KitBatch4() {
  return (
    <section aria-label="Kit batch 4" className="mt-12">
      <p className="type-label tracking-[0.22em] text-slate-400">Batch 4 · forms, pressable rows, non-hue status</p>
      <Row name="FormField" note="Label above, hint or error below. An error is a word with a glyph, not a colour.">
        <FormField label="Repository" htmlFor="kb4-repo" hint="owner/name, as on GitHub">
          <Input id="kb4-repo" placeholder="acme/payments" />
        </FormField>
        <FormField label="Model" htmlFor="kb4-model">
          <Select id="kb4-model" defaultValue="a">
            <option value="a">Claude Sonnet</option>
            <option value="b">Local model</option>
          </Select>
        </FormField>
        <FormField label="Notes" htmlFor="kb4-notes" error="Notes must be under 500 characters.">
          <Textarea id="kb4-notes" rows={3} defaultValue="A sample note that failed validation." />
        </FormField>
      </Row>
      <Row name="ListRow onPress / selected" note="The whole row is a button that opens a level in place; the open row carries a paper edge.">
        <RowList radius="xl">
          <ListRow title="Agent guidance" detail="1 practice, 100% adopted" onPress={() => {}} selected />
          <ListRow title="Test discipline" detail="1 practice, 100% adopted" onPress={() => {}} />
        </RowList>
      </Row>
      <Row name="Ladder" note="State by glyph, word and lightness: reached paper, current dashed, open hairline, unmeasured hatched.">
        <Ladder
          label="Autonomy tiers"
          steps={[
            { key: "0", label: "T0 Observe", state: "reached", detail: "3 of 3 gates" },
            { key: "1", label: "T1 Suggest", state: "current", detail: "2 of 4 gates" },
            { key: "2", label: "T2 Act with review", state: "open" },
            { key: "3", label: "T3 Autonomous", state: "unmeasured", detail: "No data yet" },
          ]}
        />
      </Row>
      <Row name="CellMark" note="One matrix cell: glyph plus word, never colour alone.">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <CellMark state="met" />
          <CellMark state="partial" />
          <CellMark state="missing" />
          <CellMark state="unmeasured" />
        </div>
      </Row>
    </section>
  );
}
