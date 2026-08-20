import { pointInsideRect } from "../geometry";
import type { ActorState, ChamberDefinition, HandoffMechanismState, SimulationState } from "../types";
import { exitGateOf } from "./exit";

/** Whether this self is allowed to lift the carrier at all. */
export function mayCarry(actorId: ActorState["id"], handoff: HandoffMechanismState): boolean {
  return handoff.carriedBy === undefined || handoff.carriedBy.includes(actorId);
}

export function applyHandoff(state: SimulationState, chamber: ChamberDefinition, actors: readonly ActorState[]): void {
  const handoff = state.handoff;
  if (!handoff) return;
  const holder = handoff.holder
    ? actors.find((actorState) => actorState.id === handoff.holder)
    : null;
  if (holder && !holder.actionHeld) {
    handoff.holder = null;
  } else if (!holder) {
    const claimant = actors.find((actorState) =>
      actorState.actionHeld && actorState.targetId === handoff.id && mayCarry(actorState.id, handoff),
    );
    if (claimant) {
      handoff.holder = claimant.id;
      if (claimant.id === "present") handoff.carriedByPresent = true;
      // The box is in one pair of hands now: nobody else keeps reaching for it,
      // otherwise the other self follows it around and locks itself out of the
      // affordance it was actually standing next to.
      for (const other of actors) {
        if (other.id !== claimant.id && other.targetId === handoff.id) other.targetId = null;
      }
    }
  }

  const activeHolder = handoff.holder
    ? actors.find((actorState) => actorState.id === handoff.holder)
    : null;
  if (activeHolder) {
    handoff.x = activeHolder.x;
    handoff.y = activeHolder.y;
    if (pointInsideRect(activeHolder.x, activeHolder.y, handoff.delivery)) {
      handoff.delivered = true;
      handoff.holder = null;
      activeHolder.targetId = null;
    }
  }
  if (exitGateOf(chamber) === "handoff") state.exit.open = handoff.delivered;
}
