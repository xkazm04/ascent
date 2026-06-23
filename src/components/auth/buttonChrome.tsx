// Shared chrome for the GitHub sign-in CTAs. Both the custom-OAuth GitHubSignInButton (an anchor that
// navigates to /api/auth/login) and the Supabase SupabaseSignInButton (a button that calls signInWithOAuth)
// must look identical, and were doing so by copy-pasting the Octocat mark, the spinner, and the VARIANTS
// style map verbatim — two copies that had begun to drift. This is the single source for those pieces;
// each button supplies only its distinct wrapper element + click handler. (The `disabled` vs
// `aria-disabled` difference between the two stays in the buttons themselves: a real <button> is natively
// disable-able, while the <a> can only express it via aria-disabled — each is the correct a11y for its
// element. The shared chrome closes the markup/VARIANTS drift the two had accumulated.)

export type SignInButtonVariant = "primary" | "nav";

/** GitHub Octocat mark. Decorative — the button's accessible name comes from its label. */
export function GitHubMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Spinning ring shown while the OAuth redirect is in flight. */
export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  );
}

export const SIGN_IN_VARIANTS: Record<SignInButtonVariant, { box: string; icon: number; idle: string; busy: string }> = {
  primary: {
    box: "rounded-xl bg-accent px-5 py-2.5 text-base font-semibold text-on-accent hover:bg-accent-soft",
    icon: 18,
    idle: "Sign in with GitHub",
    busy: "Redirecting to GitHub…",
  },
  nav: {
    box: "rounded-md border border-slate-700 px-3 py-1.5 text-base text-accent hover:border-accent",
    icon: 14,
    idle: "Sign in",
    busy: "Redirecting…",
  },
};
