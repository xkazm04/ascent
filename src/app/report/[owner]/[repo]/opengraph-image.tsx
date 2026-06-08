import { ImageResponse } from "next/og";

// Per-repo social card for the report permalink — the image the page's generateMetadata advertises
// via twitter:summary_large_image. Built purely from the route params (owner/repo) so it never
// touches the DB or session and can't fail an unfurl; the live page still renders the real score.

export const alt = "Ascent maturity report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** `name` or `name@sha` — drop any pinned commit suffix for the title. */
function repoName(repoParam: string): string {
  const at = repoParam.indexOf("@");
  return at < 0 ? repoParam : repoParam.slice(0, at);
}

export default async function Image({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const ref = `${owner}/${repoName(repo)}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "linear-gradient(160deg, #0b1322 0%, #080d1a 62%)",
          color: "#e2e8f0",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              width: 44,
              height: 44,
              borderRadius: 11,
              alignItems: "center",
              justifyContent: "center",
              background: "#3b9eff",
              color: "#04070e",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            ↑
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 9, color: "#ffffff" }}>
            ASCENT
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 28, letterSpacing: 4, textTransform: "uppercase", color: "#3b9eff", fontFamily: "monospace" }}>
            Maturity report
          </div>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, color: "#ffffff" }}>
            {ref}
          </div>
          <div style={{ fontSize: 30, color: "#94a3b8" }}>
            AI-native engineering maturity — a 5-level ladder across 9 dimensions, with evidence.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 26, color: "#64748b", fontFamily: "monospace" }}>
          ascent · scan → score → route to the next level
        </div>
      </div>
    ),
    { ...size },
  );
}
