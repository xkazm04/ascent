// The numbered memory format shared by writers, ingestion and presence-only scoring.
// Four digits are the minimum width; longer IDs never carry redundant leading zeroes.
const ID_SOURCE = String.raw`\d{4}|[1-9]\d{4,}`;

export const MEMORY_FILENAME_RE = new RegExp(`^(${ID_SOURCE})-`);
export const MEMORY_ENTRY_RE = new RegExp(`^\\.ai/memory/(${ID_SOURCE})-[^/]+\\.md$`, "i");
