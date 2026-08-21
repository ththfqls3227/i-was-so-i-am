import { ChamberRegistry } from "./chamber";
import { HAND_NOT_BODY_CHAMBER, HOLDING_HAND_CHAMBER, SECOND_SELF_CHAMBER } from "./chambers";
import { AWAKENING_CHAMBER } from "./room";

/**
 * The campaign, in play order.
 *
 * 00 teaches the loop, 01 makes the echo necessary, 02 makes it a hand you leave
 * behind, and 03 is the first time what you did to him is something your own
 * feet did.
 */
export const ROSTER = new ChamberRegistry([
  AWAKENING_CHAMBER,
  SECOND_SELF_CHAMBER,
  HOLDING_HAND_CHAMBER,
  HAND_NOT_BODY_CHAMBER,
]);
