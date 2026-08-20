import { YAW_UNITS } from "./constants";

/**
 * Deterministic sine and cosine for quantised yaw.
 *
 * `Math.sin` and `Math.cos` are explicitly *not* held to any accuracy by
 * ECMA-262 — two engines may return different doubles for the same input, which
 * would desynchronise a tape replayed in Firefox from the same tape replayed in
 * Node. Everything here is built from IEEE-754 double `+ - * /`, which the spec
 * pins exactly, so the tables below come out bit-identical on every engine that
 * runs the game. This is the 3D counterpart of the rule that banned `Math.hypot`
 * from the old core.
 */

const TAU = 6.283185307179586;
/** Dividing by a power of two is exact, so this constant is reproducible. */
const RADIANS_PER_UNIT = TAU / YAW_UNITS;
const QUADRANT_UNITS = YAW_UNITS / 4;
const OCTANT_UNITS = YAW_UNITS / 8;

/** Taylor series for sine, carried to the term where the |x| <= PI/4 remainder falls below 1e-12. */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800))))))
  );
}

/** The matching cosine series over the same interval. */
function cosCore(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600))))))
  );
}

const SIN_TABLE = new Float64Array(YAW_UNITS);
const COS_TABLE = new Float64Array(YAW_UNITS);

for (let units = 0; units < YAW_UNITS; units += 1) {
  const quadrant = (units / QUADRANT_UNITS) | 0;
  const withinQuadrant = units - quadrant * QUADRANT_UNITS;
  // Fold the back half of each quadrant onto the front so the series only ever
  // sees |x| <= PI/4, where these terms are more accurate than a double can hold.
  let sine: number;
  let cosine: number;
  if (withinQuadrant <= OCTANT_UNITS) {
    const angle = withinQuadrant * RADIANS_PER_UNIT;
    sine = sinCore(angle);
    cosine = cosCore(angle);
  } else {
    const complement = (QUADRANT_UNITS - withinQuadrant) * RADIANS_PER_UNIT;
    sine = cosCore(complement);
    cosine = sinCore(complement);
  }
  switch (quadrant) {
    case 1:
      SIN_TABLE[units] = cosine;
      COS_TABLE[units] = -sine;
      break;
    case 2:
      SIN_TABLE[units] = -sine;
      COS_TABLE[units] = -cosine;
      break;
    case 3:
      SIN_TABLE[units] = -cosine;
      COS_TABLE[units] = sine;
      break;
    default:
      SIN_TABLE[units] = sine;
      COS_TABLE[units] = cosine;
      break;
  }
}

export function wrapYawUnits(units: number): number {
  const wrapped = units % YAW_UNITS;
  return wrapped < 0 ? wrapped + YAW_UNITS : wrapped;
}

export function sinYaw(units: number): number {
  return SIN_TABLE[wrapYawUnits(units)] ?? 0;
}

export function cosYaw(units: number): number {
  return COS_TABLE[wrapYawUnits(units)] ?? 1;
}

/** Radians in, simulation units out. The camera keeps the raw angle; only the tick sees this. */
export function yawUnitsFromRadians(radians: number): number {
  const turns = radians / TAU;
  const fraction = turns - Math.floor(turns);
  return wrapYawUnits(Math.round(fraction * YAW_UNITS));
}

export function radiansFromYawUnits(units: number): number {
  return wrapYawUnits(units) * RADIANS_PER_UNIT;
}
</content>
</invoke>
