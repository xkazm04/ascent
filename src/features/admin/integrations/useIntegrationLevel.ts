"use client";

// Hash level for one integration. The server snapshot is null: a hash never reaches the server.
import { useCallback, useSyncExternalStore } from "react";
import { publishIntegrationHash, readIntegrationHash } from "./integrationHash";
import type { IntegrationLevelId } from "./integrationModel";

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener("hashchange", cb);
    window.removeEventListener("popstate", cb);
  };
};

export function useIntegrationLevel(): readonly [IntegrationLevelId | null, (id: IntegrationLevelId | null) => void] {
  const id = useSyncExternalStore(subscribe, readIntegrationHash, () => null);
  const set = useCallback((next: IntegrationLevelId | null) => publishIntegrationHash(next), []);
  return [id, set] as const;
}
