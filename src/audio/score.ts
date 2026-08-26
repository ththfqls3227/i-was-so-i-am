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

/** Ambient root per room, rising through the route so the chambers read as one progression. */
export const AMBIENT_ROOT_HZ: Record<ChamberId, number> = {
  awakening: 65.406, // C2
  secondSelf: 69.296, // C#2
  crossing: 73.416, // D2
  handNotBody: 73.416, // D2 — sector 1 opens on the prologue's last root
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
// ===========================================================================
// The first-person campaign.
//
// Everything above belongs to the retired top-down game and is left alone so
// it keeps compiling. Everything below is the archive.
// ===========================================================================

// ---------------------------------------------------------------------------
// The ten notes.
//
// The corridor walks the archive backwards: DIORAMAS is authored 09 first and
// 00 last, so the notes arrive from the top of the chord downwards and the
// lowest root — 00, the first room anyone plays — is the last thing to land.
// The chord grounds on the tape you made before you understood the game.
//
// Every room's ambient drone is its own note, two to three octaves down, so the
// corridor is the rooms remembered rather than a tune played at them.
//
// The scale is D minor pentatonic plus the 9th: D E G A C. F — the minor third,
// the note that would tell you the chord is sad — belongs to 08 alone, and 08's
// window is empty. You hear F for the whole of that room and never again. The
// corridor therefore ends on an open fifth stack with a hole where the colour
// should be, and the hole is a room you walked through.
// ---------------------------------------------------------------------------

export interface RoomNote {
  /** Chamber id, as authored in src/world. */
  chamberId: string;
  /** Where it sits in the corridor chord. */
  corridorHz: number;
  /** The room's own drone root: same pitch class, down in the drone band. */
  droneHz: number;
  /** 08 sounds in its own room and never joins the chord. */
  joinsChord: boolean;
}

/** In corridor pass order — the order the player meets the windows. */
export const ROOM_NOTES: readonly RoomNote[] = [
  { chamberId: "last-hold", corridorHz: 440.0, droneHz: 110.0, joinsChord: true }, // 09 · A
  { chamberId: "silence", corridorHz: 698.46, droneHz: 87.31, joinsChord: false }, // 08 · F — the hole
  { chamberId: "unkept", corridorHz: 523.25, droneHz: 130.81, joinsChord: true }, // 07 · C
  { chamberId: "giving-back", corridorHz: 659.26, droneHz: 82.41, joinsChord: true }, // 06 · E
  { chamberId: "long-standing", corridorHz: 392.0, droneHz: 98.0, joinsChord: true }, // 05 · G
  { chamberId: "two-of-us", corridorHz: 587.33, droneHz: 73.42, joinsChord: true }, // 04 · D
  { chamberId: "hand-not-body", corridorHz: 261.63, droneHz: 130.81, joinsChord: true }, // 03 · C
  { chamberId: "holding-hand", corridorHz: 220.0, droneHz: 110.0, joinsChord: true }, // 02 · A
  { chamberId: "second-self", corridorHz: 329.63, droneHz: 82.41, joinsChord: true }, // 01 · E
  { chamberId: "awakening", corridorHz: 146.83, droneHz: 73.42, joinsChord: true }, // 00 · D — grounds it
];

/**
 * 09 alone bends. The gate opening drops the room a semitone and leaves it
 * there; the corridor then sounds A again, so the walk out puts back the note
 * the room took. Nothing says this and nothing needs to.
 */
export const FINALE_DRONE_DROP_HZ = 103.83; // A2 -> G#2

export const FP_SCORE = {
  master: {
    gain: 0.42,
    ramp: 0.09,
    openSeconds: 2.4,
    pauseDuck: 0.35,
    /** The finale's held breath: full silence, not a duck. */
    silenceRamp: 0.08,
    compressor: { threshold: -18, knee: 12, ratio: 4, attack: 0.006, release: 0.2 },
  },

  /**
   * Two layers under every room. The timber layer is the building. The cyan
   * layer is the time technology, and it has been under all eight rooms before
   * 08 takes it away — absence only registers for something the ear had
   * stopped noticing.
   */
  ambient: {
    // Silenced, all of it, at the owner's word: "그거 소음 없애버리라고."
    //
    // The offender is the pair of sines seven cents apart. Two tones that close
    // beat against each other several times a second, and a beat that never
    // resolves is the sound a fluorescent tube makes — the ear cannot stop
    // tracking it and gets tired trying. It was written as "the building",
    // something felt rather than heard, and at the level it needed to be felt
    // it was the loudest continuous thing in the game.
    //
    // The voices are all still built and still take their automation, so this
    // is four numbers rather than a demolition: real music lands on this same
    // bus and can put any of them back if it wants them.
    detuneCents: 7,
    timberGain: 0,
    fifthRatio: 1.498307,
    fifthGain: 0,
    noiseGain: 0,
    noiseFilterHz: 190,
    /**
     * The cyan shimmer, kept but taken most of the way down. Three sine
     * partials above 1 kHz is the other thing in here capable of tiring an ear,
     * and it is only in the mix at all so 08 can take it away — which needs it
     * present, not prominent.
     */
    cyanPartials: [1174.66, 1567.98, 2093.0],
    cyanGain: 0.0035,
    cyanDriftHz: 0.07,
    glideSeconds: 1.7,
    /** 08 fades it out slowly enough that nobody catches the moment. */
    cyanFadeSeconds: 3.2,
  },

  /**
   * Footsteps. Distance-driven, off the stride the scene already accumulates,
   * so the feet never skate and never tick while standing still.
   */
  step: {
    // Roughly doubled. These were set while a drone bed was filling the room,
    // where a foot only had to peek over it; with the bed gone the building is
    // quiet and the player could walk the length of a hall hearing nothing of
    // themselves. You are a body in this place before you are a camera.
    brick: { noiseHz: 700, noiseQ: 2, noiseDecay: 0.045, noiseGain: 0.115, bodyHz: 90, bodyDecay: 0.07, bodyGain: 0.08 },
    /** Only the gallery decks are boarded, so this is 04 and the stairs. */
    timber: { noiseHz: 520, noiseQ: 1.4, noiseDecay: 0.06, noiseGain: 0.105, bodyHz: 320, ringHz: 480, bodyDecay: 0.09, bodyGain: 0.09 },
    /**
     * The echo's feet. Present — he is in the room and the room should say so —
     * but the body is gone from underneath them and they arrive a hair late.
     * This is the cyan hologram written for the ear.
     */
    echo: { highpassHz: 300, gainScale: 0.55, detuneCents: 8, preDelaySeconds: 0.012 },
    /** Below this speed the foot is placed, not landed. */
    minSpeed: 0.4,
  },

  /** ⏎ — the seal. A press, not a chime. */
  seal: {
    thudFromHz: 55,
    thudToHz: 40,
    thudSeconds: 0.09,
    thudGain: 0.12,
    bodyFilterHz: 400,
    bodyDecay: 0.16,
    bodyGain: 0.07,
    /** The inkpad, barely there. */
    brassHz: 1200,
    brassGain: 0.018,
    /** 09 presses it twice as slowly and half again as hard. */
    finaleTimeScale: 2,
    finaleGainScale: 1.6,
  },

  /** 장지문: paper and timber sliding, ending on a stop. */
  door: {
    sweepFromHz: 400,
    sweepToHz: 900,
    sweepQ: 1.2,
    sweepGain: 0.05,
    stopHz: 210,
    stopDecay: 0.12,
    stopGain: 0.045,
    /**
     * No chime, ever. An opening door is the drone sinking, because opening a
     * door and tying someone to a post are the same event and the score does
     * not get to separate them.
     */
    sinkRatio: 0.9438743, // one semitone down
    sinkSeconds: 1.2,
    sinkReturnSeconds: 2.4,
  },

  /** A plate taking weight, a hand closing on brass. Contact, not achievement. */
  contact: {
    plateHz: 660,
    plateAttack: 0.012,
    plateDecay: 0.2,
    plateGain: 0.022,
    holdHz: 480,
    holdDecay: 0.26,
    holdGain: 0.026,
  },

  /**
   * The sync beat. 04 has a gallery to look down from and an authored warmBand;
   * 05 is derived from state instead — the player inside the passage while he
   * stands on plate A. Once per room, never repeated.
   */
  attune: {
    thirdRatio: 1.259921,
    fifthRatio: 1.498307,
    gain: 0.026,
    attackSeconds: 0.6,
    releaseSeconds: 1.8,
  },

  /** The corridor stack. Each note arrives and stays. */
  corridor: {
    arriveSeconds: 1.1,
    gain: 0.032,
    /** The lowest root gets a little more room. */
    groundGainScale: 1.35,
    groundArriveSeconds: 1.8,
  },

  /** 09, after the threshold: brass complaining behind you for three seconds. */
  creak: {
    baseHz: 70,
    lfoHz: 3.1,
    lfoDepthHz: 180,
    filterHz: 360,
    filterQ: 6,
    gain: 0.04,
    decaySeconds: 3,
  },

  ui: { hz: 1760, seconds: 0.05, gain: 0.02 },
} as const;
