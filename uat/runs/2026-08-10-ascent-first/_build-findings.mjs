// Extracts the fenced ```json finding arrays out of the three per-Character L1 reports and
// concatenates them into findings.json. The orchestrator then appends the L2 rows by hand.
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const reports = fs.readdirSync(dir).filter((f) => f.includes("--") && f.endsWith(".md") && !f.endsWith(".L2.md"));

const all = [];
for (const f of reports) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  let found = 0;
  for (const m of src.matchAll(/```json\s*([\s\S]*?)```/g)) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (!rows.length || !rows[0] || typeof rows[0] !== "object" || !("id" in rows[0])) continue;
    all.push(...rows);
    found += rows.length;
  }
  console.error(`${f}: ${found} findings`);
}

all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
fs.writeFileSync(path.join(dir, "findings.json"), JSON.stringify(all, null, 2) + "\n");
console.error(`\ntotal: ${all.length} -> findings.json`);

const by = (k) => all.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.error("severity:", JSON.stringify(by("severity")));
console.error("verdict :", JSON.stringify(by("verdict")));
console.error("recurrence rows:", all.filter((x) => x.recurrence).map((x) => `${x.id}=${x.recurrence}`).join(", ") || "none");
