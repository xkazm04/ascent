// Canonical text->slug transform: lowercase, collapse any run of non-alphanumerics to a single
// hyphen, trim leading/trailing hyphens, then cap length. `maxLen` is a required parameter (not a
// baked-in constant) because callers feed this into DIFFERENT downstream limits — a git branch name
// vs. a file path — that happen to want different caps; flattening them to one number would risk
// silently changing what those callers produce. Pass a `fallback` for when the input slugifies to "".
export function slugify(input: string, maxLen: number, fallback = ""): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return s || fallback;
}
