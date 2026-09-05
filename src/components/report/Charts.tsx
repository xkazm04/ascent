// Dependency-free SVG charts (keeps the bundle small and the build fast).
//
// Barrel: the individual charts now live in co-located files. This module re-exports the chart
// components so existing `@/components/report/Charts` imports keep working unchanged. The motion
// hooks live at `@/components/report/chartMotion` — import them directly from there.

export { ScoreRing } from "@/components/report/ScoreRing";
export { RadarChart } from "@/components/report/RadarChart";
export { PostureQuadrant } from "@/components/report/PostureQuadrant";
