/**
 * The clipboard write for the DevInspector, as a ladder whose every rung reports itself
 * (agent-pasteable-reference-format): the async write, then the legacy copy command against a
 * temporary off-document field, then "failed" - which the HUD turns into selected text for a manual
 * Ctrl+C instead of a silent no-op that leaves the PREVIOUS clipboard (a different source reference)
 * waiting to be pasted into the agent.
 */
export type CopyRung = "async" | "legacy" | "failed";

export async function copyText(text: string): Promise<CopyRung> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "async";
    }
  } catch {
    /* fall through to the legacy path */
  }
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand("copy") ? "legacy" : "failed";
  } catch {
    return "failed";
  } finally {
    // Every exit path, including a select()/execCommand() that throws: a leaked field would sit in
    // the document and be hit-tested as page content on the next hover.
    ta?.remove();
  }
}
