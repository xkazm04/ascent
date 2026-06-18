/** Canonical `owner/repo` key for comparing what we asked for against what a peek returned. */
export function repoKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
}
