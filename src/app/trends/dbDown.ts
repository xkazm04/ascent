// A strict history read throws `DbUnavailableError` (db/client.ts) where the default read would answer
// null. Matched on its stable `code`, not by import: the barrel does not export the class and the raw
// client module is data-layer internal (layering-rules).
export function isDbDown(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "DB_UNAVAILABLE";
}
