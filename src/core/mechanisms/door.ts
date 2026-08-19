import type { ActorState, ChamberDefinition, SimulationState } from "../types";

export function applyDoor(state: SimulationState, chamber: ChamberDefinition, actors: readonly ActorState[]): void {
  const door = state.door;
  if (!door) return;
  const gate = door.gatedBy ?? (state.hold ? "hold" : null);
  if (gate !== "hold") return;
  const hold = state.hold;
  if (!hold) return;
  const present = actors.find((actorState) => actorState.id === "present");
  if (
    hold.active &&
    present &&
    door.latchWhenPresentBeyondX !== undefined &&
    present.x >= door.latchWhenPresentBeyondX
  ) {
    door.latched = true;
  }
  door.open = hold.active || door.latched === true;
}
