import { ACTOR_RADIUS, FORCE_MOVE_PER_TICK, PUSH_CONTACT } from "../constants";
import { moveActorBy } from "../geometry";
import type { ActorState, ChamberDefinition, ForceObjectState, SimulationState } from "../types";

export function isAlignedPusher(actorState: ActorState, object: ForceObjectState): boolean {
  const direction = object.pushDirection ?? "right";
  const verticallyAligned = actorState.y >= object.y - ACTOR_RADIUS && actorState.y <= object.y + object.height + ACTOR_RADIUS;
  const engaged = actorState.targetId === object.id && actorState.actionHeld;
  if (!verticallyAligned || !engaged) return false;
  if (direction === "right") {
    return actorState.x <= object.x && object.x - actorState.x <= ACTOR_RADIUS + PUSH_CONTACT && actorState.facingX === 1;
  }
  const rightFace = object.x + object.width;
  return actorState.x >= rightFace && actorState.x - rightFace <= ACTOR_RADIUS + PUSH_CONTACT && actorState.facingX === -1;
}

export function applyForce(state: SimulationState, chamber: ChamberDefinition, actors: readonly ActorState[]): void {
  const object = state.forceObject;
  if (!object) return;
  const direction = object.pushDirection ?? "right";
  const contributors = actors.filter((actorState) => isAlignedPusher(actorState, object));
  object.force = contributors.length;
  if (contributors.length >= object.threshold) {
    const previousX = object.x;
    object.x = direction === "right"
      ? Math.min(object.maxX, object.x + FORCE_MOVE_PER_TICK)
      : Math.max(object.minX, object.x - FORCE_MOVE_PER_TICK);
    const delta = object.x - previousX;
    for (const contributor of contributors) moveActorBy(contributor, delta, 0, chamber, state);
  }
  state.exit.open = direction === "right" ? object.x >= object.maxX : object.x <= object.minX;
}
