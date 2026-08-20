import { resolveHorizontal, resolveVertical, standingOn } from "./collide";
import {
  AIR_ACCEL,
  EYE_HEIGHT,
  FOCUS_COS_CONE,
  FOCUS_RANGE,
  FRICTION_FLOOR_SPEED,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  INV_SQRT2,
  JUMP_SPEED,
  TICK_SECONDS,
  WALK_SPEED,
} from "./constants";
import { Button, buttonsOf, moveIntent, yawUnitsOf, type Frame } from "./input";
import { cosYaw, sinYaw } from "./trig";
import type { ActorState, Brush, InteractableSpec } from "./types";

export function spawnActor(
  id: ActorState["id"],
  spawn: { x: number; y: number; z: number; yawUnits: number },
): ActorState {
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yawUnits: spawn.yawUnits,
    grounded: true,
    actHeld: false,
    buttonsPrev: 0,
    focusId: null,
  };
}

/** Unit heading for a yaw. Babylon is left-handed, so yaw 0 looks down +z. */
export function forwardOf(yawUnits: number): { x: number; z: number } {
  return { x: sinYaw(yawUnits), z: cosYaw(yawUnits) };
}

/**
 * One actor, one tick. The same function drives the living player and the echo —
 * the only difference between them is where the frame came from, which is the
 * whole reason a recording can be trusted to replay.
 */
export function stepActor(actor: ActorState, frame: Frame, solids: readonly Brush[]): void {
  const buttons = buttonsOf(frame);
  const yawUnits = yawUnitsOf(frame);
  actor.yawUnits = yawUnits;
  actor.actHeld = (buttons & Button.Act) !== 0;

  // Edges are derived here rather than carried in the frame, so a repeated
  // posture frame never re-fires one. That is what makes the fold tail honest.
  const jumpPressed = (buttons & Button.Jump) !== 0 && (actor.buttonsPrev & Button.Jump) === 0;
  actor.buttonsPrev = buttons;

  const grounded = standingOn(actor, solids);
  actor.grounded = grounded;
  if (grounded && jumpPressed) {
    actor.vy = JUMP_SPEED;
    actor.grounded = false;
  }

  const intent = moveIntent(frame);
  let wishX = 0;
  let wishZ = 0;
  if (intent.forward !== 0 || intent.strafe !== 0) {
    const diagonal = intent.forward !== 0 && intent.strafe !== 0;
    const along = diagonal ? intent.forward * INV_SQRT2 : intent.forward;
    const across = diagonal ? intent.strafe * INV_SQRT2 : intent.strafe;
    const sine = sinYaw(yawUnits);
    const cosine = cosYaw(yawUnits);
    wishX = along * sine + across * cosine;
    wishZ = along * cosine - across * sine;
  }

  if (actor.grounded) {
    const speed = Math.sqrt(actor.vx * actor.vx + actor.vz * actor.vz);
    if (speed > 0) {
      const control = speed < FRICTION_FLOOR_SPEED ? FRICTION_FLOOR_SPEED : speed;
      const remaining = speed - control * GROUND_FRICTION * TICK_SECONDS;
      const scale = remaining > 0 ? remaining / speed : 0;
      actor.vx *= scale;
      actor.vz *= scale;
    }
  }

  if (wishX !== 0 || wishZ !== 0) {
    // Quake-style: only ever add speed along the wish direction, and never past
    // the walk speed. Turning while already moving keeps its momentum, which is
    // what stops the controller feeling like it is on rails.
    const accel = actor.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const alongWish = actor.vx * wishX + actor.vz * wishZ;
    const shortfall = WALK_SPEED - alongWish;
    if (shortfall > 0) {
      let step = accel * WALK_SPEED * TICK_SECONDS;
      if (step > shortfall) step = shortfall;
      actor.vx += step * wishX;
      actor.vz += step * wishZ;
    }
  }

  actor.vy -= GRAVITY * TICK_SECONDS;

  actor.x += actor.vx * TICK_SECONDS;
  actor.z += actor.vz * TICK_SECONDS;
  resolveHorizontal(actor, solids);
  actor.y += actor.vy * TICK_SECONDS;
  resolveVertical(actor, solids);
}

/**
 * What the crosshair is pointing at. The simulation has no pitch — a gaze cone
 * around the horizontal bearing answers the same question for a plate on the
 * floor and a switch on the wall, and costs no inverse trig.
 */
export function focusFor(actor: ActorState, interactables: readonly InteractableSpec[]): string | null {
  const eyeX = actor.x;
  const eyeY = actor.y + EYE_HEIGHT;
  const eyeZ = actor.z;
  const heading = forwardOf(actor.yawUnits);
  let closest: string | null = null;
  let closestDistance = FOCUS_RANGE;
  for (const target of interactables) {
    const dx = target.focus.x - eyeX;
    const dy = target.focus.y - eyeY;
    const dz = target.focus.z - eyeZ;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > closestDistance) continue;
    if (distance < 1e-6) {
      closest = target.id;
      closestDistance = distance;
      continue;
    }
    const planar = Math.sqrt(dx * dx + dz * dz);
    if (planar < 1e-6) continue;
    const alignment = (dx * heading.x + dz * heading.z) / planar;
    if (alignment < FOCUS_COS_CONE) continue;
    closest = target.id;
    closestDistance = distance;
  }
  return closest;
}
