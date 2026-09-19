// Merges the L2 rows into findings.json. Rows carrying _l2_action:"update-in-place" patch the
// existing L1 row (preserving impact_l1/severity_l1 so the L1->L2 delta stays machine-visible,
// per the v1.2 rule); everything else is appended as a new row.
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const findings = JSON.parse(fs.readFileSync(path.join(dir, "findings.json"), "utf8"));
const l2 = JSON.parse(fs.readFileSync(path.join(dir, "_l2-findings.json"), "utf8"));

for (const row of l2) {
  const { _l2_action, ...patch } = row;
  if (_l2_action === "update-in-place") {
    const target = findings.find((f) => f.id === row.id);
    if (!target) {
      console.error(`!! no L1 row for ${row.id} — appending instead`);
      findings.push(patch);
      continue;
    }
    // Preserve the L1 scores before overwriting, so the widening is machine-visible.
    if (patch.impact && !target.impact_l1) target.impact_l1 = target.impact;
    if (patch.severity && !target.severity_l1) target.severity_l1 = target.severity;
    Object.assign(target, patch);
    console.error(`patched ${row.id} -> cert_level ${target.cert_level}, verdict ${target.verdict}`);
  } else {
    findings.push(patch);
    console.error(`appended ${row.id}`);
  }
}

findings.sort((a, b) => String(a.id).localeCompare(String(b.id)));
fs.writeFileSync(path.join(dir, "findings.json"), JSON.stringify(findings, null, 2) + "\n");

const by = (k) => findings.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.error(`\ntotal ${findings.length}`);
console.error("cert_level:", JSON.stringify(by("cert_level")));
console.error("severity  :", JSON.stringify(by("severity")));
console.error("verdict   :", JSON.stringify(by("verdict")));
console.error("resolution:", JSON.stringify(by("resolution")));
console.error("resolved-verified rows WITH a ceiling:", findings.filter((f) => f.resolution === "resolved-verified" && f.ceiling).length);
console.error("recurrence:", findings.filter((f) => f.recurrence > 1).map((f) => `${f.id}=${f.recurrence}`).join(", "));
