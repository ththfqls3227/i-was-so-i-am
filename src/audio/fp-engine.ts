import { FINALE_DRONE_DROP_HZ, FP_SCORE, ROOM_NOTES } from "./score";
import { noiseBuffer, pluck, rampTo, type NoiseVoice, type ToneVoice } from "./engine";

/**
 * The archive's voice.
 *
 * Same contract the retired engine was built to: every oscillator and buffer
 * source is created once, on the first user gesture, and then runs forever
 * behind a gain of zero. Triggering a sound schedules AudioParam automation and
 * allocates nothing, so no room change, fold, or phase transition can stall the
 * fixed-step loop. The art bible files this under 「전환 시점 할당 금지(6회 교훈)」.
 *
 * It reads nothing and writes nothing. The adapter hands it events; it has no
 * route back to the simulation.
 */

export type FpSound =
  | "seal"
  | "seal-finale"
  | "door-slide"
  | "plate"
  | "hold"
  | "ui"
  | "blip";

export type Surface = "brick" | "timber";
export type Walker = "present" | "past";

interface StepVoice {
  noise: NoiseVoice;
  body: ToneVoice;
  ring: ToneVoice | null;
}

interface Graph {
  master: GainNode;
  droneRoot: OscillatorNode;
  droneDetuned: OscillatorNode;
  droneFifth: OscillatorNode;
  droneBed: NoiseVoice;
  cyan: { voices: ToneVoice[]; gain: GainNode };
  steps: Record<`${Walker}-${Surface}`, StepVoice>;
  seal: { thud: ToneVoice; body: NoiseVoice; brass: ToneVoice };
  door: { sweep: NoiseVoice; stop: ToneVoice };
  contact: { plate: ToneVoice; hold: ToneVoice };
  attune: ToneVoice[];
  corridor: Map<string, ToneVoice>;
  creak: { osc: OscillatorNode; lfo: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  ui: ToneVoice;
}

/**
 * The musical half of the archive — drones, the cyan hum, the sync chord, the
 * corridor's arriving notes — held out of the mix by owner decision (2026-08-23,
 * "일단 음악은 빼고"). The event sounds stay: feet, doors, plates, the seal.
 * Every musical voice still runs and still takes its automation, so flipping
 * this back on is the whole undo.
 */
// On again, on the owner's ask. The whole score was written and kept running
// behind a silent gain; 08's missing-layer beat only reads with it audible.
const MUSIC_ENABLED = true;

const noteFor = (chamberId: string): (typeof ROOM_NOTES)[number] | undefined =>
  ROOM_NOTES.find((entry) => entry.chamberId === chamberId);

export class FpAudioEngine {
  private context: AudioContext | null = null;
  private graph: Graph | null = null;
  private muted: boolean;
  private paused = false;
  private silenced = false;
  /** The one wire the owner's "no music" runs through, kept for the goodbye. */
  private musicGain: GainNode | null = null;
  private roomHz = ROOM_NOTES[ROOM_NOTES.length - 1]?.droneHz ?? 73.42;

  constructor(muted = false) {
    this.muted = muted;
  }

  get started(): boolean {
    return this.graph !== null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** The live master gain. The honest answer to "is this thing audible". */
  get masterGain(): number {
    return this.graph?.master.gain.value ?? 0;
  }

  /** Build the context and the whole graph. Must be called inside a user gesture. */
  start(): void {
    if (this.graph) {
      if (this.context?.state === "suspended") void this.context.resume();
      return;
    }
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      // No WebAudio, or it was refused. The archive is playable in silence.
      return;
    }
    this.context = context;
    this.graph = this.build(context);
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    this.graph.master.gain.setValueAtTime(0, now);
    this.graph.master.gain.linearRampToValueAtTime(this.targetMaster(), now + FP_SCORE.master.openSeconds);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMaster();
  }

  /**
   * The finale's held breath. Not the pause duck — this is the room taking
   * everything away for eight tenths of a second while the seal lands.
   */
  setSilenced(silenced: boolean): void {
    this.silenced = silenced;
    this.applyMaster();
  }

  /**
   * Glide the drone to this room's note, and decide whether the archive's own
   * layer is running. 08 is the room where it is not, and nothing announces it.
   */
  setRoom(chamberId: string): void {
    const graph = this.graph;
    const context = this.context;
    const note = noteFor(chamberId);
    if (note) this.roomHz = note.droneHz;
    if (!graph || !context) return;
    const now = context.currentTime;
    const glide = FP_SCORE.ambient.glideSeconds;
    rampTo(graph.droneRoot.frequency, this.roomHz, now, glide);
    rampTo(graph.droneDetuned.frequency, this.roomHz, now, glide);
    rampTo(graph.droneFifth.frequency, this.roomHz * FP_SCORE.ambient.fifthRatio, now, glide);
    const cyan = chamberId === "silence" ? 0 : FP_SCORE.ambient.cyanGain;
    rampTo(graph.cyan.gain.gain, cyan, now, FP_SCORE.ambient.cyanFadeSeconds);
  }

  /** 09 only: the gate opens and the room settles a semitone lower for good. */
  bendRoomDown(): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const now = context.currentTime;
    const seconds = FP_SCORE.door.sinkSeconds;
    rampTo(graph.droneRoot.frequency, FINALE_DRONE_DROP_HZ, now, seconds);
    rampTo(graph.droneDetuned.frequency, FINALE_DRONE_DROP_HZ, now, seconds);
    rampTo(graph.droneFifth.frequency, FINALE_DRONE_DROP_HZ * FP_SCORE.ambient.fifthRatio, now, seconds);
  }

  /** Every other room: an opening door is the drone sinking and coming back. */
  sinkAndReturn(): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const now = context.currentTime;
    const low = this.roomHz * FP_SCORE.door.sinkRatio;
    for (const [osc, hz] of [
      [graph.droneRoot, this.roomHz],
      [graph.droneDetuned, this.roomHz],
      [graph.droneFifth, this.roomHz * FP_SCORE.ambient.fifthRatio],
    ] as const) {
      const target = hz === this.roomHz ? low : low * FP_SCORE.ambient.fifthRatio;
      osc.frequency.cancelScheduledValues(now);
      osc.frequency.setValueAtTime(osc.frequency.value, now);
      osc.frequency.linearRampToValueAtTime(target, now + FP_SCORE.door.sinkSeconds);
      osc.frequency.linearRampToValueAtTime(hz, now + FP_SCORE.door.sinkSeconds + FP_SCORE.door.sinkReturnSeconds);
    }
  }

  /**
   * The owner's "no music" stands for the whole game except the goodbye: at
   * the ending the corridor's own chords come back, from silence, slowly.
   */
  beginEndingMusic(): void {
    if (!this.musicGain || !this.context) return;
    const now = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(1, now + 4.5);
  }

  footstep(walker: Walker, surface: Surface): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const voice = graph.steps[`${walker}-${surface}`];
    const spec = surface === "brick" ? FP_SCORE.step.brick : FP_SCORE.step.timber;
    const echo = walker === "past";
    const scale = echo ? FP_SCORE.step.echo.gainScale : 1;
    const at = context.currentTime + (echo ? FP_SCORE.step.echo.preDelaySeconds : 0);
    pluck(voice.noise.gain.gain, at, spec.noiseGain * scale, 0.002, spec.noiseDecay);
    pluck(voice.body.gain.gain, at, spec.bodyGain * scale, 0.003, spec.bodyDecay);
    if (voice.ring) pluck(voice.ring.gain.gain, at, spec.bodyGain * 0.5 * scale, 0.004, spec.bodyDecay * 1.4);
  }

  trigger(sound: FpSound): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const now = context.currentTime;
    switch (sound) {
      case "seal":
        return this.playSeal(graph, now, 1, 1);
      case "seal-finale":
        return this.playSeal(graph, now, FP_SCORE.seal.finaleTimeScale, FP_SCORE.seal.finaleGainScale);
      case "door-slide": {
        const { sweep, stop } = graph.door;
        sweep.filter.frequency.cancelScheduledValues(now);
        sweep.filter.frequency.setValueAtTime(FP_SCORE.door.sweepFromHz, now);
        sweep.filter.frequency.exponentialRampToValueAtTime(FP_SCORE.door.sweepToHz, now + 0.6);
        pluck(sweep.gain.gain, now, FP_SCORE.door.sweepGain, 0.08, 0.55);
        pluck(stop.gain.gain, now + 0.6, FP_SCORE.door.stopGain, 0.003, FP_SCORE.door.stopDecay);
        return;
      }
      case "plate":
        return pluck(graph.contact.plate.gain.gain, now, FP_SCORE.contact.plateGain, FP_SCORE.contact.plateAttack, FP_SCORE.contact.plateDecay);
      case "hold":
        return pluck(graph.contact.hold.gain.gain, now, FP_SCORE.contact.holdGain, 0.008, FP_SCORE.contact.holdDecay);
      case "ui":
        return pluck(graph.ui.gain.gain, now, FP_SCORE.ui.gain, 0.001, FP_SCORE.ui.seconds);
      case "blip":
        // The archivist's voice, such as it is: the ui tick at a quarter of
        // its weight, once every few written characters. In a game with no
        // music this is what reads as someone speaking.
        return pluck(graph.ui.gain.gain, now, FP_SCORE.ui.gain * 0.25, 0.001, 0.035);
    }
  }

  /** The sync beat: a third and a fifth over the room, once, and never again. */
  attune(): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const now = context.currentTime;
    const ratios = [FP_SCORE.attune.thirdRatio, FP_SCORE.attune.fifthRatio];
    graph.attune.forEach((voice, index) => {
      const ratio = ratios[index] ?? 1;
      voice.osc.frequency.cancelScheduledValues(now);
      voice.osc.frequency.setValueAtTime(this.roomHz * 4 * ratio, now);
      pluck(voice.gain.gain, now, FP_SCORE.attune.gain, FP_SCORE.attune.attackSeconds, FP_SCORE.attune.releaseSeconds);
    });
  }

  /**
   * A corridor window went by. Its note arrives and stays; the chord is what is
   * left standing when the walk ends. 08 is never passed here — its window is
   * empty — so the chord finishes with a hole in it.
   */
  corridorNote(chamberId: string): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const voice = graph.corridor.get(chamberId);
    const note = noteFor(chamberId);
    if (!voice || !note || !note.joinsChord) return;
    const ground = chamberId === "awakening";
    rampTo(
      voice.gain.gain,
      FP_SCORE.corridor.gain * (ground ? FP_SCORE.corridor.groundGainScale : 1),
      context.currentTime,
      ground ? FP_SCORE.corridor.groundArriveSeconds : FP_SCORE.corridor.arriveSeconds,
    );
  }

  /** Leaving the corridor, or entering it again from a chamber select. */
  resetCorridor(): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    for (const voice of graph.corridor.values()) rampTo(voice.gain.gain, 0, context.currentTime, 0.4);
  }

  /** Brass complaining behind you, three seconds down the corridor. */
  creak(): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const now = context.currentTime;
    pluck(graph.creak.gain.gain, now, FP_SCORE.creak.gain, 0.05, FP_SCORE.creak.decaySeconds);
  }

  private playSeal(graph: Graph, now: number, timeScale: number, gainScale: number): void {
    const { thud, body, brass } = graph.seal;
    const fall = FP_SCORE.seal.thudSeconds * timeScale;
    thud.osc.frequency.cancelScheduledValues(now);
    thud.osc.frequency.setValueAtTime(FP_SCORE.seal.thudFromHz, now);
    thud.osc.frequency.exponentialRampToValueAtTime(FP_SCORE.seal.thudToHz, now + fall);
    pluck(thud.gain.gain, now, FP_SCORE.seal.thudGain * gainScale, 0.003, fall * 2.4);
    pluck(body.gain.gain, now, FP_SCORE.seal.bodyGain * gainScale, 0.002, FP_SCORE.seal.bodyDecay * timeScale);
    pluck(brass.gain.gain, now, FP_SCORE.seal.brassGain * gainScale, 0.001, 0.09 * timeScale);
  }

  private targetMaster(): number {
    if (this.muted || this.silenced) return 0;
    return this.paused ? FP_SCORE.master.gain * FP_SCORE.master.pauseDuck : FP_SCORE.master.gain;
  }

  private applyMaster(): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const seconds = this.silenced ? FP_SCORE.master.silenceRamp : FP_SCORE.master.ramp;
    rampTo(graph.master.gain, this.targetMaster(), context.currentTime, seconds);
  }

  // -------------------------------------------------------------------------
  // Construction. Runs exactly once.
  // -------------------------------------------------------------------------

  private build(context: AudioContext): Graph {
    const master = context.createGain();
    master.gain.value = 0;
    const compressor = context.createDynamicsCompressor();
    const { threshold, knee, ratio, attack, release } = FP_SCORE.master.compressor;
    compressor.threshold.value = threshold;
    compressor.knee.value = knee;
    compressor.ratio.value = ratio;
    compressor.attack.value = attack;
    compressor.release.value = release;
    master.connect(compressor).connect(context.destination);

    // Every musical voice reaches the master through this one gain, so the
    // owner's "no music" is a single wire and not a dozen scattered zeros.
    const music = context.createGain();
    music.gain.value = MUSIC_ENABLED ? 1 : 0;
    music.connect(master);
    this.musicGain = music;

    const white = noiseBuffer(context, false);
    const brown = noiseBuffer(context, true);

    const tone = (type: OscillatorType, hz: number, destination: AudioNode = master): ToneVoice => {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      const gain = context.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(destination);
      osc.start();
      return { osc, gain };
    };

    const noise = (
      buffer: AudioBuffer,
      filterType: BiquadFilterType,
      hz: number,
      q: number,
      destination: AudioNode = master,
    ): NoiseVoice => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = hz;
      filter.Q.value = q;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(destination);
      source.start();
      return { source, filter, gain };
    };

    // The building: a drone that is always on, and the air in the room.
    const droneRoot = tone("sine", this.roomHz, music);
    droneRoot.gain.gain.value = FP_SCORE.ambient.timberGain;
    const droneDetuned = tone("sine", this.roomHz, music);
    droneDetuned.osc.detune.value = FP_SCORE.ambient.detuneCents;
    droneDetuned.gain.gain.value = FP_SCORE.ambient.timberGain;
    const droneFifth = tone("sine", this.roomHz * FP_SCORE.ambient.fifthRatio, music);
    droneFifth.gain.gain.value = FP_SCORE.ambient.fifthGain;
    const droneBed = noise(brown, "lowpass", FP_SCORE.ambient.noiseFilterHz, 0.7, music);
    droneBed.gain.gain.value = FP_SCORE.ambient.noiseGain;

    // The time technology. Under every room from 00, so that 08 can take it
    // away from an ear that had stopped noticing it was there.
    const cyanGain = context.createGain();
    cyanGain.gain.value = FP_SCORE.ambient.cyanGain;
    cyanGain.connect(music);
    const cyanVoices = FP_SCORE.ambient.cyanPartials.map((hz, index) => {
      const voice = tone("sine", hz, cyanGain);
      voice.gain.gain.value = 1 / (index + 2);
      voice.osc.detune.value = index * 4;
      return voice;
    });

    const stepVoice = (surface: Surface, walker: Walker): StepVoice => {
      const echo = walker === "past";
      if (surface === "brick") {
        const spec = FP_SCORE.step.brick;
        return {
          // The echo's feet keep the noise and lose the body underneath them.
          noise: noise(white, echo ? "highpass" : "bandpass", echo ? FP_SCORE.step.echo.highpassHz : spec.noiseHz, spec.noiseQ),
          body: tone("sine", spec.bodyHz),
          ring: null,
        };
      }
      const spec = FP_SCORE.step.timber;
      const body = tone("sine", spec.bodyHz);
      if (echo) body.osc.detune.value = FP_SCORE.step.echo.detuneCents;
      return {
        noise: noise(white, echo ? "highpass" : "bandpass", echo ? FP_SCORE.step.echo.highpassHz : spec.noiseHz, spec.noiseQ),
        body,
        ring: tone("sine", spec.ringHz),
      };
    };

    const creakOsc = context.createOscillator();
    creakOsc.type = "sawtooth";
    creakOsc.frequency.value = FP_SCORE.creak.baseHz;
    const creakFilter = context.createBiquadFilter();
    creakFilter.type = "bandpass";
    creakFilter.frequency.value = FP_SCORE.creak.filterHz;
    creakFilter.Q.value = FP_SCORE.creak.filterQ;
    const creakGain = context.createGain();
    creakGain.gain.value = 0;
    creakOsc.connect(creakFilter).connect(creakGain).connect(master);
    creakOsc.start();
    const creakLfo = context.createOscillator();
    creakLfo.type = "sine";
    creakLfo.frequency.value = FP_SCORE.creak.lfoHz;
    const creakDepth = context.createGain();
    creakDepth.gain.value = FP_SCORE.creak.lfoDepthHz;
    creakLfo.connect(creakDepth).connect(creakFilter.frequency);
    creakLfo.start();

    const corridor = new Map<string, ToneVoice>();
    for (const note of ROOM_NOTES) {
      if (!note.joinsChord) continue;
      corridor.set(note.chamberId, tone("sine", note.corridorHz, music));
    }

    return {
      master,
      droneRoot: droneRoot.osc,
      droneDetuned: droneDetuned.osc,
      droneFifth: droneFifth.osc,
      droneBed,
      cyan: { voices: cyanVoices, gain: cyanGain },
      steps: {
        "present-brick": stepVoice("brick", "present"),
        "present-timber": stepVoice("timber", "present"),
        "past-brick": stepVoice("brick", "past"),
        "past-timber": stepVoice("timber", "past"),
      },
      seal: {
        thud: tone("sine", FP_SCORE.seal.thudFromHz),
        body: noise(white, "lowpass", FP_SCORE.seal.bodyFilterHz, 0.9),
        brass: tone("triangle", FP_SCORE.seal.brassHz),
      },
      door: {
        sweep: noise(brown, "bandpass", FP_SCORE.door.sweepFromHz, FP_SCORE.door.sweepQ),
        stop: tone("sine", FP_SCORE.door.stopHz),
      },
      contact: {
        plate: tone("triangle", FP_SCORE.contact.plateHz),
        hold: tone("triangle", FP_SCORE.contact.holdHz),
      },
      attune: [tone("sine", this.roomHz * 4, music), tone("sine", this.roomHz * 6, music)],
      corridor,
      creak: { osc: creakOsc, lfo: creakLfo, filter: creakFilter, gain: creakGain },
      ui: tone("square", FP_SCORE.ui.hz),
    };
  }
}
