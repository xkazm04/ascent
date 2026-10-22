// The page's section links, in scroll order. Ids are the section ids in the markup.

export interface PrismNavItem {
  id: string;
  label: string;
}

/** `register` adds the live register link; it exists only when the page has a gallery to show. */
export function prismNav(register: boolean): readonly PrismNavItem[] {
  return [
    { id: "ladder", label: "Ladder" },
    { id: "method", label: "Method" },
    { id: "beyond", label: "Beyond one repo" },
    ...(register ? [{ id: "register", label: "Register" }] : []),
    { id: "brand", label: "Identity" },
  ];
}
