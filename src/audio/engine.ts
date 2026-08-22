import type { ChamberId } from "../core/types";
import { AMBIENT_ROOT_HZ, SCORE } from "./score";

/**
 * Procedural WebAudio engine. Two rules shape the whole design:
 *
 * 1. **Nothing is allocated after startup.** Every oscillator, buffer source
 *    and filter is built and started once, on the first user gesture, and then
 *    runs forever behind a gain of zero. Triggering a sound only schedules
 *    AudioParam automation. A room change, a fold, or a recording→replay
 *    transition therefore costs no node construction on the main thread — the
 *    fixed-step loop cannot be stalled by a sound starting.
 * 2. **Audio only ever reads state.** Nothing here can reach the simulation or
 *    the scene; the caller pushes transitions in.
 *
 * The AudioContext itself is created on the first user gesture, so no browser
 * ever logs an autoplay warning.
 */

export type SoundName =
  | "record-start"
  | "fold"
  | "echo-materialize"
  | "gate-open"
  | "carrier-pickup"
  | "carrier-stage"
  | "carrier-deliver"
  | "success"
  | "fail"
  | "ending"
  | "ui";

export type LoopName = "winch" | "push";

export const SILENCE = 0.0001;
const NOISE_SECONDS = 2;

export interface ToneVoice {
  osc: OscillatorNode;
  gain: GainNode;
}

export interface NoiseVoice {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface Graph {
  master: GainNode;
  ambient: {
    root: OscillatorNode;
    detuned: OscillatorNode;
    fifth: OscillatorNode;
    noise: NoiseVoice;
    gain: GainNode;
  };
  recordStart: { sweep: ToneVoice; click: NoiseVoice };
  fold: { down: ToneVoice; up: ToneVoice; sweep: NoiseVoice };
  echo: ToneVoice[];
  winch: { osc: OscillatorNode; lfo: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  push: NoiseVoice;
  gate: { thud: ToneVoice; body: NoiseVoice };
  knock: { tone: ToneVoice; click: NoiseVoice };
  success: { chord: ToneVoice[]; pad: ToneVoice };
  fail: { upper: ToneVoice; lower: ToneVoice };
  ending: { resolve: ToneVoice[]; stars: ToneVoice[] };
  ui: ToneVoice;
}

export function noiseBuffer(context: AudioContext, brown: boolean): AudioBuffer {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * NOISE_SECONDS), context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (!brown) {
      data[index] = white;
      continue;
    }
    last = (last + 0.02 * white) / 1.02;
    data[index] = last * 3.5;
  }
  return buffer;
}

/** Ramp a param from wherever it is now, without the discontinuity a bare set would make. */
export function rampTo(param: AudioParam, value: number, now: number, seconds: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

/**
 * Attack to `peak`, then an exponential fall to silence. Every one-shot in the
 * game is this shape on a permanently running oscillator.
 */
export function pluck(param: AudioParam, at: number, peak: number, attack: number, decay: number): void {
  param.cancelScheduledValues(at);
  param.setValueAtTime(param.value, at);
  param.linearRampToValueAtTime(peak, at + attack);
  param.exponentialRampToValueAtTime(SILENCE, at + attack + decay);
  param.setValueAtTime(0, at + attack + decay + 0.004);
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private graph: Graph | null = null;
  private muted: boolean;
  private paused = false;
  private room: ChamberId = "crossing";
  /** What each loop would be doing if the game were not paused. */
  private loopTargets: Record<LoopName, boolean> = { winch: false, push: false };

  constructor(muted = false) {
    this.muted = muted;
  }

  /** True once the first user gesture has built the context and the graph. */
  get started(): boolean {
    return this.graph !== null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** The live master gain value — the honest answer to "is this thing audible". */
  get masterGain(): number {
    return this.graph?.master.gain.value ?? 0;
  }

  /**
   * Build the context and the entire node graph. Safe to call on every gesture;
   * it only does the work once. Must be called from a user gesture handler.
   */
  start(): void {
    if (this.graph) {
      // A tab restored from the background can leave the context suspended.
      if (this.context?.state === "suspended") void this.context.resume();
      return;
    }
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      // No WebAudio (or it was denied): the game is fully playable in silence.
      return;
    }
    this.context = context;
    this.graph = this.build(context);
    if (context.state === "suspended") void context.resume();
    const now = context.currentTime;
    this.graph.master.gain.setValueAtTime(0, now);
    this.graph.master.gain.linearRampToValueAtTime(this.targetMaster(), now + SCORE.master.openSeconds);
    this.setRoom(this.room);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  /**
   * The pause screen dims the mix and stops the machinery — a winch caught
   * mid-hold must not creak on under a frozen simulation — while the room's
   * drone keeps breathing underneath.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMaster();
    this.applyLoop("winch");
    this.applyLoop("push");
  }

  /** Glide the drone to this room's root note. */
  setRoom(room: ChamberId): void {
    this.room = room;
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const root = AMBIENT_ROOT_HZ[room];
    const now = context.currentTime;
    const glide = SCORE.ambient.glideSeconds;
    rampTo(graph.ambient.root.frequency, root, now, glide);
    rampTo(graph.ambient.detuned.frequency, root, now, glide);
    rampTo(graph.ambient.fifth.frequency, root * SCORE.ambient.fifthRatio, now, glide);
  }

  setLoop(name: LoopName, active: boolean): void {
    this.loopTargets[name] = active;
    this.applyLoop(name);
  }

  trigger(name: SoundName): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const now = context.currentTime;
    switch (name) {
      case "record-start": return this.playRecordStart(graph, now);
      case "fold": return this.playFold(graph, now);
      case "echo-materialize": return this.playEcho(graph, now);
      case "gate-open": return this.playGate(graph, now);
      case "carrier-pickup": return this.playKnock(graph, now, SCORE.knock.pickupHz);
      case "carrier-stage": return this.playKnock(graph, now, SCORE.knock.stageHz);
      case "carrier-deliver": return this.playKnock(graph, now, SCORE.knock.deliverHz);
      case "success": return this.playSuccess(graph, now);
      case "fail": return this.playFail(graph, now);
      case "ending": return this.playEnding(graph, now);
      case "ui": return this.playUi(graph, now);
    }
  }

  private targetMaster(): number {
    if (this.muted) return 0;
    return this.paused ? SCORE.master.gain * SCORE.master.pauseDuck : SCORE.master.gain;
  }

  private applyMaster(): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    rampTo(graph.master.gain, this.targetMaster(), context.currentTime, SCORE.master.ramp);
  }

  private applyLoop(name: LoopName): void {
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const active = this.loopTargets[name] && !this.paused;
    const now = context.currentTime;
    if (name === "winch") {
      rampTo(graph.winch.gain.gain, active ? SCORE.winch.gain : 0, now, SCORE.winch.rampSeconds);
      return;
    }
    rampTo(graph.push.gain.gain, active ? SCORE.push.gain : 0, now, SCORE.push.rampSeconds);
  }

  // -------------------------------------------------------------------------
  // One-shots. Each only schedules automation on nodes built in `build`.
  // -------------------------------------------------------------------------

  private playRecordStart(graph: Graph, now: number): void {
    const { sweep, click } = graph.recordStart;
    pluck(click.gain.gain, now, SCORE.recordStart.clickGain, 0.002, SCORE.recordStart.clickDecay);
    sweep.osc.frequency.cancelScheduledValues(now);
    sweep.osc.frequency.setValueAtTime(SCORE.recordStart.sweepFromHz, now);
    sweep.osc.frequency.exponentialRampToValueAtTime(SCORE.recordStart.sweepToHz, now + SCORE.recordStart.sweepSeconds);
    pluck(sweep.gain.gain, now, SCORE.recordStart.sweepGain, 0.03, SCORE.recordStart.sweepSeconds);
  }

  private playFold(graph: Graph, now: number): void {
    const { down, up, sweep } = graph.fold;
    const half = SCORE.fold.seconds / 2;
    const { centerHz, dipHz } = SCORE.fold;
    // Mirrored contours: time bends down and comes back, and something else
    // bends the opposite way through it.
    down.osc.frequency.cancelScheduledValues(now);
    down.osc.frequency.setValueAtTime(centerHz, now);
    down.osc.frequency.exponentialRampToValueAtTime(dipHz, now + half);
    down.osc.frequency.exponentialRampToValueAtTime(centerHz, now + SCORE.fold.seconds);
    up.osc.frequency.cancelScheduledValues(now);
    up.osc.frequency.setValueAtTime(dipHz, now);
    up.osc.frequency.exponentialRampToValueAtTime(centerHz, now + half);
    up.osc.frequency.exponentialRampToValueAtTime(dipHz, now + SCORE.fold.seconds);
    pluck(down.gain.gain, now, SCORE.fold.gain, 0.02, SCORE.fold.seconds);
    pluck(up.gain.gain, now, SCORE.fold.gain * 0.7, 0.06, SCORE.fold.seconds);
    sweep.filter.frequency.cancelScheduledValues(now);
    sweep.filter.frequency.setValueAtTime(SCORE.fold.sweepFilterFromHz, now);
    sweep.filter.frequency.exponentialRampToValueAtTime(SCORE.fold.sweepFilterToHz, now + half);
    sweep.filter.frequency.exponentialRampToValueAtTime(SCORE.fold.sweepFilterFromHz, now + SCORE.fold.seconds);
    pluck(sweep.gain.gain, now, SCORE.fold.sweepGain, 0.04, SCORE.fold.seconds);
  }

  private playEcho(graph: Graph, now: number): void {
    for (const voice of graph.echo) {
      pluck(voice.gain.gain, now, SCORE.echo.gain, SCORE.echo.attackSeconds, SCORE.echo.releaseSeconds);
    }
  }

  private playGate(graph: Graph, now: number): void {
    const { thud, body } = graph.gate;
    thud.osc.frequency.cancelScheduledValues(now);
    thud.osc.frequency.setValueAtTime(SCORE.gate.thudHz * 1.6, now);
    thud.osc.frequency.exponentialRampToValueAtTime(SCORE.gate.thudHz, now + SCORE.gate.thudDecay);
    pluck(thud.gain.gain, now, SCORE.gate.thudGain, 0.004, SCORE.gate.thudDecay);
    pluck(body.gain.gain, now, SCORE.gate.bodyGain, 0.003, SCORE.gate.bodyDecay);
  }

  private playKnock(graph: Graph, now: number, hz: number): void {
    const { tone, click } = graph.knock;
    tone.osc.frequency.cancelScheduledValues(now);
    tone.osc.frequency.setValueAtTime(hz, now);
    click.filter.frequency.cancelScheduledValues(now);
    click.filter.frequency.setValueAtTime(hz * 3, now);
    pluck(tone.gain.gain, now, SCORE.knock.toneGain, 0.003, SCORE.knock.seconds);
    pluck(click.gain.gain, now, SCORE.knock.clickGain, 0.001, SCORE.knock.seconds * 0.4);
  }

  private playSuccess(graph: Graph, now: number): void {
    graph.success.chord.forEach((voice, index) => {
      pluck(
        voice.gain.gain,
        now + index * SCORE.success.strumSeconds,
        SCORE.success.gain,
        SCORE.success.attackSeconds,
        SCORE.success.decaySeconds,
      );
    });
    pluck(graph.success.pad.gain.gain, now, SCORE.success.padGain, 0.12, SCORE.success.padSeconds);
  }

  private playFail(graph: Graph, now: number): void {
    const { upper, lower } = graph.fail;
    upper.osc.frequency.cancelScheduledValues(now);
    upper.osc.frequency.setValueAtTime(SCORE.fail.upperHz, now);
    upper.osc.frequency.linearRampToValueAtTime(SCORE.fail.lowerHz, now + SCORE.fail.glideSeconds);
    pluck(upper.gain.gain, now, SCORE.fail.gain, SCORE.fail.attackSeconds, SCORE.fail.decaySeconds);
    pluck(lower.gain.gain, now + 0.06, SCORE.fail.gain * 0.8, SCORE.fail.attackSeconds, SCORE.fail.decaySeconds);
  }

  private playEnding(graph: Graph, now: number): void {
    // The drone itself resolves: the ambient root stays, and the third and
    // octave rise into it while a high arpeggio scatters over the top.
    const root = AMBIENT_ROOT_HZ[this.room];
    graph.ending.resolve.forEach((voice, index) => {
      const ratio = SCORE.ending.resolveRatios[index] ?? 1;
      voice.osc.frequency.cancelScheduledValues(now);
      voice.osc.frequency.setValueAtTime(root * ratio, now);
      pluck(
        voice.gain.gain,
        now,
        SCORE.ending.resolveGain,
        SCORE.ending.resolveAttackSeconds,
        SCORE.ending.resolveReleaseSeconds,
      );
    });
    graph.ending.stars.forEach((voice, index) => {
      pluck(
        voice.gain.gain,
        now + 0.6 + index * SCORE.ending.starGap,
        SCORE.ending.starGain,
        SCORE.ending.starAttackSeconds,
        SCORE.ending.starDecaySeconds,
      );
    });
  }

  private playUi(graph: Graph, now: number): void {
    pluck(graph.ui.gain.gain, now, SCORE.ui.gain, 0.001, SCORE.ui.seconds);
  }

  // -------------------------------------------------------------------------
  // Construction. Everything below runs exactly once.
  // -------------------------------------------------------------------------

  private build(context: AudioContext): Graph {
    const master = context.createGain();
    master.gain.value = 0;
    const compressor = context.createDynamicsCompressor();
    const { threshold, knee, ratio, attack, release } = SCORE.master.compressor;
    compressor.threshold.value = threshold;
    compressor.knee.value = knee;
    compressor.ratio.value = ratio;
    compressor.attack.value = attack;
    compressor.release.value = release;
    master.connect(compressor).connect(context.destination);

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

    // Ambient bed. Its gain stays open; only the master mutes it.
    const ambientGain = context.createGain();
    ambientGain.gain.value = 1;
    ambientGain.connect(master);
    const root = AMBIENT_ROOT_HZ[this.room];
    const ambientRoot = tone("sine", root, ambientGain);
    ambientRoot.gain.gain.value = SCORE.ambient.droneGain;
    const ambientDetuned = tone("sine", root, ambientGain);
    ambientDetuned.osc.detune.value = SCORE.ambient.detuneCents;
    ambientDetuned.gain.gain.value = SCORE.ambient.droneGain;
    const ambientFifth = tone("sine", root * SCORE.ambient.fifthRatio, ambientGain);
    ambientFifth.gain.gain.value = SCORE.ambient.fifthGain;
    const ambientNoise = noise(brown, "lowpass", SCORE.ambient.noiseFilterHz, 0.7, ambientGain);
    ambientNoise.gain.gain.value = SCORE.ambient.noiseGain;

    const winchOsc = context.createOscillator();
    winchOsc.type = "sawtooth";
    winchOsc.frequency.value = SCORE.winch.baseHz;
    const winchFilter = context.createBiquadFilter();
    winchFilter.type = "lowpass";
    winchFilter.frequency.value = SCORE.winch.filterHz;
    winchFilter.Q.value = SCORE.winch.filterQ;
    const winchGain = context.createGain();
    winchGain.gain.value = 0;
    winchOsc.connect(winchFilter).connect(winchGain).connect(master);
    winchOsc.start();
    // The creak is the filter moving, so the LFO runs forever whether or not
    // the winch is being held.
    const winchLfo = context.createOscillator();
    winchLfo.type = "sine";
    winchLfo.frequency.value = SCORE.winch.lfoHz;
    const winchLfoDepth = context.createGain();
    winchLfoDepth.gain.value = SCORE.winch.lfoDepthHz;
    winchLfo.connect(winchLfoDepth).connect(winchFilter.frequency);
    winchLfo.start();

    return {
      master,
      ambient: { root: ambientRoot.osc, detuned: ambientDetuned.osc, fifth: ambientFifth.osc, noise: ambientNoise, gain: ambientGain },
      recordStart: {
        sweep: tone("triangle", SCORE.recordStart.sweepFromHz),
        click: noise(white, "highpass", SCORE.recordStart.clickHz, 0.8),
      },
      fold: {
        down: tone("sine", SCORE.fold.centerHz),
        up: tone("sine", SCORE.fold.dipHz),
        sweep: noise(white, "bandpass", SCORE.fold.sweepFilterFromHz, SCORE.fold.sweepQ),
      },
      echo: SCORE.echo.partialsHz.map((hz) => tone("sine", hz)),
      winch: { osc: winchOsc, lfo: winchLfo, filter: winchFilter, gain: winchGain },
      push: noise(brown, "lowpass", SCORE.push.filterHz, SCORE.push.filterQ),
      gate: {
        thud: tone("sine", SCORE.gate.thudHz),
        body: noise(white, "bandpass", SCORE.gate.bodyFilterHz, SCORE.gate.bodyQ),
      },
      knock: {
        tone: tone("triangle", SCORE.knock.pickupHz),
        click: noise(white, "bandpass", SCORE.knock.pickupHz * 3, SCORE.knock.filterQ),
      },
      success: {
        chord: SCORE.success.chordHz.map((hz) => tone("sine", hz)),
        pad: tone("triangle", SCORE.success.padHz),
      },
      fail: { upper: tone("sine", SCORE.fail.upperHz), lower: tone("sine", SCORE.fail.lowerHz) },
      ending: {
        resolve: SCORE.ending.resolveRatios.map((ratio) => tone("sine", root * ratio)),
        stars: SCORE.ending.starsHz.map((hz) => tone("sine", hz)),
      },
      ui: tone("square", SCORE.ui.hz),
    };
  }
}
