// The "guard it in CI" snippets rendered on /badge, resolved server-side from ONE policy.
//
// Both renderings — the runnable `curl` query string and the GitHub-Action `with:` block — come from
// the canonical enumerators (describeGatePolicy for the per-condition query/CI fragments, ciActionYaml
// for the action ref and indentation, the same builder the org governance page renders). Hand-rolling
// either would let the public page advertise a bar the action doesn't take, which is precisely the
// drift ciActionYaml was single-sourced to prevent. Kept out of page.tsx so it is directly testable
// (a Next page module may only export the page/metadata names, and rendering the whole page pulls the
// site chrome, which suspends outside the Next runtime).

import { ciActionYaml } from "@/lib/org/governance";
import { describeGatePolicy, type GatePolicy } from "@/lib/scoring/gate";

/**
 * The bar the PUBLIC snippets demonstrate. L3 matches the badge generator's default pass bar, and the
 * Security (D9) floor is the point of the section: D9 is the ONE fully-deterministic dimension — the
 * engine takes its signal score verbatim and excludes it from the LLM guardband blend — so a security
 * floor is a bar no model can talk a repo past. That is the gate's strongest turn-it-on argument, and
 * it should be in the snippet a visitor copies, not just in prose.
 */
export const PUBLIC_GATE_POLICY: GatePolicy = { minLevel: "L3", minDimensionFor: { D9: 50 } };

const CONDITIONS = describeGatePolicy(PUBLIC_GATE_POLICY);

/** Workflow YAML enforcing PUBLIC_GATE_POLICY, base-indented (ciActionYaml's contract). */
export const GATE_YAML = ciActionYaml(CONDITIONS.flatMap((c) => (c.ci ? [c.ci] : []))).join("\n");

/** Gate-URL query string for the SAME policy, so the curl line and the workflow can't disagree. */
export const GATE_QUERY = new URLSearchParams(CONDITIONS.flatMap((c) => (c.query ? [c.query] : []))).toString();
