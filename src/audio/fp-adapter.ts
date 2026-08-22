import { FpAudioEngine, type Surface } from "./fp-engine";
import { DIORAMAS } from "../world/ending";
import type { SimState } from "../sim/types";
import type { ActorId } from "../sim/types";

/**
 * What the archive sounds like, decided entirely here.
 *
 * The renderer reports facts — a foot landed, a seal is coming, a line wants
 * saying — and this turns them into sound. Nothing in this file can reach the
 * simulation: it reads a state getter and never holds a reference it could
 * write through. Reading sim state from the render lane is the same licence the
 * warmBand beat already takes, and for the same reason: a flourish must not be
 * allowed anywhere near the checksum.
 */

/**
 * The only walkable surface off the ground floor is a gallery deck, and decks
 * are boarded. Rooms are brick. If a later room ever puts stone upstairs this
 * has to become authored data, but today the height is the whole truth.
 */
const TIMBER_ABOVE_Y = 1;

/**
 * The room that binds him, and the walk out. 08 is not named here — the engine
 * decides what the archive's own layer does, because that is a question about
 * the bed and not about events.
 */
const FINALE_ROOM = "last-hold";
const CORRIDOR_ROOM = "ending-corridor";

/** 04 is the only room with somewhere to look down from. */
const GALLERY_ROOM = "two-of-us";
const PASSAGE_ROOM = "long-standing";

/**
 * What the adapter needs of an engine. Narrower than the engine itself so the
 * beats — which window lit which note, when the sync fires, what 08 takes away
 * — can be tested without a browser to make sound in.
 */
export type FpAudioVoice = Pick<
  FpAudioEngine,
  "start" | "setMuted" | "setPaused" | "setSilenced" | "setRoom" | "bendRoomDown"
  | "sinkAndReturn" | "footstep" | "trigger" | "attune" | "corridorNote" | "resetCorridor" | "creak"
  | "started" | "isMuted" | "masterGain"
>;

export interface FpAudioAdapterOptions {
  /** Read-only view of the simulation. Never written to. */
  state: () => Readonly<SimState>;
  muted?: boolean;
  /** Injected only by tests; production builds the real engine. */
  engine?: FpAudioVoice;
}

export class FpAudioAdapter {
  readonly engine: FpAudioVoice;
  private readonly readState: () => Readonly<SimState>;

  private roomId: string | null = null;
  private doorsOpen: boolean[] = [];
  private platesActive: boolean[] = [];
  private holdsActive: boolean[] = [];
  private attuned = false;
  private sealing = false;
  private creaked = false;
  private successSeen = false;
  private corridorPassed = new Set<string>();

  constructor(options: FpAudioAdapterOptions) {
    this.readState = options.state;
    this.engine = options.engine ?? new FpAudioEngine(options.muted ?? false);
  }

  /** Must be called from a real user gesture. Idempotent. */
  start(): void {
    this.engine.start();
  }

  setMuted(muted: boolean): void {
    this.engine.setMuted(muted);
  }

  setPaused(paused: boolean): void {
    this.engine.setPaused(paused);
  }

  /** Called every rendered frame with the HUD's view of the world. */
  onFrame(): void {
    const state = this.readState();
    if (state.roomId !== this.roomId) this.enterRoom(state);

    this.trackDoors(state);
    this.trackContacts(state);
    this.trackAttune(state);
    if (state.roomId === CORRIDOR_ROOM) this.trackCorridor(state);

    if (state.roomId === FINALE_ROOM && state.success && !this.successSeen) {
      // Past the threshold. The handle he is still holding complains behind you.
      if (!this.creaked) {
        this.engine.creak();
        this.creaked = true;
      }
    }
    this.successSeen = state.success;
  }

  onFootstep(actor: ActorId, y: number, speed: number): void {
    if (speed < 0) return;
    const surface: Surface = y > TIMBER_ABOVE_Y ? "timber" : "brick";
    this.engine.footstep(actor === "past" ? "past" : "present", surface);
  }

  /** The finale's fold has begun. Everything goes away while it lands. */
  onSealing(): void {
    this.sealing = true;
    this.engine.setSilenced(true);
  }

  onFold(): void {
    if (this.sealing) {
      this.sealing = false;
      this.engine.setSilenced(false);
      this.engine.trigger("seal-finale");
      return;
    }
    this.engine.trigger("seal");
  }

  onUi(): void {
    this.engine.trigger("ui");
  }

  private enterRoom(state: Readonly<SimState>): void {
    const previous = this.roomId;
    this.roomId = state.roomId;
    this.attuned = false;
    this.creaked = false;
    this.successSeen = false;
    this.doorsOpen = state.doors.map((door) => door.open);
    this.platesActive = state.plates.map((plate) => plate.active);
    this.holdsActive = state.holds.map((hold) => hold.active);
    if (previous === CORRIDOR_ROOM || state.roomId === CORRIDOR_ROOM) {
      this.corridorPassed.clear();
      this.engine.resetCorridor();
    }
    // 08 plays the same bed with the archive's layer gone, and it does not come
    // back when you solve it. setRoom carries both the note and the absence.
    this.engine.setRoom(state.roomId);
  }

  private trackDoors(state: Readonly<SimState>): void {
    state.doors.forEach((door, index) => {
      const before = this.doorsOpen[index] ?? false;
      if (door.open && !before) {
        this.engine.trigger("door-slide");
        // No chime, anywhere, ever. An opening door is the room settling: it
        // sinks and comes back. In the finale it sinks and stays there.
        if (state.roomId === FINALE_ROOM) this.engine.bendRoomDown();
        else this.engine.sinkAndReturn();
      }
      this.doorsOpen[index] = door.open;
    });
  }

  private trackContacts(state: Readonly<SimState>): void {
    state.plates.forEach((plate, index) => {
      if (plate.active && !(this.platesActive[index] ?? false)) this.engine.trigger("plate");
      this.platesActive[index] = plate.active;
    });
    state.holds.forEach((hold, index) => {
      if (hold.active && !(this.holdsActive[index] ?? false)) this.engine.trigger("hold");
      this.holdsActive[index] = hold.active;
    });
  }

  /**
   * The sync beat. Once per room, on the moment his standing still is what is
   * holding your way open and you are already in it.
   *
   * 04 has an authored warm band to look down at; 05 is derived instead, which
   * is why the two conditions do not look alike.
   */
  private trackAttune(state: Readonly<SimState>): void {
    if (this.attuned || state.phase !== "replay") return;
    const player = state.actors.find((actor) => actor.id === "present");
    if (!player) return;
    if (state.roomId === GALLERY_ROOM) {
      if (state.holds.some((hold) => hold.active) && player.y > TIMBER_ABOVE_Y) {
        this.engine.attune();
        this.attuned = true;
      }
      return;
    }
    if (state.roomId === PASSAGE_ROOM) {
      if (state.plates.some((plate) => plate.active) && state.doors.some((door) => door.open)) {
        this.engine.attune();
        this.attuned = true;
      }
    }
  }

  /**
   * The walk out. Each window adds its room's note and the note stays, so the
   * chord is everywhere you have been, still sounding. 08's window is empty and
   * therefore silent, and the chord ends with the shape of it missing.
   */
  private trackCorridor(state: Readonly<SimState>): void {
    const player = state.actors.find((actor) => actor.id === "present");
    if (!player) return;
    for (const diorama of DIORAMAS) {
      if (this.corridorPassed.has(diorama.chamberId)) continue;
      if (player.z < diorama.centreZ) continue;
      this.corridorPassed.add(diorama.chamberId);
      // An empty window has nobody behind it and nothing to sound. The engine
      // would refuse this note anyway; refusing it here too means the hole in
      // the chord survives an edit to either side of the boundary.
      if (diorama.empty) continue;
      this.engine.corridorNote(diorama.chamberId);
    }
  }
}
