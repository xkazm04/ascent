// Dependency-free SVG charts (keeps the bundle small and the build fast).
//
// Barrel: the individual charts now live in co-located files. This module re-exports them so
// existing `@/components/report/Charts` imports keep working unchanged.

export { ScoreRing } from "@/components/report/ScoreRing";
export { RadarChart } from "@/components/report/RadarChart";
export { PostureQuadrant } from "@/components/report/PostureQuadrant";
export { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
