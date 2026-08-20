/** Simulation identity. Tapes are locked to it, so any behaviour change bumps it. */
export const SIM_VERSION = "fp-0.1.0";
export const TAPE_FORMAT_VERSION = 1;

/** Fixed tick. The renderer may run at any rate; the world only ever advances here. */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_SECONDS = 1 / TICK_RATE;

/**
 * Yaw resolution handed to the simulation: one turn split into 4096 steps
 * (0.088 degrees). The mouse keeps its raw angle for the camera; only the
 * quantised value is recorded, so a tape means the same thing on every machine.
 */
export const YAW_UNITS = 4096;

/** Player collider: an upright box, Quake/Portal style. Rooms are axis-aligned brushes. */
export const PLAYER_RADIUS = 0.36;
export const PLAYER_HEIGHT = 1.82;
export const EYE_HEIGHT = 1.63;

/** Movement feel. Walk speed and jump height are the two numbers the owner will judge. */
export const WALK_SPEED = 4.5;
export const GROUND_ACCEL = 9;
export const AIR_ACCEL = 1.3;
export const GROUND_FRICTION = 7;
/** Below this speed friction still bites at full strength, so stopping is crisp instead of sliding. */
export const FRICTION_FLOOR_SPEED = 1.6;
export const GRAVITY = 18;
/** 6.3 m/s against 18 m/s^2 peaks at 1.10 m. */
export const JUMP_SPEED = 6.3;

/** Diagonal input is normalised so holding two keys is not sqrt(2) times faster. */
export const INV_SQRT2 = 0.7071067811865476;

/** Gaze affordance: how far, and how wide a cone, an interactable answers from. */
export const FOCUS_RANGE = 2.4;
/** cos(45 degrees) — compared against a dot product, so no inverse trig in the tick. */
export const FOCUS_COS_CONE = 0.7071067811865476;

/** A tape must hold at least a second of intent before it can be folded. */
export const MIN_TAPE_TICKS = 30;
/** Hard ceiling shared by tape validation, independent of any one room. */
export const MAX_TAPE_TICKS = TICK_RATE * 30;

/** Collision solver passes. Three is enough to seat a box in an inside corner. */
export const COLLISION_PASSES = 4;
</content>
</invoke>
