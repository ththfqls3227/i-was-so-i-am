import type { Brush, Vec3 } from "../sim/types";
import type { RoomShell } from "./chamber";

export function box(id: string, min: Vec3, max: Vec3): Brush {
  return { id, min, max };
}

/**
 * The brushes for a standard chamber: a sealed hall with a doorway in its far
 * wall and a corridor beyond it.
 *
 * Every chamber that is a hall and a corridor is built from this, so the walls a
 * player collides with come from the same numbers the renderer dresses. A room
 * that needs a different shape authors its own brushes; three of the first four
 * do not.
 */
export function hallBrushes(shell: RoomShell): Brush[] {
  const wall = shell.wallThickness;
  const halfWidth = shell.halfWidth;
  const depth = shell.depth;
  const height = shell.height;
  const corridorHalf = shell.corridorHalfWidth;
  const corridorEnd = shell.corridorEnd;
  const corridorHeight = shell.corridorHeight;
  const doorHalf = shell.doorwayHalfWidth;
  const doorHeight = shell.doorwayHeight;

  return [
    box("floor-room", { x: -halfWidth - wall, y: -wall, z: -wall }, { x: halfWidth + wall, y: 0, z: depth + wall }),
    box("floor-corridor", { x: -corridorHalf - wall, y: -wall, z: depth }, { x: corridorHalf + wall, y: 0, z: corridorEnd + wall }),
    box("ceiling-room", { x: -halfWidth - wall, y: height, z: -wall }, { x: halfWidth + wall, y: height + wall, z: depth + wall }),
    box("ceiling-corridor", { x: -corridorHalf - wall, y: corridorHeight, z: depth }, { x: corridorHalf + wall, y: corridorHeight + wall, z: corridorEnd + wall }),

    box("wall-west", { x: -halfWidth - wall, y: 0, z: -wall }, { x: -halfWidth, y: height, z: depth + wall }),
    box("wall-east", { x: halfWidth, y: 0, z: -wall }, { x: halfWidth + wall, y: height, z: depth + wall }),
    box("wall-back", { x: -halfWidth - wall, y: 0, z: -wall }, { x: halfWidth + wall, y: height, z: 0 }),

    // Far wall, split around the doorway.
    box("wall-far-left", { x: -halfWidth - wall, y: 0, z: depth }, { x: -doorHalf, y: height, z: depth + wall }),
    box("wall-far-right", { x: doorHalf, y: 0, z: depth }, { x: halfWidth + wall, y: height, z: depth + wall }),
    box("wall-far-lintel", { x: -doorHalf, y: doorHeight, z: depth }, { x: doorHalf, y: height, z: depth + wall }),

    box("corridor-west", { x: -corridorHalf - wall, y: 0, z: depth }, { x: -corridorHalf, y: corridorHeight, z: corridorEnd + wall }),
    box("corridor-east", { x: corridorHalf, y: 0, z: depth }, { x: corridorHalf + wall, y: corridorHeight, z: corridorEnd + wall }),
    box("corridor-end", { x: -corridorHalf - wall, y: 0, z: corridorEnd }, { x: corridorHalf + wall, y: corridorHeight, z: corridorEnd + wall }),
  ];
}

/** The slab that fills a standard doorway when its door is shut. */
export function doorwayBrush(id: string, shell: RoomShell): Brush {
  return box(
    id,
    { x: -shell.doorwayHalfWidth, y: 0, z: shell.depth + 0.05 },
    { x: shell.doorwayHalfWidth, y: shell.doorwayHeight, z: shell.depth + shell.wallThickness - 0.05 },
  );
}

/** The volume past the corridor that counts as having left. */
export function corridorExit(shell: RoomShell): { id: string; min: Vec3; max: Vec3 } {
  return {
    id: "exit",
    min: { x: -shell.corridorHalfWidth, y: 0, z: shell.corridorEnd - 1.4 },
    max: { x: shell.corridorHalfWidth, y: shell.corridorHeight, z: shell.corridorEnd },
  };
}
