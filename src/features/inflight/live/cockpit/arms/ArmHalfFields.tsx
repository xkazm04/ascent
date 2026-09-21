"use client";

// ONE HALF OF AN ARM — a transport and the model it resolves. Used twice per row: once for the half
// that EXECUTES and, when the disclosure is open, once for the half that PLANS.
//
// The model control changes shape with the transport, and that is the point rather than an
// inconsistency. A Claude model is one of three aliases the deployment already validates, so it is a
// segmented control. A local model is whatever the operator has pulled — an enum of that is a list
// this repo would have to chase — so it is a text field whose only gate is `arm.ts`'s MODEL_TOKEN,
// the same regex the spawn door applies.

import { TextInput } from "@/components/ui";
import { AGENT_MODELS } from "@/lib/local/agent-options";
import { MODEL_TOKEN, type TransportId } from "@/lib/local/arm";
// THE REGISTRY, not a second list of display names. `transport/profile.ts` and everything it
// imports are dependency-free, which is why this import does not drag the spawn side into the
// client bundle — `npm run build` is what proves that, and it is run whenever this import moves.
import { allTransportProfiles } from "@/lib/local/transport/profile";
import { Segmented } from "../RunSetupControls";
import { DEFAULT_MODEL } from "./armDraft";

export interface ArmHalfProps {
  /** Prefixes every accessible name, so two halves in one row are distinguishable to AT. */
  what: string;
  transport: TransportId;
  model: string;
  onChange: (half: { transport: TransportId; model: string }) => void;
  testId: string;
}

export function ArmHalfFields({ what, transport, model, onChange, testId }: ArmHalfProps) {
  const bad = model.trim() !== "" && !MODEL_TOKEN.test(model.trim());
  return (
    <div className="space-y-2">
      <Segmented
        ariaLabel={`${what} transport`}
        testId={`${testId}-transport`}
        value={transport}
        // Switching transport carries the model with it only when the new transport has a default —
        // a Claude alias is meaningless to a local server and vice versa, so the field resets rather
        // than presenting a model that will fail at the spawn door.
        onChange={(t) => onChange({ transport: t, model: DEFAULT_MODEL[t] })}
        // The picker names the BINARY, because that is what a transport is: `Claude Code` and
        // `Pi` are the two things this machine can spawn, and the model field beside it names
        // what they are pointed at.
        options={allTransportProfiles().map((p) => ({ value: p.id, label: p.label }))}
      />
      {transport === "claude" ? (
        <Segmented
          ariaLabel={`${what} model`}
          testId={`${testId}-model`}
          value={model}
          onChange={(m) => onChange({ transport, model: m })}
          options={AGENT_MODELS.map((m) => ({ value: m as string, label: m }))}
        />
      ) : (
        <div>
          <TextInput
            aria-label={`${what} model`}
            data-testid={`${testId}-model`}
            value={model}
            spellCheck={false}
            placeholder="the model id your server knows, e.g. qwen3.8:27b"
            onChange={(e) => onChange({ transport, model: e.target.value })}
          />
          {bad && (
            <p className="mt-1 type-note text-danger">
              Letters, digits and <code>. _ : -</code> only — this reaches a re-parsing shell.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
