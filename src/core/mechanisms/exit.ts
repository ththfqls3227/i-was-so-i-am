import type { ChamberDefinition } from "../types";

/**
 * Which mechanism is allowed to write `state.exit.open` in this chamber.
 * Chambers authored before `exitGate` existed keep their old behaviour: the
 * handoff owns the exit when there is one, otherwise the force object does.
 */
export function exitGateOf(chamber: ChamberDefinition): "force" | "handoff" | "hold" | null {
  if (chamber.exitGate) return chamber.exitGate;
  if (chamber.handoff) return "handoff";
  if (chamber.forceObject) return "force";
  return null;
}
