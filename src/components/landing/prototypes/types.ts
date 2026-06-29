// Shared prop shape for the landing-page prototype variants. The server page (src/app/page.tsx)
// fetches the gallery + quota and passes this identical payload into every variant, so consumers
// (ScanForm, gallery rails, pricing) stay untouched as we A/B between directions.

import type { PublicScanGallery } from "@/lib/db";
import type { AuthMode } from "./index/ScanModal";

export interface LandingData {
  /** Live discovery rail + leaderboard from persisted public scans; null when persistence is off. */
  gallery: PublicScanGallery | null;
  /** Real weekly free-scan limits when the gate is live; null on a DB-less deploy (no enforceable cap). */
  quota: { anon: number; member: number } | null;
  /** Live top-scoring repos to seed the ScanForm "Try:" chips. */
  exampleRepos?: string[];
  /** Which GitHub sign-in backend is configured, so the hero's scan dialog renders the right CTA. */
  auth?: AuthMode;
  /** Whether the login wall is enforced on this deployment — the hero's scan dialog locks scanning
   *  behind sign-in when true (first sign in, then scan). False on open/dev/DB-less deploys. */
  gated?: boolean;
}
