// What the Pairing tab's server read hands to either composition.
import type { PairingView, RegistryPairingView } from "./pairingClient";

export interface PairingData {
  pairings: PairingView[];
  registry: RegistryPairingView;
}
