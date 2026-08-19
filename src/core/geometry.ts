import { ACTOR_RADIUS } from "./constants";
import type { ActorId, ActorState, ChamberDefinition, Rect, SimulationState } from "./types";

export function overlapsCircleRect(x: number, y: number, radius: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

export function pointInsideRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function distanceBetween(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distanceToRect(actorState: ActorState, rect: Rect): number {
  const dx = Math.max(rect.x - actorState.x, 0, actorState.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - actorState.y, 0, actorState.y - (rect.y + rect.height));
  return Math.sqrt(dx * dx + dy * dy);
}

export function colliders(chamber: ChamberDefinition, state: SimulationState, actorId: ActorId): Rect[] {
  const rects = [...chamber.walls];
  if (state.door && (!state.door.open || (actorId === "past" && state.door.blocksPast))) rects.push(state.door.rect);
  if (state.forceObject) rects.push(state.forceObject);
  return rects;
}

export function moveActorBy(actorState: ActorState, dx: number, dy: number, chamber: ChamberDefinition, state: SimulationState): void {
  const obstacles = colliders(chamber, state, actorState.id);
  const nextX = actorState.x + dx;
  if (!obstacles.some((rect) => overlapsCircleRect(nextX, actorState.y, ACTOR_RADIUS, rect))) actorState.x = nextX;
  const nextY = actorState.y + dy;
  if (!obstacles.some((rect) => overlapsCircleRect(actorState.x, nextY, ACTOR_RADIUS, rect))) actorState.y = nextY;
}
