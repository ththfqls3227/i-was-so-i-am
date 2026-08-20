import { COLLISION_PASSES, PLAYER_HEIGHT, PLAYER_RADIUS } from "./constants";
import type { Brush } from "./types";

const EPSILON = 1e-4;

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
}

/** Feet-anchored box: PLAYER_RADIUS either side, PLAYER_HEIGHT tall. */
function spansVertically(body: Body, brush: Brush): boolean {
  return body.y < brush.max.y - EPSILON && body.y + PLAYER_HEIGHT > brush.min.y + EPSILON;
}

function overlapX(body: Body, brush: Brush): number {
  const half = (brush.max.x - brush.min.x) / 2 + PLAYER_RADIUS;
  const centre = (brush.max.x + brush.min.x) / 2;
  const distance = body.x - centre;
  return half - (distance < 0 ? -distance : distance);
}

function overlapZ(body: Body, brush: Brush): number {
  const half = (brush.max.z - brush.min.z) / 2 + PLAYER_RADIUS;
  const centre = (brush.max.z + brush.min.z) / 2;
  const distance = body.z - centre;
  return half - (distance < 0 ? -distance : distance);
}

/**
 * Push the body out of anything it is inside, shallowest axis first, and kill the
 * velocity component that drove it in. Resolving one axis at a time is what turns
 * a head-on stop into a slide: the component along the wall survives untouched.
 *
 * Several passes because seating a box into an inside corner takes one push per
 * surface, and the first push can reveal the second overlap.
 */
export function resolveHorizontal(body: Body, solids: readonly Brush[]): void {
  for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
    let deepest: Brush | null = null;
    let deepestDepth = 0;
    let deepestX = 0;
    let deepestZ = 0;
    for (const brush of solids) {
      if (!spansVertically(body, brush)) continue;
      const depthX = overlapX(body, brush);
      if (depthX <= 0) continue;
      const depthZ = overlapZ(body, brush);
      if (depthZ <= 0) continue;
      const depth = depthX < depthZ ? depthX : depthZ;
      if (depth > deepestDepth) {
        deepest = brush;
        deepestDepth = depth;
        deepestX = depthX;
        deepestZ = depthZ;
      }
    }
    if (!deepest) return;
    if (deepestX < deepestZ) {
      const centre = (deepest.max.x + deepest.min.x) / 2;
      body.x += body.x < centre ? -deepestX : deepestX;
      body.vx = 0;
    } else {
      const centre = (deepest.max.z + deepest.min.z) / 2;
      body.z += body.z < centre ? -deepestZ : deepestZ;
      body.vz = 0;
    }
  }
}

/**
 * How far a surface may be inside the body and still count as floor underfoot or
 * ceiling overhead. At 30 Hz nothing falls further than 0.6 m in a tick, so a
 * deeper intersection than this is never something the body landed on.
 */
const VERTICAL_BITE = 0.62;

/**
 * Land on tops, stop under ceilings — and, crucially, do neither for a wall the
 * body is merely standing beside.
 *
 * The first version of this decided by nearest face, which is fine for a floor
 * but catastrophic for a 4 m wall: a body flush against one is nearer the wall's
 * underside than its top, so the resolver read the wall as a ceiling and pushed
 * the player down through the floor and out of the world. The horizontal pass
 * leaves a body exactly on a wall face, where a rounding residue of 1e-16 is
 * enough to still count as an overlap — so the guard has to be a real margin,
 * not a test against zero.
 */
export function resolveVertical(body: Body, solids: readonly Brush[]): void {
  body.grounded = false;
  for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
    let chosen: Brush | null = null;
    let chosenDepth = 0;
    let fromAbove = false;
    for (const brush of solids) {
      // A body resting against a wall overlaps it by an epsilon. That is contact,
      // not penetration, and the vertical pass must not act on it.
      if (overlapX(body, brush) <= EPSILON || overlapZ(body, brush) <= EPSILON) continue;
      const penetrationFromTop = brush.max.y - body.y;
      const penetrationFromBottom = body.y + PLAYER_HEIGHT - brush.min.y;
      if (penetrationFromTop <= 0 || penetrationFromBottom <= 0) continue;
      const landing = penetrationFromTop <= VERTICAL_BITE && penetrationFromTop <= penetrationFromBottom;
      const bumping = penetrationFromBottom <= VERTICAL_BITE && penetrationFromBottom < penetrationFromTop;
      if (!landing && !bumping) continue;
      const depth = landing ? penetrationFromTop : penetrationFromBottom;
      if (depth > chosenDepth) {
        chosen = brush;
        chosenDepth = depth;
        fromAbove = landing;
      }
    }
    if (!chosen) return;
    if (fromAbove) {
      body.y = chosen.max.y;
      if (body.vy < 0) body.vy = 0;
      body.grounded = true;
    } else {
      body.y = chosen.min.y - PLAYER_HEIGHT;
      if (body.vy > 0) body.vy = 0;
    }
  }
}

/** True when the body's feet are resting on something solid. Read before the jump edge. */
export function standingOn(body: Body, solids: readonly Brush[]): boolean {
  for (const brush of solids) {
    if (overlapX(body, brush) <= EPSILON || overlapZ(body, brush) <= EPSILON) continue;
    const gap = body.y - brush.max.y;
    if (gap >= -EPSILON && gap <= 0.06) return true;
  }
  return false;
}

export function insideBox(point: { x: number; y: number; z: number }, min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): boolean {
  return (
    point.x >= min.x && point.x <= max.x &&
    point.y >= min.y && point.y <= max.y &&
    point.z >= min.z && point.z <= max.z
  );
}
