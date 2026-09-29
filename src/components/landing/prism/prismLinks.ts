// Where the Prism landing's calls to action go. The server page resolves these (demo org slug, whether the
// deployment names a source repository) and hands them down as plain strings, so nothing here reads env.

export interface PrismLinks {
  /** Opens the scan dialog: the real ScanModal listens for `?scan=1` on whichever page mounts it. */
  scan: string;
  /** The curated demo org dashboard. */
  org: string;
  /** The deployment's source repository, or null when the operator has not named one. */
  source: string | null;
}

/** Self-host band on the pricing page: the honest stand-in when there is no source URL to link. */
export const SELF_HOST_HREF = "/pricing#self-host";

/** Same landing, scan dialog open. While Prism is a preview it lives behind `?landing=prism`. */
export const PRISM_SCAN_HREF = "/?landing=prism&scan=1";

export const sourceOrSelfHost = (links: PrismLinks): string => links.source ?? SELF_HOST_HREF;
