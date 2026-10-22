"use client";

// The share-panel state both Developer compositions share: Share buttons anywhere open the panel in the
// Setup block, and the block scrolls into view. One hook so v1 and v2 cannot drift.

import { useRef, useState } from "react";

export function useCareShare() {
  const [sharing, setSharing] = useState(false);
  const setupRef = useRef<HTMLDivElement>(null);
  const openShare = () => {
    setSharing(true);
    setupRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  return { sharing, closeShare: () => setSharing(false), openShare, setupRef };
}
