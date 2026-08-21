import { Simulation } from "./simulation";
import { validateTape } from "./tape";
import type { ActorState, RoomDefinition, Tape } from "./types";

/**
 * Every tape the player has left behind, kept by the chamber that took it.
 *
 * The game throws these away otherwise — switching chambers builds a fresh
 * simulation and the old tape goes with the old one. Two things at the end of
 * the game need them back: the older self standing on a plate in 08 is the
 * record you left in 01, and the corridor at the end replays the very first
 * tape you ever made. Both only mean anything if they are yours.
 */
export class TapeArchive {
  private readonly byChamber = new Map<string, Tape>();

  /** Keep what a chamber recorded. Called on the way out of it. */
  keep(tape: Tape | null): void {
    if (tape) this.byChamber.set(tape.roomId, tape);
  }

  has(roomId: string): boolean {
    return this.byChamber.has(roomId);
  }

  /**
   * The player's tape for this room, or the fallback, or null.
   *
   * A tape recorded against an older version of a room will not replay in the
   * current one, so it is checked rather than trusted. When it fails — or when
   * the player reached this chamber without ever playing that one — the golden
   * stands in silently. Nothing says which one you are looking at, because in
   * the rooms this is used for the poses converge: 01 is solved by standing
   * still on a plate, so every player's tape ends in the same posture.
   */
  tapeFor(room: RoomDefinition, fallback: Tape | null = null): Tape | null {
    const kept = this.byChamber.get(room.id);
    if (kept && validateTape(room, kept) === null) return kept;
    if (fallback && validateTape(room, fallback) === null) return fallback;
    return null;
  }

  /** Whether the tape on offer for this room is the player's own. Diagnostics only. */
  isPlayers(room: RoomDefinition): boolean {
    const kept = this.byChamber.get(room.id);
    return kept !== undefined && validateTape(room, kept) === null;
  }

  clear(): void {
    this.byChamber.clear();
  }
}

/**
 * Replay a tape on its own and hand back where the echo was, tick by tick.
 *
 * This is how a diorama is driven: the same step function the game runs, with
 * nobody living in the room. The living actor is fed nothing, so it stands at
 * the spawn and the only thing moving is the recording.
 */
export function replayPath(room: RoomDefinition, tape: Tape): ActorState[] {
  const simulation = new Simulation(room);
  if (!simulation.loadTape(tape)) return [];
  const path: ActorState[] = [];
  for (let tick = 0; tick < tape.duration; tick += 1) {
    simulation.step(0);
    const past = simulation.state.actors.find((actor) => actor.id === "past");
    if (past) path.push({ ...past });
  }
  return path;
}

/**
 * Where a recording ended up: the pose the fold froze.
 *
 * 08 stands an older self on a plate, and that is this — not an animation, and
 * not a guess. The last frame of a tape is the posture it was sealed in.
 */
export function finalPose(room: RoomDefinition, tape: Tape): ActorState | null {
  const path = replayPath(room, tape);
  return path[path.length - 1] ?? null;
}
