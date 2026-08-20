import type { ActorState, Brush, DoorState, PlateState, RoomDefinition, SimState } from "./types";

export function initialPlates(room: RoomDefinition): PlateState[] {
  return room.plates.map((plate) => ({ id: plate.id, active: false, pressedBy: [] }));
}

export function initialDoors(room: RoomDefinition): DoorState[] {
  return room.doors.map((door) => ({ id: door.id, open: false, latched: false }));
}

/** Room geometry plus whichever doors are currently shut. Rebuilt each tick. */
export function solidsFor(room: RoomDefinition, doors: readonly DoorState[]): Brush[] {
  const solids = [...room.brushes];
  for (const spec of room.doors) {
    const state = doors.find((door) => door.id === spec.id);
    if (!state?.open) solids.push(spec.brush);
  }
  return solids;
}

function standsOn(actor: ActorState, plate: RoomDefinition["plates"][number]): boolean {
  const dx = actor.x - plate.centre.x;
  const dz = actor.z - plate.centre.z;
  if (dx < -plate.half.x || dx > plate.half.x) return false;
  if (dz < -plate.half.z || dz > plate.half.z) return false;
  return actor.y >= -plate.reach && actor.y <= plate.reach;
}

export function evaluatePlates(room: RoomDefinition, state: SimState): void {
  for (const spec of room.plates) {
    const plate = state.plates.find((candidate) => candidate.id === spec.id);
    if (!plate) continue;
    const pressedBy: ActorState["id"][] = [];
    for (const actor of state.actors) {
      if (standsOn(actor, spec)) pressedBy.push(actor.id);
    }
    plate.pressedBy = pressedBy;
    plate.active = spec.requiredActor
      ? pressedBy.includes(spec.requiredActor)
      : pressedBy.length > 0;
  }
}

export function evaluateDoors(room: RoomDefinition, state: SimState): void {
  for (const spec of room.doors) {
    const door = state.doors.find((candidate) => candidate.id === spec.id);
    if (!door) continue;
    if (door.latched) {
      door.open = true;
      continue;
    }
    const gate = state.plates.find((plate) => plate.id === spec.gatedBy);
    const shouldOpen = gate?.active ?? false;
    door.open = shouldOpen;
    // A one-way release: the first moment the gate opens this door, it stays
    // open. The room never takes back what a past self gave it.
    if (shouldOpen && spec.latchOnOpen) door.latched = true;
  }
}
