import type { SimulationState } from "./types";

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function checksumValue(value: unknown): string {
  return fnv1a(stableStringify(value));
}

export function canonicalState(state: SimulationState): unknown {
  return {
    simulationVersion: state.simulationVersion,
    chamberId: state.chamberId,
    chamberVersion: state.chamberVersion,
    phase: state.phase,
    tick: state.tick,
    tapeTick: state.tapeTick,
    actors: [...state.actors].sort((a, b) => a.id.localeCompare(b.id)),
    door: state.door,
    hold: state.hold,
    forceObject: state.forceObject,
    handoff: state.handoff,
    exit: state.exit,
    success: state.success,
    lastError: state.lastError,
    foldedAtTick: state.foldedAtTick,
  };
}

export function checksumState(state: SimulationState): string {
  return checksumValue(canonicalState(state));
}
