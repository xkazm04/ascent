// The pipeline copy of the same bar. One evidence panel (the action) is the boxed object on this
// page. The two marks are words: the server policy is enforced, the pasted parameters are a snapshot.
import { CopyForLlm } from "@/components/CopyForLlm";
import { EvidencePanel, Frame, KeyValue, SectionHead } from "@/components/kit";

const RECOPY =
  "Re-copy the snippet after you relax the org bar, or drop the parameters and let the workflow follow the server policy alone.";

/** Break the gate URL on query seams, so a narrow column never splits a parameter name. */
function GateUrl({ query }: { query: string }) {
  const bits = `GET <ASCENT_URL>/api/gate/<owner>/<repo>?${query}`.split(/([?&])/);
  return (
    <span className="font-mono">
      {bits.map((bit, i) => (
        <span key={i}>
          {(bit === "?" || bit === "&") && <wbr />}
          {bit}
        </span>
      ))}
    </span>
  );
}

export function GovernanceCiV2({ gateQuery, snippet }: { gateQuery: string; snippet: string }) {
  return (
    <Frame aria-label="Enforce in CI">
      <SectionHead
        eyebrow="Pipeline"
        title="Enforce the same bar"
        named="in CI."
        actions={<CopyForLlm text={snippet} label="Copy CI snippet" />}
      />
      <div className="mt-5 grid items-start gap-8 lg:grid-cols-2">
        <KeyValue
          layout="stack"
          items={[
            { key: "Server policy", value: "Enforced", hint: "Raising the org bar reaches every pasted workflow immediately." },
            {
              key: "Pasted parameters",
              value: "Snapshot",
              hint: "A tighten-only overlay. Lowering the org bar does not reach a workflow that already pasted a stricter number.",
            },
            {
              key: "Gate API",
              value: <GateUrl query={gateQuery} />,
              hint: "200 means pass. 422 means fail. 503 means the gate could not run (degraded or unmeasured; curl --fail).",
            },
          ]}
        />
        <EvidencePanel title="GitHub Action" via="the org gate" code={snippet.split("\n")} guard={RECOPY} />
      </div>
    </Frame>
  );
}
