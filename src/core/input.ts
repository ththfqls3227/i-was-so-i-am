export const enum InputBit {
  Up = 1 << 0,
  Down = 1 << 1,
  Left = 1 << 2,
  Right = 1 << 3,
  ActionHeld = 1 << 4,
  ActionPressed = 1 << 5,
  ActionReleased = 1 << 6,
}

export type InputFrame = number;

export interface InputIntent {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  actionHeld?: boolean;
  actionPressed?: boolean;
  actionReleased?: boolean;
}

export const VALID_INPUT_MASK =
  InputBit.Up |
  InputBit.Down |
  InputBit.Left |
  InputBit.Right |
  InputBit.ActionHeld |
  InputBit.ActionPressed |
  InputBit.ActionReleased;

export const NEUTRAL_INPUT: InputFrame = 0;

export function encodeInput(intent: InputIntent): InputFrame {
  let frame = NEUTRAL_INPUT;
  if (intent.up) frame |= InputBit.Up;
  if (intent.down) frame |= InputBit.Down;
  if (intent.left) frame |= InputBit.Left;
  if (intent.right) frame |= InputBit.Right;
  if (intent.actionHeld) frame |= InputBit.ActionHeld;
  if (intent.actionPressed) frame |= InputBit.ActionPressed;
  if (intent.actionReleased) frame |= InputBit.ActionReleased;
  return frame;
}

export function hasInput(frame: InputFrame, bit: InputBit): boolean {
  return (frame & bit) !== 0;
}

export function assertValidInputFrame(frame: InputFrame): void {
  if (!Number.isInteger(frame) || frame < 0 || (frame & ~VALID_INPUT_MASK) !== 0) {
    throw new Error(`Invalid InputFrame bitmask: ${frame}`);
  }
}

export function movementIntent(frame: InputFrame): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
  const horizontal = Number(hasInput(frame, InputBit.Right)) - Number(hasInput(frame, InputBit.Left));
  const vertical = Number(hasInput(frame, InputBit.Down)) - Number(hasInput(frame, InputBit.Up));
  const x = horizontal === 0 ? 0 : horizontal > 0 ? 1 : -1;
  const y = vertical === 0 ? 0 : vertical > 0 ? 1 : -1;
  return { x, y };
}
