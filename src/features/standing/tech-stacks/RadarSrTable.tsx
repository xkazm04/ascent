// The screen-reader equivalent of the overlay radar (§2.6: a dense chart ships a sr-only table built
// from the same data the geometry is). Nine dimensions × N stacks is not readable from an aria-label,
// and the one thing the label CANNOT carry is which cells are holes: `fmtNum(null)` prints the em
// dash, so an unmeasured dimension reads as an absence here exactly as it reads as a gap in the ring.

import { fmtNum, STATE_LABEL } from "@/components/org/viz";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { RadarSeries } from "@/features/standing/tech-stacks/StackRadarChart";

const dimShort = (id: string) => DIMENSION_SHORT[id as keyof typeof DIMENSION_SHORT] ?? id;

export function RadarSrTable({ series, dims }: { series: RadarSeries[]; dims: string[] }) {
  if (series.length === 0) return null;
  return (
    <table className="sr-only">
      <caption>Maturity profile per stack, by dimension (0–100)</caption>
      <thead>
        <tr>
          <th scope="col">Stack</th>
          {dims.map((d) => (
            <th key={d} scope="col">
              {dimShort(d)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {series.map((s) => (
          <tr key={s.id}>
            <th scope="row">{s.name}</th>
            {s.values.map((v, i) => (
              <td key={i}>{v == null ? STATE_LABEL.missing : fmtNum(v, 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
