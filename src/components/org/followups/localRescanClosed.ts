// Persist-closed follow-ups on a Local Rescan response. Trailer claims live on `claimedFollowUps`
// and are never counted here — the same split `rescanWorktree` already makes (`closedIds` vs
// `claimedIds`). `LocalRescanButton` totals this set; a zero means the rescan confirmed nothing,
// not "no trailers found".

export function persistClosedFollowUps(body: {
  closedFollowUps?: readonly string[] | null;
} | null | undefined): readonly string[] {
  return body?.closedFollowUps ?? [];
}

export function persistClosedCaption(closed: number): string {
  if (closed > 0) return `${closed} follow-up${closed === 1 ? "" : "s"} closed ✓`;
  return "no follow-ups closed — a trailer is a claim until this rescan confirms it";
}
