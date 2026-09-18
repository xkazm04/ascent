// THE SURVEYED FRAME — what the map is before the lane has opened a file: the outline of the ground
// with its corner marks, and the words for why it is blank. Static on purpose: a planning session
// that has not read anything yet is not "loading", and nothing here may look like it is. (A repo that
// already has a map from an earlier session keeps it, dimmed, and the panel's words say so instead.)
//
const CORNERS = ["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"];

export function HeatEmptyMap({ planning, title, sub }: { planning: boolean; title?: string; sub?: string }) {
  const head = title ?? (planning ? "Planning — reading nothing yet" : "No file opened yet");
  return (
    <div data-empty-map="frame" className="absolute inset-0 flex items-center justify-center rounded-xl border border-dashed border-slate-700/80 bg-surface/20">
      {CORNERS.map((c) => (
        <span key={c} aria-hidden className={`absolute h-6 w-6 border-slate-400/70 ${c}`} />
      ))}
      <div className="flex max-w-xl flex-col items-center gap-2 px-6 text-center min-[2400px]:max-w-7xl">
        <p className="type-display font-semibold text-slate-200 min-[2400px]:text-6xl">{head}</p>
        <p className="type-lede text-slate-400 min-[2400px]:text-3xl">
          {sub ?? "The map draws itself from the files this lane opens — cool when it reads, warm when it edits."}
        </p>
      </div>
    </div>
  );
}
