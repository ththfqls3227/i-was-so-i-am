import { pointInsideRect } from "../geometry";
import type { ActorState, ChamberDefinition, SimulationState } from "../types";

/**
 * Standing is the input. A plate is held down by whoever is on it this tick and
 * springs back the moment they step off, so the only way to keep one pressed
 * through a whole replay is to leave a self standing there.
 */
export function applyPlate(state: SimulationState, chamber: ChamberDefinition, actors: readonly ActorState[]): void {
  const plate = state.plate;
  if (!plate) return;
  const pressedBy = actors
    .filter((actorState) => pointInsideRect(actorState.x, actorState.y, plate))
    .map((actorState) => actorState.id)
    .sort();
  plate.pressedBy = pressedBy;
  plate.active = plate.requiredActor ? pressedBy.includes(plate.requiredActor) : pressedBy.length > 0;
}
