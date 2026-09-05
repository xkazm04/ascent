"use client";

// next/dynamic registry for the Delivery tab's heavy client panels (docs/ORG-TABS-REFACTOR.md §2,
// tier 3). Both are charts with their own client state (view toggle / hover tooltip) — paired with
// <Defer> at the call site in DeliveryCorePanel so they commit a beat after the tab's primary
// (server-rendered) content, instead of growing the tab's first-paint bundle.

import dynamic from "next/dynamic";

export const AiDeliveryModuleChunk = dynamic(
  () => import("./ai/AiDeliveryModule").then((m) => m.AiDeliveryModule),
  { ssr: false },
);

export const DeliveryActivityChartChunk = dynamic(
  () => import("./DeliveryActivityChart").then((m) => m.DeliveryActivityChart),
  { ssr: false },
);
