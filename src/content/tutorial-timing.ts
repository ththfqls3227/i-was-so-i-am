import { simulationConstants } from "../core/simulation";
import { CHAMBERS } from "./chambers";

/**
 * Thresholds the Trace Weight tutorial card advances on. They live here rather
 * than inside the UI so the regression tests can drive a recording exactly the
 * way the card tells a player to, instead of hand-tuned frame counts.
 */

/**
 * Ticks the winch must stay held so the present self can walk from spawn to the
 * latch line in pass 2 — derived from chamber geometry and core movement speed,
 * with the grace window as reaction margin.
 */
export function traceRequiredHoldTicks(): number {
  const chamber = CHAMBERS.traceWeight;
  const latchX = chamber.door?.latchWhenPresentBeyondX ?? chamber.spawn.x;
  return Math.ceil((latchX - chamber.spawn.x) / simulationConstants.movePerTick) + simulationConstants.graceTicks;
}

/**
 * Ticks of rightward walking the recording needs after releasing the winch so
 * the replayed past can travel winch→weight through the latched bridge.
 */
export function traceRequiredTravelTicks(): number {
  const chamber = CHAMBERS.traceWeight;
  const holdX = chamber.hold?.x ?? chamber.spawn.x;
  const weightX = chamber.forceObject?.x ?? holdX;
  return Math.ceil((weightX - holdX) / simulationConstants.movePerTick) + simulationConstants.graceTicks;
}
