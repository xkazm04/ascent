// Small shared pieces: the arrow used on calls to action and the "Illustrative" tag every invented
// example carries.

export function Arrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" />
    </svg>
  );
}

export function BackArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14 8H3M7 4L3 8l4 4" />
    </svg>
  );
}

export function IllTag({ children = "Illustrative" }: { children?: string }) {
  return <span className="tag-ill">{children}</span>;
}
