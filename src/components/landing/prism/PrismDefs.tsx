import type { CSSProperties } from "react";

// The identity's two drawn assets as reusable <symbol>s: the mark (an A built as a prism, its crossbar the
// beam) and the wordmark (drawn, not typeset; the crossbar of the t leaves the word as light). Ids carry a
// `prism-` prefix because they share the document with the rest of the app.

export const MARK = "prism-mk";
export const WORDMARK = "prism-wm";

export function PrismDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="prism-mkIn" gradientUnits="userSpaceOnUse" x1="27.7" y1="0" x2="68.7" y2="0">
          <stop offset="0" stopColor="currentColor" />
          <stop offset="1" stopColor="#dfe1ff" />
        </linearGradient>
        <linearGradient id="prism-wmBeam" gradientUnits="userSpaceOnUse" x1="34" y1="0" x2="140" y2="0">
          <stop offset="0" stopColor="#f2eee6" />
          <stop offset=".12" stopColor="#FF5A5F" />
          <stop offset=".24" stopColor="#FF8A3D" />
          <stop offset=".36" stopColor="#FFC247" />
          <stop offset=".47" stopColor="#D4F15B" />
          <stop offset=".57" stopColor="#62E59A" />
          <stop offset=".67" stopColor="#38D9D0" />
          <stop offset=".77" stopColor="#4CB2FF" />
          <stop offset=".87" stopColor="#7C83FF" />
          <stop offset="1" stopColor="#BC6DFF" stopOpacity="0" />
        </linearGradient>
        <symbol id={MARK} viewBox="0 0 100 100">
          <path d="M14 88L50 10L86 88" fill="none" stroke="currentColor" strokeWidth="7.5" strokeLinejoin="miter" />
          <path d="M0 63.8L27.7 58.4" stroke="currentColor" strokeWidth="4.4" />
          <path d="M27.7 58.4L68.7 50.6" stroke="url(#prism-mkIn)" strokeWidth="4.4" />
          <g strokeWidth="3.3" strokeLinecap="butt">
            <path d="M68.7 50.6L100 36" stroke="#FF5A5F" />
            <path d="M68.7 50.6L100 44" stroke="#FFC247" />
            <path d="M68.7 50.6L100 52.4" stroke="#62E59A" />
            <path d="M68.7 50.6L100 61" stroke="#4CB2FF" />
            <path d="M68.7 50.6L100 69.5" stroke="#BC6DFF" />
          </g>
        </symbol>
        <symbol id={WORDMARK} viewBox="-4 -26 480 94">
          <g fill="none" stroke="currentColor" strokeWidth="8">
            <circle cx="30" cy="30" r="26" />
            <path d="M56 4V60" />
            <path transform="translate(74 0)" d="M41 13C37 7 30 4 23 4C13 4 6 9 6 17C6 26 14 28 22 30C32 32 41 35 41 44C41 52 33 56 23 56C14 56 7 53 4 46" />
            <path transform="translate(133 0)" d="M49.9 13.3A26 26 0 1 0 49.9 46.7" />
            <path transform="translate(201 0)" d="M4 30H56A26 26 0 1 0 49.9 46.7" />
            <path transform="translate(273 0)" d="M4 4V60M4 28A24 24 0 0 1 52 28V60" />
            <path transform="translate(341 0)" d="M14 -20V44A16 16 0 0 0 30 60H38M0 8H34" />
          </g>
          <path transform="translate(341 0)" d="M34 8H140" stroke="url(#prism-wmBeam)" strokeWidth="8" />
        </symbol>
      </defs>
    </svg>
  );
}

/** The mark at any size; colour follows `currentColor`. */
export function PrismMark({ className, size }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} aria-hidden="true">
      <use href={`#${MARK}`} />
    </svg>
  );
}

/** The wordmark; height is set by the caller's CSS or `style`. */
export function PrismWordmark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 480 94" aria-hidden="true">
      <use href={`#${WORDMARK}`} width="480" height="94" />
    </svg>
  );
}
