"use client";

// The cockpit's view state, shared by BOTH compositions (v1 = shipped, v2 = Prism). Everything a layout needs
// that is not markup lives here, so the two themes cannot diverge in behaviour: the state machine
// (`useCockpit`), the rail's mode, the standing runner, the fleet-list fold, the setup dialog flag and the
// navigation into a repo's report.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reportPermalink } from "@/lib/ui";
import { isRunner } from "./runnerModel";
import { useCockpit } from "./useCockpit";
import type { LiveCockpitProps } from "./LiveCockpit";

export function useLiveCockpitView(props: LiveCockpitProps) {
  const router = useRouter();
  const [listOpen, setListOpen] = useState(true);
  // The setup dialog is the ONE piece of view state this layout owns: which panel the rail shows and
  // what the run is armed with both belong to the state machine, but "is the gear's dialog open" is
  // nothing but chrome.
  const [setupOpen, setSetupOpen] = useState(false);
  const c = useCockpit(props);
  const { loop, drive } = c;
  // `outcome` is still a real mode of the state machine (it suppresses the interrupted-drive offer and
  // marks the opened run), but the RAIL has no panel for it: it shows the inspector instead.
  const railMode = c.mode === "outcome" ? ("inspect" as const) : c.mode;
  const runner = drive.live && isRunner(drive.drive) ? drive.drive : null;
  const openRepo = (fullName: string) => router.push(reportPermalink(fullName, null, props.slug));
  return { c, loop, drive, railMode, runner, listOpen, toggleList: () => setListOpen((o) => !o), setupOpen, setSetupOpen, openRepo };
}

export type LiveCockpitView = ReturnType<typeof useLiveCockpitView>;
