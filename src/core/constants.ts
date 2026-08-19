import { POSITION_SCALE, TICK_RATE } from "./types";

export const ACTOR_RADIUS = 1.3 * POSITION_SCALE;
export const MOVE_PER_TICK = 0.6 * POSITION_SCALE;
export const FORCE_MOVE_PER_TICK = 0.32 * POSITION_SCALE;
export const TARGET_RADIUS = 3.2 * POSITION_SCALE;
export const TARGET_HYSTERESIS = 4 * POSITION_SCALE;
export const PUSH_CONTACT = 1.8 * POSITION_SCALE;
export const GRACE_TICKS = Math.ceil(0.25 * TICK_RATE);
export const MIN_TAPE_TICKS = TICK_RATE;
