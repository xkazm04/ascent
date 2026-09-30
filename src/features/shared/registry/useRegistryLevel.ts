"use client";

// One onboarding step, held in the URL hash (#step-choose … #step-verify).
// Six explicit flags: a hook cannot be called inside a loop.

import { useCallback } from "react";
import { useHashFlag } from "@/components/kit";
import type { RegistryStep } from "./registryModel";

export function useRegistryLevel() {
  const [choose, setChoose] = useHashFlag("step-choose");
  const [permissions, setPermissions] = useHashFlag("step-permissions");
  const [scaffold, setScaffold] = useHashFlag("step-scaffold");
  const [migrate, setMigrate] = useHashFlag("step-migrate");
  const [point, setPoint] = useHashFlag("step-point");
  const [verify, setVerify] = useHashFlag("step-verify");

  const id: RegistryStep["id"] | null = choose
    ? "choose"
    : permissions
      ? "permissions"
      : scaffold
        ? "scaffold"
        : migrate
          ? "migrate"
          : point
            ? "point"
            : verify
              ? "verify"
              : null;

  const open = useCallback(
    (next: RegistryStep["id"]) => {
      if (next === "choose") setChoose(true);
      else if (next === "permissions") setPermissions(true);
      else if (next === "scaffold") setScaffold(true);
      else if (next === "migrate") setMigrate(true);
      else if (next === "point") setPoint(true);
      else setVerify(true);
    },
    [setChoose, setPermissions, setScaffold, setMigrate, setPoint, setVerify],
  );

  const close = useCallback(() => {
    if (choose) setChoose(false);
    else if (permissions) setPermissions(false);
    else if (scaffold) setScaffold(false);
    else if (migrate) setMigrate(false);
    else if (point) setPoint(false);
    else if (verify) setVerify(false);
  }, [choose, permissions, scaffold, migrate, point, verify, setChoose, setPermissions, setScaffold, setMigrate, setPoint, setVerify]);

  return { id, open, close };
}
