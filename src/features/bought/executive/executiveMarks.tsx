// Paper movement and a maturity tone. Status is a glyph and a word; the number stays uncolored.
import { Movement, type MastheadTone } from "@/components/kit";
import { DIMENSION_BY_ID, isDimensionId, levelForScore } from "@/lib/maturity/model";

export function scoreTone(value: number): MastheadTone {
  const id = levelForScore(value).id;
  return id === "L4" || id === "L5" ? "good" : id === "L3" ? "watch" : "risk";
}

export function dimensionName(id: string): string {
  return isDimensionId(id) ? DIMENSION_BY_ID[id].name : id;
}

export function PaperMovement({ delta, basis }: { delta: number | null | undefined; basis?: string }) {
  return <Movement delta={delta} basis={basis} toneClass={() => "text-slate-200"} />;
}
