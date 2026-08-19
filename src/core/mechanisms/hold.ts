import type { ActorState, ChamberDefinition, SimulationState } from "../types";

export function applyHold(
  state: SimulationState,
  chamber: ChamberDefinition,
  actors: readonly ActorState[],
  gracePastTargetId: string | null = null,
): void {
  const hold = state.hold;
  if (!hold) return;
  const credited = actors
    .filter((actorState) =>
      (actorState.actionHeld && actorState.targetId === hold.id) ||
      (actorState.id === "past" && gracePastTargetId === hold.id),
    )
    .map((actorState) => actorState.id)
    .sort();
  hold.creditedActors = credited;
  hold.active = hold.requiredActor ? credited.includes(hold.requiredActor) : credited.length > 0;
}
