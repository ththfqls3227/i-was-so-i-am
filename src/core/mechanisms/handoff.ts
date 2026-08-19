import { distanceBetween, pointInsideRect } from "../geometry";
import type { ActorState, ChamberDefinition, SimulationState } from "../types";

export function applyHandoff(state: SimulationState, chamber: ChamberDefinition, actors: readonly ActorState[]): void {
  const handoff = state.handoff;
  if (!handoff) return;
  const holder = handoff.holder
    ? actors.find((actorState) => actorState.id === handoff.holder)
    : null;
  if (holder && !holder.actionHeld) {
    handoff.holder = null;
  } else if (holder) {
    handoff.x = holder.x;
    handoff.y = holder.y;
  } else {
    const claimant = actors.find((actorState) =>
      actorState.actionHeld &&
      actorState.targetId === handoff.id &&
      (actorState.id === "past" ? !handoff.stagedByPast : handoff.stagedByPast),
    );
    if (claimant) {
      handoff.holder = claimant.id;
      if (claimant.id === "present") handoff.receivedByPresent = true;
    }
  }

  const activeHolder = handoff.holder
    ? actors.find((actorState) => actorState.id === handoff.holder)
    : null;
  if (activeHolder) {
    handoff.x = activeHolder.x;
    handoff.y = activeHolder.y;
    if (
      activeHolder.id === "present" &&
      handoff.receivedByPresent &&
      Math.abs(activeHolder.y - handoff.junction.y) >= handoff.junction.radius * 2
    ) {
      handoff.redirectedByPresent = true;
    }
    if (
      activeHolder.id === "past" &&
      distanceBetween(activeHolder.x, activeHolder.y, handoff.junction.x, handoff.junction.y) <= handoff.junction.radius
    ) {
      handoff.stagedByPast = true;
      handoff.holder = null;
      handoff.x = handoff.junction.x;
      handoff.y = handoff.junction.y;
      activeHolder.targetId = null;
    } else if (
      activeHolder.id === "present" &&
      handoff.redirectedByPresent &&
      pointInsideRect(activeHolder.x, activeHolder.y, handoff.delivery)
    ) {
      handoff.delivered = true;
      handoff.holder = null;
      activeHolder.targetId = null;
    }
  }
  state.exit.open = handoff.delivered;
}
