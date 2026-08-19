import type { ChamberId } from "../core/types";

/**
 * Every sound in the game is synthesised from these numbers — there is not one
 * audio asset in the build. This module holds only data: frequencies, envelope
 * times and filter settings. `engine.ts` turns them into a node graph once, at
 * startup, and never allocates again.
 *
 * Levels are deliberately quiet. The game is played with a tutorial card being
 * read; audio is atmosphere and confirmation, never the loudest thing present.
 */

/** Ambient root per room, rising through the route so the four chambers read as one progression. */
export const AMBIENT_ROOT_HZ: Record<ChamberId, number> = {
  crossing: 73.416, // D2
  traceWeight: 77.782, // E♭2
  handoff: 87.307, // F2
  lastHold: 97.999, // G2
};

/** Just-intonation-ish ratios used to build chords off whatever root is sounding. */
const MAJOR_THIRD = 1.259921;
const FIFTH = 1.498307;
const OCTAVE = 2;

export const SCORE = {
  master: {
    /** Peak level of the whole mix. Conservative on purpose. */
    gain: 0.42,
    /** Seconds to fade the master in/out for mute and pause. */
    ramp: 0.09,
    /** The pause screen dims the mix and stops the machinery, but keeps the room breathing. */
    pauseDuck: 0.35,
    /** Seconds the very first fade-in takes, so the drone arrives rather than snaps on. */
    openSeconds: 2.4,
    compressor: { threshold: -18, knee: 12, ratio: 4, attack: 0.006, release: 0.2 },
  },

  ambient: {
    /** Two sines a few cents apart: the beating between them is the whole drone. */
    detuneCents: 7,
    droneGain: 0.06,
    /** A fifth above the root, quieter — keeps the drone from reading as a single tone. */
    fifthRatio: FIFTH,
    fifthGain: 0.022,
    /** Filtered noise bed, felt more than heard. */
    noiseGain: 0.014,
    noiseFilterHz: 210,
    /** Seconds for a room change to glide to its new root. */
    glideSeconds: 1.7,
  },

  /** Tape click plus a short rising glissando: the machine has started listening. */
  recordStart: {
    clickHz: 2600,
    clickGain: 0.055,
    clickDecay: 0.05,
    sweepFromHz: 196,
    sweepToHz: 622.25,
    sweepSeconds: 0.3,
    sweepGain: 0.05,
  },

  /**
   * The signature sound. Two sines mirror each other — one dives and climbs
   * back, the other climbs and dives — so the gesture reads as a fold rather
   * than a slide. A band-passed noise sweep rides the same curve.
   */
  fold: {
    centerHz: 392,
    dipHz: 104,
    seconds: 0.7,
    gain: 0.085,
    sweepFilterFromHz: 2400,
    sweepFilterToHz: 320,
    sweepQ: 3.5,
    sweepGain: 0.05,
  },

  /** Cyan shimmer with a slow attack: the past self condensing into the room. */
  echo: {
    partialsHz: [523.25, 783.99, 1046.5],
    gain: 0.026,
    attackSeconds: 0.55,
    releaseSeconds: 1.5,
  },

  /** Winch creak, gated by hold.active. A slow filter LFO does the groaning. */
  winch: {
    baseHz: 46,
    lfoHz: 4.6,
    lfoDepthHz: 260,
    filterHz: 430,
    filterQ: 5,
    gain: 0.05,
    rampSeconds: 0.22,
  },

  /** Stone friction, gated by force > 0. Brown noise under a low shelf. */
  push: {
    filterHz: 290,
    filterQ: 1.1,
    gain: 0.062,
    rampSeconds: 0.16,
  },

  /** Bridge and gate: a dull stone impact with a resonant tail. */
  gate: {
    thudHz: 62,
    thudDecay: 0.42,
    thudGain: 0.11,
    bodyFilterHz: 190,
    bodyQ: 6,
    bodyDecay: 0.5,
    bodyGain: 0.09,
  },

  /** Three wooden knocks for the carrier's three moments, told apart by pitch. */
  knock: {
    pickupHz: 349.23,
    stageHz: 466.16,
    deliverHz: 622.25,
    seconds: 0.17,
    toneGain: 0.055,
    clickGain: 0.035,
    filterQ: 4,
  },

  /** Amber major triad, arpeggiated over a warm low pad. */
  success: {
    chordHz: [261.63, 329.63, 392, 523.25],
    strumSeconds: 0.085,
    attackSeconds: 0.02,
    decaySeconds: 0.9,
    gain: 0.05,
    padHz: 130.81,
    padGain: 0.045,
    padSeconds: 1.4,
  },

  /** A soft descending minor second. It reports; it does not scold. */
  fail: {
    upperHz: 311.13,
    lowerHz: 293.66,
    glideSeconds: 0.5,
    attackSeconds: 0.08,
    decaySeconds: 0.9,
    gain: 0.042,
  },

  /**
   * Ending: the drone itself resolves into a major chord (the engine glides the
   * ambient root and adds the third and octave) under a high starlight
   * arpeggio.
   */
  ending: {
    seconds: 4,
    resolveRatios: [MAJOR_THIRD, OCTAVE],
    resolveGain: 0.038,
    resolveAttackSeconds: 1.3,
    resolveReleaseSeconds: 2.6,
    starsHz: [784, 1046.5, 1174.66, 1568, 2093],
    starGap: 0.34,
    starAttackSeconds: 0.012,
    starDecaySeconds: 1.1,
    starGain: 0.03,
  },

  /** Barely-there UI tick for settings buttons. */
  ui: {
    hz: 1760,
    seconds: 0.05,
    gain: 0.022,
  },
} as const;
