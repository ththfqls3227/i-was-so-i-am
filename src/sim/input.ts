import { YAW_UNITS } from "./constants";
import { wrapYawUnits } from "./trig";

/**
 * One tick of intent, packed into a single integer so a tape is a flat number
 * array that stringifies identically everywhere.
 *
 * Only *held* states are encoded. Press and release edges are derived inside the
 * tick from the previous frame's buttons, which is what makes the fold tail safe:
 * repeating the last sampled frame reproduces the posture (feet, gaze and grip)
 * without ever re-firing an edge. The old core had to strip edge bits by hand to
 * get the same property; here the encoding cannot express one.
 */
export const enum Button {
  Forward = 1 << 0,
  Back = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  Jump = 1 << 4,
  Act = 1 << 5,
}

export const BUTTON_MASK = 0x3f;
const YAW_SHIFT = 6;

export type Frame = number;

export interface Intent {
  forward?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
  jump?: boolean;
  act?: boolean;
  yawUnits?: number;
}

export const NEUTRAL_FRAME: Frame = 0;

export function encodeFrame(intent: Intent): Frame {
  let buttons = 0;
  if (intent.forward) buttons |= Button.Forward;
  if (intent.back) buttons |= Button.Back;
  if (intent.left) buttons |= Button.Left;
  if (intent.right) buttons |= Button.Right;
  if (intent.jump) buttons |= Button.Jump;
  if (intent.act) buttons |= Button.Act;
  return buttons | (wrapYawUnits(intent.yawUnits ?? 0) << YAW_SHIFT);
}

export function buttonsOf(frame: Frame): number {
  return frame & BUTTON_MASK;
}

export function yawUnitsOf(frame: Frame): number {
  return (frame >>> YAW_SHIFT) & (YAW_UNITS - 1);
}

export function held(frame: Frame, button: Button): boolean {
  return (frame & button) !== 0;
}

export const MAX_FRAME = ((YAW_UNITS - 1) << YAW_SHIFT) | BUTTON_MASK;

export function assertValidFrame(frame: Frame): void {
  if (!Number.isInteger(frame) || frame < 0 || frame > MAX_FRAME) {
    throw new Error(`Invalid input frame: ${frame}`);
  }
}

/**
 * The movement the frame asks for, in the actor's own axes and normalised so a
 * diagonal is not sqrt(2) times faster. Opposed keys cancel.
 */
export function moveIntent(frame: Frame): { forward: -1 | 0 | 1; strafe: -1 | 0 | 1 } {
  const forwardAxis = Number(held(frame, Button.Forward)) - Number(held(frame, Button.Back));
  const strafeAxis = Number(held(frame, Button.Right)) - Number(held(frame, Button.Left));
  return {
    forward: forwardAxis === 0 ? 0 : forwardAxis > 0 ? 1 : -1,
    strafe: strafeAxis === 0 ? 0 : strafeAxis > 0 ? 1 : -1,
  };
}
</content>
</invoke>
