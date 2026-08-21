import { finalPose, replayPath, type TapeArchive } from "../sim/archive";
import type { ActorState, RoomDefinition } from "../sim/types";
import type { Chamber } from "./chamber";
import { DIORAMAS, type DioramaSpec } from "./ending";
import { goldenTape } from "./goldens";
import { ROSTER } from "./roster";

/** What stands behind one window in the corridor, ready to be built. */
export interface ResolvedDiorama {
  spec: DioramaSpec;
  /** The room this is a picture of, for the board under it and the shape of the set. */
  room: RoomDefinition | null;
  /**
   * The posture to stand him in. Null when nobody is in this window — 08 —
   * and only then.
   */
  pose: ActorState | null;
  /**
   * The whole walk, for the one window that still moves. Empty everywhere else,
   * because the rest of them are not replays. They are what is left.
   */
  loop: readonly ActorState[];
  /**
   * Whether this is the player's own recording or the room's own. Diagnostics
   * only — nothing in the game may draw these two differently, or the corridor
   * turns into a scoreboard of which rooms you actually played.
   */
  isPlayers: boolean;
}

/**
 * Work out what is behind every window, from what the player actually left.
 *
 * Called once, on the way into the corridor. Each window prefers the tape the
 * player made in that room and falls back to the room's own golden without
 * saying which one you are looking at.
 */
export function resolveDioramas(archive: TapeArchive): ResolvedDiorama[] {
  return DIORAMAS.map((spec): ResolvedDiorama => {
    const chamber: Chamber | null = ROSTER.byIdOrNull(spec.chamberId);
    const room = chamber?.sim ?? null;
    if (!room || spec.empty === true) {
      return { spec, room, pose: null, loop: [], isPlayers: false };
    }
    const tape = archive.tapeFor(room, goldenTape(room));
    if (!tape) return { spec, room, pose: null, loop: [], isPlayers: false };
    return {
      spec,
      room,
      pose: finalPose(room, tape),
      loop: spec.loop === true ? replayPath(room, tape) : [],
      isPlayers: archive.isPlayers(room),
    };
  });
}
