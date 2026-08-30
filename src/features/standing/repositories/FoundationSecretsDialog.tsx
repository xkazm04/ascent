"use client";

// The typed-confirmation door in front of a credential write into a customer repo. Extracted from
// FoundationRolloutPanel for the 200-LOC features cap; it owns no data of its own.
//
// The confirmation is the FULL `owner/repo`, echoed by hand — the same shape as the org erase dialog,
// and for the same reason: this is the one action in the rollout that takes effect with no review step
// after it. The disclosure above the field names exactly what will be written and what permission it
// needs, BEFORE the request is issued, so nobody discovers the two secrets by finding them in GitHub.

import { useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader, TextInput } from "@/components/ui";

export const CONFORMANCE_SECRET_NAMES = ["ASCENT_CONFORMANCE_URL", "ASCENT_CONFORMANCE_TOKEN"] as const;

export function FoundationSecretsDialog({
  repo,
  mode,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  /** "owner/name" — also the exact phrase the operator must type. */
  repo: string;
  mode: "provision" | "revoke";
  busy: boolean;
  error: string | null;
  onConfirm: (confirm: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const provisioning = mode === "provision";
  const matches = typed.trim() === repo;

  return (
    <Modal open onClose={onClose} locked={busy} ariaLabel={provisioning ? "Set up report-back" : "Remove report-back"} size="md">
      <ModalHeader
        kicker={provisioning ? "Report-back" : "Remove report-back"}
        title={provisioning ? "Let this repo report its own conformance" : "Remove the report-back credentials"}
        context={repo}
      />
      <ModalBody className="space-y-4">
        {provisioning ? (
          <>
            <p className="type-body-sm text-slate-300">
              Ascent will write two GitHub Actions secrets into <span className="font-mono text-white">{repo}</span>, so
              the foundation&apos;s CI job can post its <span className="font-mono">doctor</span> score back here instead
              of printing <span className="font-mono">reportSkipped</span>.
            </p>
            <ul className="space-y-1 type-mono-sm text-slate-400">
              {CONFORMANCE_SECRET_NAMES.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
            <p className="type-body-sm text-slate-400">
              This needs the GitHub App&apos;s <strong className="text-slate-300">Secrets: write</strong> permission on
              this repo. The token is minted fresh, scoped to <span className="font-mono">telemetry:write</span> (it can
              report a score and nothing else), and is never shown again. You can remove both secrets and revoke the
              token from this panel at any time.
            </p>
          </>
        ) : (
          <p className="type-body-sm text-slate-300">
            Both secrets are deleted from <span className="font-mono text-white">{repo}</span> and the report-back token
            is revoked. Nothing Ascent wrote survives this. The repo keeps its <span className="font-mono">.ai/</span>{" "}
            foundation and can still run the doctor locally — it just stops reporting.
          </p>
        )}

        <label className="block">
          <span className="mb-1 block type-body-sm text-slate-400">
            Type <span className="font-mono text-white">{repo}</span> to confirm
          </span>
          <TextInput
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Type ${repo} to confirm`}
          />
        </label>

        {error && (
          <p role="alert" className="type-body-sm text-danger-soft">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="focus-ring rounded-lg border border-slate-700 px-4 py-2 type-body-sm text-slate-300 transition hover:border-slate-600 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(typed.trim())}
          disabled={busy || !matches}
          className={`focus-ring rounded-lg px-4 py-2 type-body-sm font-semibold transition disabled:opacity-40 ${
            provisioning
              ? "bg-accent text-on-accent hover:bg-accent-soft"
              : "border border-danger/50 text-danger-soft hover:border-danger"
          }`}
        >
          {busy ? "Working…" : provisioning ? "Write the secrets" : "Remove and revoke"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
