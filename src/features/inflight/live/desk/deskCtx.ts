// What every desk section and inner page reads, folded once by `Desk` — types only.

import type { ArmRow } from "./armsModel";
import type { DeskRoute } from "./deskRoute";
import type { DeskData } from "./deskTypes";
import type { RoundsFold } from "./roundsModel";
import type { WaitingModel } from "./waitingModel";

export interface DeskHrefs {
  ledger: string;
  cockpit: string;
  desk: string;
  onAir: string;
}

export interface DeskCtx {
  slug: string;
  data: DeskData;
  /** Null when the rounds could not be read. */
  fold: RoundsFold | null;
  arms: ArmRow[];
  waiting: WaitingModel;
  hrefs: DeskHrefs;
  go: (to: DeskRoute | null) => void;
}
