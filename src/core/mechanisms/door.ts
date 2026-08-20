import type { ActorState, ChamberDefinition, SimulationState } from "../types";

export function applyDoor(state: SimulationState, chamber: ChamberDefinition, actors: readonly ActorState[]): void {
  const door = state.door;
  if (!door) return;
  const gate = door.gatedBy ?? (state.hold ? "hold" : null);
  const gateOpen = gate === "hold"
    ? state.hold?.active === true
    : gate === "plate"
      ? state.plate?.active === true
      : null;
  if (gateOpen === null) return;
  const present = actors.find((actorState) => actorState.id === "present");
  if (
    gateOpen &&
    present &&
    door.latchWhenPresentBeyondX !== undefined &&
    present.x >= door.latchWhenPresentBeyondX
  ) {
    door.latched = true;
  }
  if (gateOpen && door.latchOnOpen) door.latched = true;
  door.open = gateOpen || door.latched === true;
}
