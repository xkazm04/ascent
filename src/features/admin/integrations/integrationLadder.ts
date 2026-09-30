// Connection and spend ladders. A step with no reading is `unmeasured`, never a zero.
import type { LadderState, LadderStep } from "@/components/kit";
import { statusFor, type IntegrationLevelId, type IntegrationsData } from "./integrationModel";

function step(key: string, label: string, state: LadderState, detail: string): LadderStep {
  return { key, label, state, detail };
}

export function spendLadder(data: IntegrationsData): LadderStep[] {
  const claude = statusFor(data, "claude-code");
  const openaiStatus = statusFor(data, "openai");
  const openaiKey = Boolean(data.openai.connection?.hasCredential);
  const source = openaiKey || Boolean(claude);
  const recorded = Boolean(openaiStatus) || Boolean(claude);
  const attributed = (claude?.repos ?? 0) > 0;
  return [
    step("source", "Cost source", source ? "reached" : "open", source ? "A provider that reports cost is connected." : "None connected."),
    step("landed", "Spend recorded", recorded ? "reached" : source ? "open" : "unmeasured", recorded ? "A cost row has landed." : "Not measured."),
    step(
      "repo",
      "On a repository",
      attributed ? "reached" : claude ? "current" : "unmeasured",
      attributed ? "At least one repository is attributed." : claude ? "Received, but nothing landed on a repository." : "Not measured.",
    ),
  ];
}

export function connectionLadder(data: IntegrationsData, id: IntegrationLevelId): LadderStep[] {
  if (id === "gitlab") return gitlabLadder(data);
  if (id === "claude-code") return claudeLadder(data);
  if (id === "copilot") return copilotLadder(data);
  return openaiLadder(data);
}

function gitlabLadder(data: IntegrationsData): LadderStep[] {
  const stored = data.forgeInstallations.some((row) => row.hasCredential);
  const enc = data.encryptionConfigured;
  return [
    step("storage", "Secret storage", enc ? "reached" : "current", enc ? "This deployment can store a token." : "ENCRYPTION_KEY is not set, so a token will not be stored."),
    step(
      "token",
      "Token stored",
      stored ? "reached" : enc ? "open" : "unmeasured",
      stored ? "A token is stored." : enc ? "No token stored yet." : "Not measured until secrets can be stored.",
    ),
  ];
}

function claudeLadder(data: IntegrationsData): LadderStep[] {
  const status = statusFor(data, "claude-code");
  const ready = data.ingestToken.length > 0;
  const landed: LadderState = status ? (status.repos > 0 ? "reached" : "current") : ready ? "open" : "unmeasured";
  const detail = !status
    ? ready
      ? "No telemetry received yet."
      : "Not measured."
    : status.repos > 0
      ? "Telemetry landed on a repository."
      : "Received, but nothing landed on a repository.";
  return [
    step("ingest", "Ingest secret", ready ? "reached" : "current", ready ? "This deployment can issue a token." : "INTEGRATIONS_INGEST_SECRET is not set."),
    step("landed", "Telemetry landed", landed, detail),
  ];
}

function copilotLadder(data: IntegrationsData): LadderStep[] {
  const status = statusFor(data, "copilot");
  return [
    step("sync", "Sync", status ? "reached" : "open", status ? "Seats and engagement have landed." : "Nothing synced yet."),
    step("cost", "Cost", "unmeasured", "GitHub does not report a per-seat price. Cost stays unknown, not zero."),
  ];
}

function openaiLadder(data: IntegrationsData): LadderStep[] {
  const key = Boolean(data.openai.connection?.hasCredential);
  const enc = data.encryptionConfigured || data.openai.encryptionConfigured;
  const sync = data.openai.connection?.lastSyncStatus ?? null;
  const pull: LadderState = !key ? "unmeasured" : sync === "complete" ? "reached" : sync ? "current" : "open";
  const pullDetail = !key
    ? "Not measured."
    : sync === "complete"
      ? "The last pull completed."
      : sync === "partial"
        ? "The last pull was partial."
        : sync === "failed"
          ? "The last pull failed."
          : "No pull yet.";
  const storageDetail = enc
    ? "This deployment can store a key."
    : key
      ? "A key is stored, but ENCRYPTION_KEY is not set, so it cannot be replaced."
      : "ENCRYPTION_KEY is not set, so no key can be stored.";
  return [
    step("storage", "Secret storage", enc ? "reached" : "current", storageDetail),
    step("key", "Admin key", key ? "reached" : enc ? "open" : "unmeasured", key ? "A key is stored. It is never shown again." : enc ? "No key stored yet." : "Not measured until secrets can be stored."),
    step("pull", "Cost pulled", pull, pullDetail),
  ];
}
