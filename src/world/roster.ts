import { ChamberRegistry } from "./chamber";
import { AWAKENING_CHAMBER } from "./room";

/**
 * The campaign, in play order. One chamber today — the point of building the
 * registry before the rooms was that adding the tenth costs the same as adding
 * the second.
 */
export const ROSTER = new ChamberRegistry([AWAKENING_CHAMBER]);
