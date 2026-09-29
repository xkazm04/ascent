// The page's section links, in scroll order. Ids are the section ids in the markup.

export const PRISM_NAV = [
  { id: "ladder", label: "Ladder" },
  { id: "method", label: "Method" },
  { id: "beyond", label: "Beyond one repo" },
  { id: "brand", label: "Identity" },
] as const;

export const PRISM_NAV_IDS: readonly string[] = PRISM_NAV.map((n) => n.id);
