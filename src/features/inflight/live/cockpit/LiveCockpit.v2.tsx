"use client";
import { LiveCockpitV1 } from "./LiveCockpit.v1";
import type { LiveCockpitProps } from "./LiveCockpit";
export function LiveCockpitV2(props: LiveCockpitProps) {
  return <LiveCockpitV1 {...props} />;
}
