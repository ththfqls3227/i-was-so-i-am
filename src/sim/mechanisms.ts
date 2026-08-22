import { EYE_HEIGHT, PLAYER_RADIUS } from "./constants";
import type {
  ActorState,
  Brush,
  DoorState,
  GateRef,
  HoldState,
  InteractableSpec,
  PlateState,
  RoomDefinition,
  SimState,
  Vec3,
} from "./types";

/** Where a plate answers the crosshair from: just above its own face. */
const PLATE_FOCUS_HEIGHT = 0.12;

export function initialPlates(room: RoomDefinition): PlateState[] {
  // A forced plate is held down by something outside the simulation, so it is
  // down before the first tick too. Otherwise the room draws one frame with an
  // older self standing on a plate that has not noticed him.
  return room.plates.map((plate) => ({
    id: plate.id,
    active: plate.forcedActive === true,
    pressedBy: [],
  }));
}

export function initialHolds(room: RoomDefinition): HoldState[] {
  return room.holds.map((hold) => ({ id: hold.id, active: false, heldBy: [] }));
}

export function initialDoors(room: RoomDefinition): DoorState[] {
  return room.doors.map((door) => ({ id: door.id, open: false, latched: false, heldTicks: 0 }));
}

/**
 * Everything the crosshair can answer to, derived from the mechanisms that are
 * actually in the room. Authoring this list separately meant a room could name a
 * grip its own gaze could never find, and nothing would say so.
 */
export function interactablesFor(room: RoomDefinition): InteractableSpec[] {
  const list: InteractableSpec[] = [];
  for (const plate of room.plates) {
    list.push({
      id: plate.id,
      kind: "plate",
      focus: { x: plate.centre.x, y: PLATE_FOCUS_HEIGHT, z: plate.centre.z },
    });
  }
  for (const hold of room.holds) {
    list.push({ id: hold.id, kind: "switch", focus: hold.at });
  }
  return list;
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
  // Measured to the edge of the body, not its centre. A foot visibly touching
  // the plate has to count — judged by centre point, a figure standing on the
  // front rim reads as "on the plate" on screen and as "not on it" in here,
  // and that gap cost real players eight failed cycles in room 01.
  const dx = actor.x - plate.centre.x;
  const dz = actor.z - plate.centre.z;
  const spanX = plate.half.x + PLAYER_RADIUS;
  const spanZ = plate.half.z + PLAYER_RADIUS;
  if (dx < -spanX || dx > spanX) return false;
  if (dz < -spanZ || dz > spanZ) return false;
  return actor.y >= -plate.reach && actor.y <= plate.reach;
}

function reachOf(actor: ActorState, at: Vec3): number {
  const dx = actor.x - at.x;
  const dy = actor.y + EYE_HEIGHT - at.y;
  const dz = actor.z - at.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
    const pressed = spec.requiredActor
      ? pressedBy.includes(spec.requiredActor)
      : pressedBy.length > 0;
    plate.active = pressed || spec.forcedActive === true;
  }
}

/**
 * Take hold, or let go. Acquiring a grip needs the crosshair on it; keeping one
 * only needs to not walk away, so a held hand survives looking around.
 *
 * The lockout bars exactly the grip this actor just walked out of, and only
 * until Act is released. Every other grip stays available — a tape whose tail
 * holds Act must still be able to take hold of the next thing it reaches, which
 * is the failure the 2D core had to be taught twice.
 */
export function updateGrip(actor: ActorState, room: RoomDefinition): void {
  if (!actor.actHeld) {
    actor.targetId = null;
    actor.lockedOutTargetId = null;
    return;
  }
  if (actor.targetId !== null) {
    const held = room.holds.find((hold) => hold.id === actor.targetId);
    if (!held || reachOf(actor, held.at) > held.releaseRadius) {
      actor.lockedOutTargetId = actor.targetId;
      actor.targetId = null;
    }
    return;
  }
  const focus = actor.focusId;
  if (focus === null || focus === actor.lockedOutTargetId) return;
  const spec = room.holds.find((hold) => hold.id === focus);
  if (!spec) return;
  actor.targetId = spec.id;
  actor.lockedOutTargetId = null;
}

export function evaluateHolds(room: RoomDefinition, state: SimState): void {
  for (const spec of room.holds) {
    const hold = state.holds.find((candidate) => candidate.id === spec.id);
    if (!hold) continue;
    // Sorted so the list is a set, not a record of who got there first.
    const heldBy = state.actors
      .filter((actor) => actor.actHeld && actor.targetId === spec.id)
      .map((actor) => actor.id)
      .sort();
    hold.heldBy = heldBy;
    hold.active = spec.requiredActor ? heldBy.includes(spec.requiredActor) : heldBy.length > 0;
  }
}

export function gateActive(ref: GateRef, state: SimState): boolean {
  switch (ref.kind) {
    case "plate":
      return state.plates.find((plate) => plate.id === ref.id)?.active ?? false;
    case "hold":
      return state.holds.find((hold) => hold.id === ref.id)?.active ?? false;
    case "all":
      // An empty conjunction would be vacuously open, which is never what a
      // room meant to say.
      return ref.of.length > 0 && ref.of.every((child) => gateActive(child, state));
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
    const satisfied = gateActive(spec.gatedBy, state);
    // A door that latches is on a timer, not a demand. Once its gate has been
    // satisfied once, the count keeps running whether or not anything is still
    // standing there — walking over the plate is enough, and the door opens a
    // beat later as it always did.
    //
    // It used to reset the moment the gate dropped, so the delay meant
    // *consecutive* ticks of pressure. Walking across 00's plate is about
    // thirteen ticks and the door wants eighteen, so the room could not be
    // solved by walking through it — you had to stop and stand, which nothing
    // says. Two judges failed it eight to ten times each.
    //
    // Doors that do not latch keep the old reading: they are open exactly while
    // the gate is satisfied, which is the whole of what 01 teaches.
    const counting = spec.latchOnOpen === true ? door.heldTicks > 0 || satisfied : satisfied;
    if (!counting) {
      door.heldTicks = 0;
      door.open = false;
      continue;
    }
    door.heldTicks += 1;
    // 00's door waits a beat before it moves, which is long enough that a player
    // glances back at the plate they are standing on. That glance goes onto the
    // first tape anyone records, and the ending gives it back to them.
    door.open = door.heldTicks >= (spec.openDelayTicks ?? 0);
    // A one-way release: the first moment the gate opens this door, it stays
    // open. The room never takes back what a past self gave it.
    if (door.open && spec.latchOnOpen) door.latched = true;
  }
}

export function evaluateExit(room: RoomDefinition, state: SimState): void {
  // A room with no exit gate has an exit that was never closed.
  if (!room.exitGatedBy) return;
  state.exitOpen = gateActive(room.exitGatedBy, state);
}
