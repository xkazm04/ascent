import { ImageResponse } from "next/og";
import { getScanReportByCommit } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { LEVEL_HEX, LEVEL_GLYPH, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import { Brand, SHELL, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/og-brand";
import { parseRepoParam } from "./repoParam";

// Per-repo social card for the report permalink — the image the page's generateMetadata advertises
// via twitter:summary_large_image. SHELL-1: when the repo has a persisted scan we draw its real
// score + level + a dimension strip; otherwise (no DB, private, or never scanned) we fall back to a
// static card built purely from the route params, so an unfurl can NEVER fail. The DB read is
// best-effort and wrapped — any error degrades to the static card.

export const runtime = "nodejs"; // the scan lookup uses the Prisma client
export const alt = "Ascent maturity report";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const { name, sha } = parseRepoParam(repo);
  const ref = `${owner}/${name}`;

  // Best-effort: resolve the readable org + pinned/latest report. Any failure → static fallback.
  const report = await (async () => {
    try {
      const orgSlug = await readableOrgForOwner(owner);
      return await getScanReportByCommit(owner, name, { headSha: sha, orgSlug });
    } catch {
      return null;
    }
  })();

  if (report) {
    const levelId = report.level.id as LevelId;
    const accent = LEVEL_HEX[levelId] ?? "#3b9eff";
    const dims = report.dimensions.slice(0, 9);
    return new ImageResponse(
      (
        <div style={SHELL}>
          <Brand />

          <div style={{ display: "flex", alignItems: "flex-end", gap: 44 }}>
            {/* Headline score dial */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "baseline", color: accent }}>
                <div style={{ display: "flex", fontSize: 168, fontWeight: 700, lineHeight: 1 }}>{report.overallScore}</div>
                <div style={{ display: "flex", fontSize: 48, fontWeight: 600, color: "#64748b" }}>/100</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 34, fontWeight: 700, color: accent }}>
                <span>{LEVEL_GLYPH[levelId]}</span>
                <span>
                  {levelId} · {report.level.name}
                </span>
              </div>
            </div>

            {/* Repo + tagline */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
              <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: "#3b9eff", fontFamily: "monospace" }}>
                Maturity report{sha ? ` · ${sha.slice(0, 7)}` : ""}
              </div>
              <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.05, color: "#ffffff" }}>{ref}</div>
              <div style={{ display: "flex", fontSize: 26, color: "#94a3b8" }}>
                Adoption {report.adoptionScore} · Rigor {report.rigorScore} — across 9 dimensions, with evidence.
              </div>
            </div>
          </div>

          {/* Dimension strip */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {dims.map((d) => (
              <div
                key={d.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  borderRadius: 9,
                  border: `1px solid ${scoreHex(d.score)}55`,
                  background: `${scoreHex(d.score)}14`,
                  fontFamily: "monospace",
                  fontSize: 24,
                }}
              >
                <span style={{ color: "#94a3b8" }}>{d.id}</span>
                <span style={{ color: scoreHex(d.score), fontWeight: 700 }}>{d.score}</span>
              </div>
            ))}
          </div>
        </div>
      ),
      { ...size },
    );
  }

  // Fallback — static card from route params only (no DB, private, or never scanned).
  return new ImageResponse(
    (
      <div style={SHELL}>
        <Brand />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 4, textTransform: "uppercase", color: "#3b9eff", fontFamily: "monospace" }}>
            Maturity report
          </div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.05, color: "#ffffff" }}>{ref}</div>
          <div style={{ display: "flex", fontSize: 30, color: "#94a3b8" }}>
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
