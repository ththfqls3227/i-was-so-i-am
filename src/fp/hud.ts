import type { ViewModel } from "./scene";
import { ROSTER } from "../world/roster";
import type { FailureCode } from "../sim/types";

export interface HudCallbacks {
  onStart: () => void;
  /** Pick the campaign back up at the saved chamber. Offered only when one exists. */
  onContinue: () => void;
  onRerecord: () => void;
  onAdvance: () => void;
  /** The archivist wrote a few more characters; the voice layer may tick. */
  onBlip: () => void;
}

interface Prompt {
  key: string | null;
  label: string;
  tone: "plain" | "go" | "echo";
}

/**
 * Copy lives here and nowhere else. The simulation reports structured codes; the
 * only place they turn into sentences is this file, so nothing ever branches on
 * a string a translator might change.
 */
/**
 * The same two failures, said without the cure attached.
 *
 * Only two of the codes ever carried advice — the rest are tape faults, which
 * have nothing to suggest. An uncoached room uses these: what happened, and
 * nothing about what to do instead.
 */
const PLAIN_FAILURE_COPY: Partial<Record<FailureCode, string>> = {
  "out-of-time": "시간이 다 되었습니다.",
  "door-closed": "문이 닫힌 채였습니다.",
};

const FAILURE_COPY: Record<FailureCode, string> = {
  "out-of-time": "시간이 지났습니다. 이번에는 조금 더 빨리 나가 보세요.",
  "door-closed": "문이 닫힌 채였습니다. 발판을 밟고 나가야 합니다.",
  "tape-missing": "기록이 비어 있습니다.",
  "tape-format-unknown": "기록 형식을 읽을 수 없습니다.",
  "tape-version-mismatch": "이전 버전의 기록입니다.",
  "tape-room-mismatch": "다른 방의 기록입니다.",
  "tape-tickrate-mismatch": "기록의 박자가 맞지 않습니다.",
  "tape-duration-mismatch": "기록의 길이가 맞지 않습니다.",
  "tape-too-long": "기록이 너무 깁니다.",
  "tape-checksum-mismatch": "기록이 손상됐습니다.",
  "tape-invalid": "기록을 읽을 수 없습니다.",
};

/**
 * What the advance button says on an ordinary room card.
 *
 * A constant because 04's handoff card borrows the button and has to give it
 * back: the panel is built once for the whole campaign, so the label lives in
 * two places — where it is set and where it is restored — and two copies of a
 * string that must match is one copy too many.
 */
const ONWARD_LABEL = "Space · 다음 방";

/**
 * 사서 — the archive's keeper, drawn in ink. Every line the facility says now
 * comes from her, visual-novel style: portrait low on the screen, a name on a
 * seal, and words that arrive at a hand's pace. No asset pipeline; she is a
 * few brush strokes of inline SVG.
 */
const ARCHIVIST_SVG = `
<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="60" cy="80" rx="46" ry="56" fill="#7fd8e820"/>
  <path d="M14 140 C22 96 42 88 60 88 C78 88 98 96 106 140 Z" fill="#1d2733"/>
  <path d="M42 96 L60 122 L78 96 L70 92 L60 106 L50 92 Z" fill="#e9e4d2"/>
  <path d="M38 94 L60 126 L82 94 L74 89 L60 112 L46 89 Z" fill="#2e3c4f"/>
  <rect x="53" y="76" width="14" height="16" rx="6" fill="#e6d8bd"/>
  <ellipse cx="60" cy="56" rx="24" ry="27" fill="#efe3c8"/>
  <path d="M36 52 C34 26 50 16 60 16 C70 16 86 26 84 52 C84 40 74 30 60 30 C46 30 36 40 36 52 Z" fill="#20232b"/>
  <circle cx="60" cy="15" r="7" fill="#20232b"/>
  <rect x="63" y="9" width="19" height="2.6" rx="1.3" fill="#b98b3e" transform="rotate(16 63 10)"/>
  <path d="M46 52 Q52 49 57 52" stroke="#3a3227" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <path d="M63 52 Q68 49 74 52" stroke="#3a3227" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <path d="M47 60 Q52 63 56 60" stroke="#2c261d" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M64 60 Q68 63 73 60" stroke="#2c261d" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M55 71 Q60 73.5 65 71" stroke="#8a5a4a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M36 42 C36 30 46 22 54 20" stroke="#8fe0ef" stroke-width="2.2" fill="none" opacity="0.65" stroke-linecap="round"/>
</svg>`;

/**
 * Characters per second the archivist speaks at. Korean syllables carry about
 * twice the information of Latin letters, so the visual-novel standard 40-60
 * halves; 26 reads as a hand writing rather than a printer printing.
 */
const SPEECH_CPS = 26;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * What a room is called on screen: five rooms of teaching, then five of being
 * asked. The corridor has no number and keeps the archive's own plate.
 *
 * Exported because the title card names a room too, on the continue button,
 * and it was reading 「이어하기 — 01 두 번째 나」 against an in-game header of
 * 「튜토리얼 2단계 · 두 번째 나」. One room, two numbers, because the split
 * moved here and the button was left behind. One place to say it now.
 */
export function chamberLabel(number: string, name: string): string {
  const stage = Number(number);
  if (!Number.isFinite(stage)) return `${number} ${name}`;
  if (stage <= 4) return `튜토리얼 ${stage + 1}단계 · ${name}`;
  return `퍼즐 ${stage - 4}단계 · ${name}`;
}

/**
 * Rooms counted the way a Korean speaker counts them: 「열 개의 방」, not
 * 「10개의 방」. The campaign is ten rooms long and will not grow, so a table
 * is enough; anything past it falls back to digits rather than to a wrong word.
 */
const ROOM_COUNT = ["한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
const ROOM_ORDER = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째", "일곱째", "여덟째", "아홉째", "열째"];

export class Hud {
  private readonly root = element("div", "hud");
  private readonly crosshair = element("div", "crosshair");
  private readonly pass = element("div", "pass");
  private readonly passLabel = element("b");
  private readonly tape = element("div", "tape");
  private readonly tapeFill = element("div", "tape-fill");
  private readonly tapeMark = element("div", "tape-mark");
  private readonly tapeLeft = element("span");
  private readonly tapeRight = element("span");
  private readonly prompts = element("div", "prompts");
  private readonly subtitle = element("div", "subtitle");
  /**
   * The archivist's line, laid out whole before a character of it shows: words
   * as spans so keep-all line breaks are decided once, characters as spans
   * inside them so the reveal is an opacity and never a reflow — typed text
   * that re-wraps mid-word is the loudest tell of a substring typewriter. The
   * full sentence is in the DOM from the first frame, so anything that reads
   * rather than watches gets it immediately.
   */
  private readonly vnLine = element("p", "vn-line");
  private charSpans: HTMLElement[] = [];
  private revealedCount = 0;
  private sayInstant = false;
  private sayStartedAt = 0;
  private readonly flash = element("div", "flash");
  /** The last door has been closed; the result panel is frozen on the ending. */
  private ended = false;

  /** 봉인 낙관 — the seal that comes down when a recording is closed. */
  private readonly seal = element("div", "seal");
  private readonly title = element("div", "overlay title");
  private readonly result = element("div", "overlay result");
  /** The fall to black after the seal, and the two words that come out of it. */
  private readonly blackout = element("div", "blackout");
  private readonly finale = element("div", "finale");
  private readonly finaleTitle = element("h1", undefined, "I WAS, SO I AM.");
  /** What the player leaves in the building, counted. Shown after the title. */
  private readonly finaleEpilogue = element("p", "finale-epilogue");
  private endingTimers: number[] = [];
  private readonly resultHeading = element("h2");
  private readonly resultBody = element("p");
  private readonly resultHint = element("p", "hint");
  private readonly again = element("button", undefined, "R · 다시 기록");
  private readonly onward = element("button", undefined, ONWARD_LABEL);
  /** Picks the campaign back up mid-roster. Only ever shown when a save exists. */
  private readonly continueButton = element("button");
  /**
   * Says the game is paused. Without it, a pause empties the whole interface —
   * a judge lost pointer lock, watched every gauge vanish, and reported the
   * HUD as broken rather than the game as waiting.
   */
  private readonly pauseNote = element("div", "pause-note", "일시 정지 · 클릭해서 계속");
  /** The frame around the observer viewport, with its label and rec dot. */
  private readonly observerFrame = element("div", "observer-frame");
  /**
   * Frame rate, for whoever is working on the thing.
   *
   * Gated on the same condition as the test API rather than left on: it was
   * shipping. A production build served the game with "121 fps" in the corner,
   * which on a judge's screen is a debug overlay sitting on top of the art —
   * and it survived all the way onto the last card of the ending before
   * showEnding started hiding it by hand.
   */
  private readonly showDiagnostic = import.meta.env.DEV || import.meta.env.VITE_E2E === "true";
  private readonly diagnostic = element("div", "diagnostic");
  /**
   * 무음 — shown only while the archive is silenced, and nothing at all
   * otherwise. A speaker icon that is always there, crossed out or not, is a
   * control panel; this is a mark that appears when something is off.
   */
  private readonly mutedMark = element("div", "muted-mark", "무음");
  /** R, kept in the corner for the length of a replay — the moment a player
   * sees the tape go wrong is the moment they look for the take-back. And H
   * beside it, because the moment a player wants the take-back is also the
   * moment they would take an answer if one were offered. */
  private readonly retryHint = element("div", "retry-hint");
  private readonly notice = element("p", "notice");

  /**
   * Where this room sits in the ten, while Tab is held.
   *
   * Nothing here pauses and nothing here dims the room: the tape keeps running
   * under it, and an overlay that darkened a live recording would be asking the
   * player to pay for looking.
   */
  private readonly stage = element("div", "stage");
  private readonly stageNow = element("p", "stage-now");
  private readonly stageCount = element("p", "stage-count");
  private readonly stageMarks: HTMLElement[] = [];
  /**
   * The numbered stages, in play order. The corridor is on the roster and is
   * not one of these — it carries 「—」 for a number and is the walk out rather
   * than a room to solve, so it is the one entry with no slip on the rail.
   */
  private readonly stageOrder = ROSTER.all.filter((chamber) => Number.isFinite(Number(chamber.number)));
  private stageShown = false;

  /** What this room will say when asked outright, and how much has been asked for. */
  private readonly hintNote = element("div", "hint-note");
  private currentHints: readonly { after: number; line: string }[] = [];
  /** Tries spent in this room, as the simulation counts them. See hintFor. */
  private currentAttempts = 0;
  private revealedHints = 0;
  private hintNoticeLine = "";
  private hintChamber = "";
  private hintSignature = "";

  private promptSignature = "";
  private subtitleText = "";
  private subtitleUntil = 0;
  private lastEntryLine: string | null = null;
  private started = false;

  constructor(parent: HTMLElement, private readonly callbacks: HudCallbacks) {
    for (let index = 0; index < 4; index += 1) this.crosshair.append(element("span"));

    const portrait = element("div", "vn-portrait");
    portrait.innerHTML = ARCHIVIST_SVG;
    const panel = element("div", "vn-panel");
    panel.append(element("span", "vn-name", "사서"), this.vnLine);
    this.subtitle.append(portrait, panel);

    this.pass.append(element("i"), this.passLabel);

    const track = element("div", "tape-track");
    track.append(this.tapeFill, this.tapeMark);
    const label = element("div", "tape-label");
    label.append(this.tapeLeft, this.tapeRight);
    this.tape.append(track, label);

    this.title.append(
      element("p", "kicker", "기억 보관소 · 00"),
      element("h1", undefined, "I WAS, SO I AM"),
      // The English title is a clause with its other half missing, and the
      // ending supplies it: 과거의 내가 있었기에, 지금의 내가 있습니다. Putting
      // the first half under the title makes the last line of the game a
      // sentence the player has already been holding since the first screen.
      element("p", "title-sub", "과거의 내가 있었기에"),
      element(
        "p",
        undefined,
        "이 방에서 한 일이 기록됩니다. 기록을 끝내면, 조금 전의 당신이 같은 길을 다시 걷습니다.",
      ),
    );
    const startButton = element("button", undefined, "클릭해서 시작");
    startButton.id = "start-button";
    startButton.addEventListener("click", () => {
      startButton.blur();
      this.callbacks.onStart();
    });
    this.continueButton.id = "continue-button";
    this.continueButton.hidden = true;
    this.continueButton.addEventListener("click", () => {
      this.continueButton.blur();
      this.callbacks.onContinue();
    });
    // The owner's key art, under the buttons: the title screen and the store
    // card make the same promise. Served from public/, so the world itself
    // stays procedural. Its own layer, because a still that large reads as a
    // frozen screenshot — the CSS gives it a slow drift.
    const titleArt = element("div", "title-art");
    titleArt.style.backgroundImage = "url('./assets/title-art.jpg')";
    this.title.append(titleArt, element("div", "title-scrim"));
    this.title.append(
      startButton,
      this.continueButton,
      // Three lines, not two: Tab and H are affordances nobody will find by
      // guessing, and a key that exists and is never named is a key that does
      // not exist. Held Tab says where you are; H hands over the room's next
      // hint without making you fail for it first.
      element("p", "hint", "W A S D 이동 · 마우스 시점 · Space 점프 · E 잡기\n⏎ 기록 끝내기 · R 다시 기록 · N 방 건너뛰기\nTab 지금 위치 · H 안내 · Esc 멈춤 · M 음소거"),
      this.buildColourLegend(),
    );
    // The same legend waits behind Esc, because the place a player wonders
    // about a colour is the middle of a room, not the title they clicked past.
    this.pauseNote.append(this.buildColourLegend());

    this.result.append(this.resultHeading, this.resultBody);
    // Buttons let go of focus once pressed. A clicked button keeps keyboard
    // focus, and the next Space — a jump, to the player — pressed it again:
    // a judge was advanced out of a success card they were still reading, into
    // a room whose first recorded frames were the jump that sent them there.
    this.again.id = "rerecord-button";
    this.again.addEventListener("click", () => {
      this.again.blur();
      this.callbacks.onRerecord();
    });
    this.onward.id = "advance-button";
    this.onward.addEventListener("click", () => {
      this.onward.blur();
      this.callbacks.onAdvance();
    });
    this.result.append(this.onward, this.again, this.resultHint);
    this.result.hidden = true;
    this.finale.append(this.finaleTitle, this.finaleEpilogue);
    this.blackout.hidden = true;
    this.finale.hidden = true;

    this.notice.textContent = "마우스 왼쪽 버튼을 누른 채 움직여 시점을 돌리세요";
    this.notice.hidden = true;
    this.mutedMark.hidden = true;
    // Two keys, one under the other, in the corner the replay already owns.
    this.retryHint.append(
      element("span", undefined, "R · 다시 기록"),
      element("span", undefined, "H · 안내"),
    );
    this.retryHint.hidden = true;
    this.hintNote.hidden = true;

    {
      // One slip per numbered stage, laid out the way the archive files them.
      // The gap after the fifth is the seam chamberLabel names: five rooms of
      // being taught, then five of being asked.
      const rail = element("div", "stage-rail");
      for (const chamber of this.stageOrder) {
        const mark = element("span", "stage-mark");
        if (Number(chamber.number) === 5) mark.dataset.seam = "true";
        this.stageMarks.push(mark);
        rail.append(mark);
      }
      this.stage.append(element("p", "kicker", "기억 보관소"), this.stageNow, rail, this.stageCount);
    }

    this.pauseNote.hidden = true;
    {
      const observerLabel = element("span", "observer-label", "잔상 관측");
      observerLabel.prepend(element("span", "observer-dot"));
      this.observerFrame.append(observerLabel);
    }
    this.root.append(
      this.crosshair,
      this.pass,
      this.tape,
      this.subtitle,
      this.notice,
      this.pauseNote,
      this.observerFrame,
      this.prompts,
      this.flash,
      this.seal,
      this.blackout,
      this.finale,
      ...(this.showDiagnostic ? [this.diagnostic] : []),
      this.mutedMark,
      this.retryHint,
      this.hintNote,
      this.stage,
      this.title,
      this.result,
    );
    parent.append(this.root);
  }

  /**
   * Let go of whatever the facility was saying. A line said at the end of one
   * attempt has no business captioning the start of the next — "the record is
   * full and sealed" was still on screen while a fresh, empty tape waited.
   */
  clearTransient(): void {
    this.subtitleText = "";
    this.subtitleUntil = 0;
    this.charSpans = [];
    this.revealedCount = 0;
    this.vnLine.replaceChildren();
  }

  /** A saved chamber exists; put the way back on the title card. */
  offerContinue(label: string): void {
    this.continueButton.textContent = label;
    this.continueButton.hidden = false;
  }

  /** The archive has been silenced, or has not. */
  setMuted(muted: boolean): void {
    if (this.mutedMark.hidden !== muted) return;
    this.mutedMark.hidden = !muted;
  }

  /**
   * Held Tab: which of the ten this is, and how many are left.
   *
   * Not a menu and not a pause. The tape is still running while this is up, so
   * it takes no key to dismiss, offers nothing to press, and dims none of the
   * room it is standing over — a player checking their place should not have to
   * spend a recording on the answer.
   */
  showStageMap(chamberId: string): void {
    if (!this.started || this.ended) return;
    const chamber = ROSTER.byIdOrNull(chamberId);
    if (!chamber) return;
    // -1 in the corridor, which is on the roster and is not a stage.
    const index = this.stageOrder.findIndex((entry) => entry.sim.id === chamberId);
    this.stageNow.textContent = chamberLabel(chamber.number, chamber.sim.name);
    for (const [slot, mark] of this.stageMarks.entries()) {
      mark.dataset.state = slot === index ? "here" : index < 0 || slot < index ? "done" : "todo";
    }
    this.stageCount.textContent = this.stageCountLine(index);
    this.stageShown = true;
    this.stage.dataset.on = "true";
  }

  /** The key came up, or the window went away with it still down. */
  hideStageMap(): void {
    if (!this.stageShown) return;
    this.stageShown = false;
    this.stage.dataset.on = "false";
  }

  /**
   * H: the next rung of this room's ladder, now, instead of after the failing.
   *
   * The failure cards keep the ladder they already had — this is a way past the
   * waiting, not a replacement for it. What it hands over stays on screen until
   * the room changes, because a hint you have to hold a key to re-read is a hint
   * you will read once and misremember.
   */
  revealHint(): void {
    if (!this.started || this.ended) return;
    if (this.currentHints.length === 0) {
      // Most rooms have no approved line for this. Saying nothing would read as
      // the key being broken rather than the drawer being empty.
      this.hintNoticeLine = "이 방에 준비된 안내가 없습니다.";
      return;
    }
    // Spent tries have their own claim on this ladder, and a rung the failure
    // cards already handed over is not unrevealed. Counting only the asked-for
    // ones made the first H in a room somebody had failed twice hand back a
    // line they were looking at, which reads as the key doing nothing.
    let earned = 0;
    this.currentHints.forEach((hint, index) => {
      if (this.currentAttempts >= hint.after) earned = index + 1;
    });
    const held = Math.max(this.revealedHints, earned);
    if (held >= this.currentHints.length) {
      this.hintNoticeLine = "안내는 여기까지입니다.";
      return;
    }
    this.revealedHints = held + 1;
    this.hintNoticeLine = "";
  }

  /**
   * How far in, and how much is left, in words.
   *
   * The rail above says the same thing at a glance; this says it exactly,
   * because a row of ten marks is a shape and a player deciding whether to stop
   * for the night wants a number.
   */
  private stageCountLine(index: number): string {
    const total = this.stageOrder.length;
    // A numeral and its counter are one word. The space between them is a
    // no-break space so no width can split 「네 개입니다」 down the middle.
    const rooms = (count: number): string => `${ROOM_COUNT[count - 1] ?? String(count)}\u00a0개`;
    const whole = rooms(total);
    if (index < 0) return `${whole}의 방을 모두 지났습니다.`;
    if (index === total - 1) return `${whole}의 방 가운데 마지막입니다.`;
    const here = ROOM_ORDER[index] ?? `${index + 1}번째`;
    return `${whole}의 방 가운데 ${here}, 남은 방은 ${rooms(total - index - 1)}입니다.`;
  }

  /**
   * The lines this room has handed over on request, stacked where the pass badge
   * already answers "where am I".
   *
   * Only while a room is actually being played: on a success or failure card the
   * panel is carrying its own copy of the ladder, and the same sentence in two
   * places at once reads as the interface stuttering.
   */
  private renderHintNote(view: ViewModel, playing: boolean): void {
    const given = this.currentHints.slice(0, this.revealedHints);
    const inRoom = view.phase === "recording" || view.phase === "replay";
    const shown = playing && !this.ended && inRoom && (given.length > 0 || this.hintNoticeLine !== "");
    const signature = shown ? `${given.map((hint) => hint.line).join("//")}##${this.hintNoticeLine}` : "";
    if (signature === this.hintSignature) return;
    this.hintSignature = signature;
    if (this.hintNote.hidden !== !shown) this.hintNote.hidden = !shown;
    if (!shown) {
      this.hintNote.replaceChildren();
      return;
    }
    const lines = given.map((hint) => element("p", undefined, hint.line));
    if (this.hintNoticeLine !== "") lines.push(element("p", "hint-note-end", this.hintNoticeLine));
    this.hintNote.replaceChildren(...lines);
  }

  /** Called once per rendered frame; everything below diffs before it touches the DOM. */
  update(view: ViewModel, now: number): void {
    const playing = view.started && !view.paused;
    this.started = view.started;
    this.currentHints = view.hints;
    this.currentAttempts = view.attempts;
    // A new room is a new ladder. What 03 was willing to say has nothing to do
    // with what 05 is, and a hint carried across a doorway is worse than none.
    // Numbers are unique across the roster, so this is an exact test.
    if (this.hintChamber !== view.chamberNumber) {
      this.hintChamber = view.chamberNumber;
      this.revealedHints = 0;
      this.hintNoticeLine = "";
    }
    this.title.hidden = view.started;
    // While the stage plate is up the crosshair sits in the middle of it. The
    // player is reading, not aiming, and it comes straight back on release.
    this.crosshair.hidden = !playing || this.stageShown;
    const pausedShown = view.started && view.paused && !this.ended && !this.stageShown;
    if (this.pauseNote.hidden !== !pausedShown) this.pauseNote.hidden = !pausedShown;
    // Only while a replay runs. During recording R is a no-op by design, and
    // the failure and success cards carry their own R — the corner would lie
    // in the one case and stutter in the others.
    const retryShown = playing && !this.ended && view.phase === "replay" && view.recordingEnabled;
    if (this.retryHint.hidden !== !retryShown) this.retryHint.hidden = !retryShown;
    // A room that takes no recording has no tape to show and no pass to be on.
    // Hiding these is the honesty rule again: a gauge that cannot move and a
    // badge that cannot change are two more things that would be lying.
    this.tape.hidden = !playing || !view.recordingEnabled;
    this.pass.hidden = !playing || !view.recordingEnabled;
    this.prompts.hidden = !playing;

    this.crosshair.dataset.focus = String(view.focus !== null);
    // The crosshair goes first, before everything stops. A freeze with no warning
    // reads as the game hanging; a freeze the interface stepped out of first
    // reads as the room taking a moment.
    if (this.crosshair.dataset.sealing !== String(view.sealing)) {
      this.crosshair.dataset.sealing = String(view.sealing);
    }
    // The seal colour is the room's, and the HUD carries it as a custom property
    // so anything that stamps one picks it up without being told which room it
    // is in. Red for every chamber that seals a record; cyan for the one that
    // seals someone.
    if (this.root.dataset.seal !== view.sealColour) {
      this.root.dataset.seal = view.sealColour;
      this.root.style.setProperty("--seal", view.sealColour === "cyan" ? "var(--cyan)" : "var(--seal-red)");
    }
    // Only say this when it is true. If the browser gave us pointer lock, the
    // player never needs to know there was another way.
    //
    // And only until it has been done once. This line sits in the middle of the
    // screen, 42 px under the crosshair, and it was staying there for the whole
    // game — an instruction that outlives being followed is not help, it is a
    // caption on the art. Once a drag has turned the view a quarter turn the
    // player has plainly worked it out, and it fades.
    //
    // Nothing left to aim at once the last door is closed.
    // Not while the archivist is speaking: the notice's 16% anchor lands
    // inside her panel, and at arrival — the one moment a lock-denied player
    // most needs the drag lesson — the two texts typed over each other and
    // neither could be read. The line waits its turn instead.
    const showNotice = playing && view.pointerLockDenied && !view.dragLookLearned && !this.ended
      && this.subtitle.dataset.shown !== "true";
    // Never taken out of the layout again once it has appeared: hidden cuts a
    // fade off mid-way, and an element at zero opacity with no pointer events
    // is not in anybody's way.
    if (showNotice) this.notice.hidden = false;
    if (this.notice.dataset.shown !== String(showNotice)) {
      this.notice.dataset.shown = String(showNotice);
    }

    const pass = view.phase === "recording" ? "1회차 · 기록" : view.phase === "replay" ? "2회차 · 재생" : view.phase === "success" ? "보관 완료" : "다시 기록";
    const phaseName = `${chamberLabel(view.chamberNumber, view.chamberName)} · ${pass}`;
    if (this.passLabel.textContent !== phaseName) this.passLabel.textContent = phaseName;
    if (this.observerFrame.dataset.on !== String(view.observerOn)) {
      this.observerFrame.dataset.on = String(view.observerOn);
    }
    if (this.pass.dataset.phase !== view.phase) this.pass.dataset.phase = view.phase;
    if (this.tape.dataset.phase !== view.phase) this.tape.dataset.phase = view.phase;

    const span = view.phase === "recording" ? view.tapeDuration : view.replaySpan;
    const progress = Math.max(0, Math.min(1, view.tapeTick / span));
    this.tapeFill.style.width = `${(progress * 100).toFixed(2)}%`;
    // The mark is where the tape runs out and the grace begins, which only
    // means anything during a replay. While recording it sat pinned at the end
    // of the bar saying nothing, and a tick at three quarters with no reading
    // is what made people think the replay lasts as long as the recording.
    const replaying = view.phase !== "recording";
    this.tapeMark.hidden = !replaying;
    if (replaying) {
      this.tapeMark.style.left = `${((view.tapeDuration / view.replaySpan) * 100).toFixed(2)}%`;
    }
    const remaining = Math.max(0, (span - view.tapeTick) / 30);
    // The number has always been what is left, and the label never said so —
    // so a player who got faster saw it read higher each attempt and took it
    // for the game quietly giving them more. These are the words the copy
    // settled on: docs/voice-and-story.md.
    // While the tape is parked the gauge is not counting anything down, and a
    // full bar labelled "time left" that never moves reads as a stuck timer —
    // a judge decided the clock ran at two speeds rather than not at all.
    const leftLabel = view.phase === "recording"
      ? (view.tapeArmed ? "남은 기록 시간" : "기록 대기 · 움직이면 시작됩니다")
      : "잔상 시간";
    if (this.tapeLeft.textContent !== leftLabel) this.tapeLeft.textContent = leftLabel;
    const rightLabel = `${remaining.toFixed(1)}s`;
    if (this.tapeRight.textContent !== rightLabel) this.tapeRight.textContent = rightLabel;

    // Nothing to point at once the corridor has started closing: a wayfinding
    // hint under the last thing the game says is the game talking over itself.
    this.renderPrompts(view.closing ? [] : this.promptsFor(view));
    this.renderSubtitle(view, now);
    this.renderHintNote(view, playing);
    this.renderResult(view);

    if (this.showDiagnostic) {
      const diagnostic = `${Math.round(view.fps)} fps`;
      if (this.diagnostic.textContent !== diagnostic) this.diagnostic.textContent = diagnostic;
    }
  }

  /**
   * The actor colour legend. Three dots, three owners — the rooms teach cyan
   * and amber by name (01 and 03) but violet is only ever met, so the one
   * place the whole rule is written out is here, before the first room and
   * behind every pause.
   */
  private buildColourLegend(): HTMLElement {
    const legend = element("p", "legend");
    const entries: readonly [string, string][] = [
      ["#3dc7f2", "푸른색 · 잔상 전용"],
      ["#ff9e3d", "오렌지 · 사람 전용"],
      ["#9e6bfa", "보라색 · 둘 다 사용 가능"],
    ];
    for (const [colour, label] of entries) {
      const item = element("span", "legend-item");
      const dot = element("span", "legend-dot");
      dot.style.background = colour;
      dot.style.boxShadow = `0 0 7px ${colour}`;
      item.append(dot, document.createTextNode(label));
      legend.append(item);
    }
    return legend;
  }

  /**
   * Only ever offer a key that will do something. A prompt for ⏎ before the tape
   * is long enough to fold is the exact kind of lie that made the old tutorial
   * unplayable.
   */
  private promptsFor(view: ViewModel): Prompt[] {
    if (!view.recordingEnabled) {
      // No fold, no rerecord — neither key does anything here, so neither is
      // offered. But 08 taught this branch humility: a no-recording room can
      // still have a shut door and a plate with the player's name on it, and
      // "walk into the light" at a sealed doorway coached a player to leave a
      // room they had not solved. Only the corridor is walked and nothing else.
      if (view.phase === "success") return [];
      if (!view.wayAheadOpen) {
        if (view.hasPlate && view.plateActive) return [{ key: null, label: "발판이 눌렸습니다. 곧 문이 열립니다", tone: "go" }];
        // The confirmation above stays either way — it is feedback, not an
        // answer. This one is the answer, so an uncoached room keeps it.
        if (view.hasPlate) return view.coached ? [{ key: null, label: "빈 발판에 올라서세요", tone: "plain" }] : [];
        return [{ key: null, label: "문이 열리기를 기다리세요", tone: "plain" }];
      }
      return [{ key: null, label: "빛으로 나가세요", tone: "echo" }];
    }
    if (view.phase === "recording") {
      const prompts: Prompt[] = [];
      // A grip under the crosshair is the one moment the player needs the key
      // named — and how to use it. A judge tapped E, got nothing, and lost two
      // loops before discovering it has to be held. Only a grip: plates take
      // focus too, and the same prompt over a plate sent two judges hunting
      // for something to hold in rooms that have nothing to grab.
      if (view.focusIsHold && !view.holding) {
        prompts.push({ key: "E", label: "길게 눌러 잡기", tone: "go" });
      }
      // A puzzle room keeps the control affordances and drops the answers. What
      // belongs on this tape is the question it is asking; every line below
      // this point answers it. The hint ladder still gives the method away
      // once someone has spent real tries earning it.
      if (!view.coached) {
        if (view.canFold) {
          prompts.push({
            key: "⏎",
            label: view.holding ? "잡은 채로 기록 끝내기" : "기록 끝내기",
            tone: view.holding ? "go" : "plain",
          });
        }
        return prompts;
      }
      if (view.recordingCueLine) {
        // A scripted room speaks for itself. The generic plate coaching below
        // assumes one plate and a pass that presses it — 05 has neither.
        prompts.push({ key: null, label: view.recordingCueLine, tone: "plain" });
        if (view.canFold) prompts.push({ key: "⏎", label: "기록 끝내기", tone: "plain" });
        return prompts;
      }
      if (view.hasPlate && view.plateDutyInReplay) {
        // 03: the plate is the second pass's job. "Walk to the plate" here
        // steered a judge onto it with the recording running — the one move
        // the room is built to refuse. Say whose turn it is, and what THIS
        // pass is for: "record your steps" told a judge nothing about which
        // steps, and cost five tries.
        // 호박색, not 오른쪽: the colour is the actor language and it travels
        // with the plate, where a direction word was only true from spawn.
        prompts.push({ key: null, label: "오렌지 발판은 2회차에 밟습니다. 지금은 닫힌 문 쪽으로 걸어 두세요. 문 앞까지 갔으면 ⏎로 끝내세요", tone: "plain" });
        if (view.canFold) prompts.push({ key: "⏎", label: "기록 끝내기", tone: "plain" });
      } else if (view.hasPlate) {
        // "Stand still on it", not "walk to it": two judges walked straight
        // across the disc, saw nothing latch, and concluded the plate was
        // broken — crossing presses it for half a second, which is less than
        // the door asks for. And near the plate the line carries a direction:
        // "not on it yet" is a fact with no way-to-turn in it, and three
        // rounds of drifting judges looped on it with the plate at their elbow.
        const approach =
          view.plateBearing === "behind"
            ? "발판을 지나쳤습니다. 한 걸음 뒤로"
            : view.plateBearing === "left"
              ? "발판이 왼쪽에 있습니다"
              : view.plateBearing === "right"
                ? "발판이 오른쪽에 있습니다"
                : "앞의 발판 위에 멈춰 서세요";
        if (!view.plateActive && !view.canFold) {
          prompts.push({ key: null, label: approach, tone: "plain" });
        }
        if (view.plateActive && view.canFold) {
          // Said outright, and kept saying: the negative line's absence was
          // the only "yes" the interface ever gave, and two judges spent
          // whole tapes unable to tell a press that took from one that missed.
          prompts.push({ key: null, label: "발판 위입니다", tone: "go" });
          prompts.push({ key: "⏎", label: "기록 끝내기", tone: "go" });
        } else if (view.plateActive) {
          prompts.push({ key: null, label: "발판 위입니다. 잠시 그대로 계세요", tone: "go" });
        } else if (view.canFold) {
          // Say where the player is NOT. From first person the disc fills the
          // bottom of the frame while you are still short of it — a judge read
          // the old advisory line as "standing on it", folded, and watched the
          // echo freeze at the rim.
          prompts.push({
            key: null,
            label: view.plateBearing && view.plateBearing !== "ahead" ? approach : "아직 발판 위가 아닙니다",
            tone: "plain",
          });
          prompts.push({ key: "⏎", label: "기록 끝내기", tone: "plain" });
        }
      } else if (view.canFold) {
        // No plates here — the room is about what the hands are doing, and a
        // line about plates would send the player hunting for one.
        prompts.push({ key: "⏎", label: view.holding ? "잡은 채로 기록 끝내기" : "기록 끝내기", tone: view.holding ? "go" : "plain" });
      }
      return prompts;
    }
    if (view.phase === "replay") {
      // Same bargain on the second pass. The way out, once it is open, is not
      // an answer — it is the room telling you that you already found one.
      if (!view.coached) {
        if (view.echoFinishes || !view.wayAheadOpen) return [];
        return [{ key: null, label: "빛으로 나가세요", tone: "echo" }];
      }
      // "step on it yourself" is a lie in a room whose plate only answers the
      // echo — a judge stood on 01's plate, read that line, and concluded the
      // game was broken when nothing happened.
      // In the role-reversal room the generic line's first half ("wait for
      // the door") is exactly wrong — waiting is the move that fails. Its
      // plate room gets the imperative alone.
      const waiting = view.replayWaitLine ?? (!view.hasPlate
        ? "문이 열리기를 기다리세요"
        : view.plateDutyInReplay
          ? (view.plateBearing === "left"
            ? "발판이 왼쪽에 있습니다. 직접 밟으세요"
            : view.plateBearing === "right"
              ? "발판이 오른쪽에 있습니다. 직접 밟으세요"
              : view.plateBearing === "behind"
                ? "발판을 지나쳤습니다. 뒤로 돌아 밟으세요"
                : "오렌지 발판을 직접 밟으세요. 당신의 발이 문을 엽니다")
          : view.plateForEchoOnly
            ? "이 발판은 잔상 전용입니다. 문이 열릴 때까지 기다리세요"
            : "문이 열리기를 기다리거나, 직접 발판을 밟으세요");
      // In 03 the first door opens while the way out is still shut: the player
      // is holding it open with their foot. "Walk into the light" at that
      // moment sends them off the plate and shuts the door on the echo.
      // The latch, confirmed the instant it happens. The door takes most of a
      // second to answer a pressed plate, and in that gap a judge in a dark
      // corner had only "keep waiting" copy to go on — no way to tell a press
      // that took from a press that missed.
      // Not in a room whose plate ignores the living foot — there the same
      // words would be the exact lie the echo-only copy exists to prevent.
      if (view.plateActive && !view.doorOpen && !view.plateForEchoOnly) {
        return [{ key: null, label: "발판이 눌렸습니다. 곧 문이 열립니다", tone: "go" }];
      }
      if (view.doorOpen && !view.exitOpen && view.plateActive) {
        // Say why the standing matters, or it reads as a goal in itself — a
        // judge who was not on the plate obeyed this line for a whole cycle,
        // standing in the middle of the room waiting for permission to move.
        return [{
          key: null,
          label: view.echoFinishes
            ? "그대로 밟고 계세요. 잔상이 저 빛에 닿으면 이 방은 끝납니다"
            : "그대로 밟고 계세요. 잔상이 문을 지나면 출구가 열립니다",
          tone: "echo",
        }];
      }
      // Where his light ends the room there is no walk to coach — once the way
      // is open for him, the only instruction left is to watch him take it.
      // Before that, the duty coaching below this block still applies.
      if (view.echoFinishes && view.doorOpen) {
        return [{ key: null, label: "잔상이 빛에 닿으면 이 방은 끝납니다. 그대로 지켜보세요", tone: "echo" }];
      }
      // "Walk into the light" cost one judge six tries and another ten,
      // because the brightest thing on screen was the wrong door both times —
      // the line now says which way. And in a grip room the way out is open
      // exactly as long as the echo's hand holds, so that clause stays.
      const dir = view.exitBearing === "ahead" ? "앞" : view.exitBearing === "left" ? "왼쪽" : view.exitBearing === "right" ? "오른쪽" : "뒤";
      const out = view.hasPlate
        ? `출구는 ${dir}입니다. 빛으로 나가세요`
        : `잔상이 잡아 주고 있습니다. ${dir}의 출구로 나가세요`;
      // Where the exit has its own gate, the doors stop mattering the moment
      // it opens: in 03 leaving the plate shuts the first door behind the
      // echo, and requiring it open again sent the coaching back to "step on
      // the plate" while the way out stood waiting.
      // Every door, not the first: in 05 the way-in opened and this line sent
      // the player at a way-on still shut.
      const canLeave = view.exitGated ? view.exitOpen : view.wayAheadOpen && view.exitOpen;
      return [{ key: null, label: canLeave ? out : waiting, tone: "echo" }];
    }
    if (view.phase === "rerecord") {
      return [{ key: "R", label: "다시 기록", tone: "go" }];
    }
    return [];
  }

  private renderPrompts(prompts: Prompt[]): void {
    const signature = prompts.map((prompt) => `${prompt.key ?? ""}|${prompt.label}|${prompt.tone}`).join("//");
    if (signature === this.promptSignature) return;
    this.promptSignature = signature;
    this.prompts.replaceChildren();
    for (const prompt of prompts) {
      const node = element("span", "key");
      node.dataset.tone = prompt.tone;
      if (prompt.key) node.append(element("kbd", undefined, prompt.key));
      node.append(document.createTextNode(prompt.label));
      this.prompts.append(node);
    }
  }

  /** Facility voice: says what just happened, once, then gets out of the way. */
  private renderSubtitle(view: ViewModel, now: number): void {
    // The facility speaks once, on the way in. Arriving in a new chamber is the
    // only thing that earns a line; a rerecord is the player's business.
    //
    // Nothing is consumed before the player has started, or the very first
    // chamber's line is swallowed by the title screen and never said.
    if (view.started && view.entryLine !== this.lastEntryLine) {
      this.lastEntryLine = view.entryLine;
      this.say(view.entryLine, now, 6400);
      return;
    }
    const shown = this.subtitleText !== "" && now < this.subtitleUntil && !view.paused;
    if (this.subtitle.dataset.shown !== String(shown)) this.subtitle.dataset.shown = String(shown);
    if (shown) {
      const revealed = this.sayInstant
        ? this.charSpans.length
        : Math.min(
          this.charSpans.length,
          Math.max(1, Math.floor(((now - this.sayStartedAt) / 1000) * SPEECH_CPS)),
        );
      if (revealed > this.revealedCount) {
        for (let index = this.revealedCount; index < revealed; index += 1) {
          this.charSpans[index]?.classList.add("on");
        }
        // A tick of the brush every few characters — not one per character,
        // which at this pace would be noise rather than a voice.
        if (!this.sayInstant && Math.floor(revealed / 3) > Math.floor(this.revealedCount / 3)) {
          this.callbacks.onBlip();
        }
        this.revealedCount = revealed;
      }
    }
  }

  /**
   * A line from the archivist. Typed by default; `instant` lands the whole
   * sentence in one frame — the ending speaks that way, because a typewriter
   * at a deathbed reads as comedy.
   */
  say(text: string, now: number, duration = 4200, instant = false): void {
    this.subtitleText = text;
    this.sayStartedAt = now;
    this.sayInstant = instant;
    // Instant lines are the ending's, and the ending is a monologue: the same
    // element, worn without the portrait or the name, alone in the dark.
    if (this.subtitle.dataset.monologue !== String(instant)) {
      this.subtitle.dataset.monologue = String(instant);
    }
    this.revealedCount = 0;
    // However long the caller asked for, the line stays at least long enough
    // to finish being written and be read once.
    const spoken = instant ? 0 : (text.length / SPEECH_CPS) * 1000;
    this.subtitleUntil = now + Math.max(duration, spoken + 2400);
    this.charSpans = [];
    const words: (HTMLElement | Text)[] = [];
    for (const token of text.split(/(\s+)/)) {
      if (token === "") continue;
      if (/^\s+$/.test(token)) {
        words.push(document.createTextNode(token));
        continue;
      }
      const word = element("span", "vn-word");
      for (const glyph of token) {
        const char = element("span", undefined, glyph);
        word.append(char);
        this.charSpans.push(char);
      }
      words.push(word);
    }
    this.vnLine.replaceChildren(...words);
  }

  /**
   * Hide a button and take it out of play at the same time.
   *
   * Hidden is only a picture: the element stays in the document and stays
   * clickable by anything driving the page, so a script — or a stray click on
   * a card that is on its way out — can press a button the player cannot see.
   */
  private offer(button: HTMLButtonElement, offered: boolean): void {
    if (button.hidden !== !offered) button.hidden = !offered;
    if (button.disabled !== !offered) button.disabled = !offered;
  }

  /**
   * The line the room is willing to offer at this many spent tries.
   *
   * The count is the simulation's, not this panel's: it includes replays the
   * player walked out on with R, which never show a failure card. Counting
   * only the cards made a second-failure hint arrive on the fifth try for a
   * judge who kept aborting early — the exact player the hint was for.
   */
  private hintFor(view: ViewModel): string {
    let earned = -1;
    view.hints.forEach((hint, index) => {
      if (view.attempts >= hint.after) earned = index;
    });
    // H climbs the same ladder, on request instead of by failing, so the card
    // shows whichever rung is higher. Without this a player who asked outright
    // and then failed was handed back a hint they were already reading, and the
    // key looked like it had done nothing while a card was up.
    const rung = Math.max(earned, this.revealedHints - 1);
    return rung >= 0 ? view.hints[rung]?.line ?? "" : "";
  }

  private renderResult(view: ViewModel): void {
    // The ending is the last thing this panel ever shows. Without the latch the
    // per-frame render puts the between-rooms card straight back over it, because
    // the room is still, technically, a success.
    if (this.ended) return;
    const finished = view.phase === "success" || (view.phase === "rerecord" && view.recordingEnabled);
    if (this.result.hidden !== !finished) this.result.hidden = !finished;
    if (!finished) return;
    if (view.phase === "success") {
      this.result.dataset.kind = "success";
      this.resultHeading.textContent = "보관 완료";
      this.resultBody.textContent = "당신이 지나간 자리를, 당신이 다시 지나갔습니다.";
      this.offer(this.again, view.recordingEnabled);
      this.again.textContent = "R · 다시 해보기";
      this.offer(this.onward, view.hasNextChamber);
      this.resultHint.textContent = view.hasNextChamber ? "" : "여기까지가 지금 열려 있는 구역입니다";
      if (view.handoff) {
        // The seam between the half that teaches and the half that asks. Same
        // panel, same key: only the words change, and the advance button says
        // where it goes rather than 「다음 방」, because the next room is not
        // just another room.
        this.result.dataset.kind = "handoff";
        this.resultHeading.textContent = view.handoff.heading;
        this.resultBody.textContent = view.handoff.body;
        this.onward.textContent = view.handoff.button;
        // No rerecord here. R is offered on a success card as a way to go back
        // and make a tidier tape of a room you already understand; under a card
        // that has just said the teaching is over it reads as an instruction to
        // do 04 again, which is the one thing this screen is not asking for.
        this.offer(this.again, false);
      } else if (this.onward.textContent !== ONWARD_LABEL) {
        // Put the room card's own label back. The button is one element for the
        // whole campaign, so a borrowed label outlives the card that borrowed it.
        this.onward.textContent = ONWARD_LABEL;
      }
      if (view.finalBeat) {
        // Not a room you have run out of, so not a room card. The last door
        // gets the key and nothing else — no heading, no buttons, no summary.
        // Naming it ("회랑 끝") turned the last moment of the game into a
        // chapter marker, and the corridor has already said what it has to say.
        this.result.dataset.kind = "final";
        this.resultHeading.textContent = "";
        this.resultBody.textContent = "";
        this.offer(this.again, false);
        this.offer(this.onward, false);
        this.resultHint.textContent = view.finalBeat;
      }
    } else {
      this.result.dataset.kind = "fail";
      this.resultHeading.textContent = "다시 기록";
      // "step on the plate" is the cure in a plate room. In a grip room it
      // sends the player hunting for a plate that does not exist.
      // "Be faster" is only the cure when the way out was actually open. In a
      // room whose exit waits on the echo, a judge followed that advice through
      // six cycles with no way to learn what had really gone wrong — the copy
      // has to say which half failed: the opening of the way, or the taking of it.
      // An uncoached room says what happened and stops. Every branch below adds
      // the cure to the diagnosis, which is the right thing to do while a room
      // is still teaching and the wrong thing once it has started asking: the
      // failure card was the last place the puzzle half was still handing over
      // its own answer, one loss at a time. The hint ladder still has the
      // method, and H still gets it on demand.
      this.resultBody.textContent = !view.coached
        ? (view.lastError
          ? (PLAIN_FAILURE_COPY[view.lastError] ?? FAILURE_COPY[view.lastError])
          : "이번 재생은 끝났습니다.")
        : view.lastError
        ? (view.lastError === "door-closed" && !view.hasPlate
          ? "문이 닫힌 채였습니다. 잡은 손이 문을 엽니다."
          : view.lastError === "door-closed" && view.plateDutyInReplay
            // The generic line says "press the plate and leave" — in the
            // role-reversal room that reads as one move when it is two, and a
            // judge took the two halves for a contradiction.
            ? "문이 닫힌 채였습니다. 2회차에 오렌지 발판을 밟고 있어야 잔상이 지나갑니다. 잔상이 골방의 빛에 닿으면 방이 끝납니다."
            : view.lastError === "out-of-time"
            ? (view.exitOpen
              ? "시간이 다 되었습니다. 다음에는 길이 열리는 순간 바로 나가세요."
              : "시간이 다 되었습니다. 출구는 끝내 열리지 않았습니다.")
            : FAILURE_COPY[view.lastError])
        : "이번 재생은 끝났습니다.";
      this.offer(this.again, true);
      this.again.textContent = "R · 다시 기록";
      this.offer(this.onward, false);
      // Empty until the same wall has been hit enough times to stop being a
      // lesson. The room decides whether it has anything to say.
      this.resultHint.textContent = this.hintFor(view);
    }
    if (view.rerecordNotice) {
      // The finale keeps the key and changes the sentence. Nothing is taken away
      // from the player here — that is the whole point of the line.
      this.resultHint.textContent = view.rerecordNotice;
    }
  }

  /**
   * The last door is closed. Everything else goes; the line stays.
   *
   * No buttons, because there is nothing after this and offering one would turn
   * an ending into a menu.
   */
  showEnding(tapesKept = 0, recordsReclaimed = 0): void {
    this.ended = true;
    // Everything the game was still saying goes quiet first. What follows is
    // the archivist's goodbye, spoken into the dark at her own pace.
    this.clearTransient();
    this.notice.hidden = true;
    this.result.hidden = true;
    this.prompts.textContent = "";
    // Whatever was being held or asked for on the way in, the ending answers
    // nothing and offers nothing. Both of these are hidden for good from here.
    this.hideStageMap();
    this.hintNote.hidden = true;
    // The frame counter is a development read-out and it was surviving onto the
    // last card in the game.
    this.diagnostic.hidden = true;
    this.crosshair.dataset.sealing = "true";

    // The seal comes down, and this one is allowed to linger — everywhere else
    // it is an impact and here it is the last thing that happens in the world.
    // The stamp is retired on the owner's call; the fall to black carries the
    // beat alone until the closing gesture is redesigned.

    for (const timer of this.endingTimers) clearTimeout(timer);
    // Stamp, fall — and then the archivist speaks into the dark, three lines
    // at her own pace, before the title answers them in the first person.
    // The pauses are the point: nothing on screen, nothing to press, long
    // enough to be uncomfortable if you are waiting for a menu.
    // Ending lines land whole — a typewriter at a goodbye reads as comedy.
    // Two clerical lines first, then the human ones: the ledger closes before
    // the person speaks, and one number in it never changes.
    const beat = (at: number, text: string, hold: number): number =>
      window.setTimeout(() => this.say(text, performance.now(), hold, true), at);
    this.endingTimers = [
      window.setTimeout(() => {
        this.blackout.hidden = false;
        void this.blackout.offsetWidth;
        this.blackout.dataset.on = "true";
      }, 1150),
      ...(recordsReclaimed > 0 ? [beat(2050, `회수된 기록: ${recordsReclaimed}건.`, 3300)] : []),
      beat(5900, "회수되지 않은 기록: 1건.", 3300),
      beat(9800, "당신이 지나간 자리마다, 당신이 남아 있었습니다.", 4300),
      beat(14400, "문을 붙들던 손도, 발판 위의 기다림도, 전부 조금 전의 나였습니다.", 4200),
      beat(18900, "과거의 내가 있었기에,", 2700),
      beat(21800, "지금의 내가 있습니다.", 3600),
      window.setTimeout(() => {
        this.clearTransient();
        this.finale.hidden = false;
        this.finale.dataset.on = "true";
      }, 25600),
      window.setTimeout(() => {
        if (tapesKept > 0) {
          this.finaleEpilogue.textContent = `이 보관소에는 당신의 잔상 ${tapesKept}개가 잠들어 있습니다.`;
        }
        this.finaleEpilogue.dataset.on = "true";
      }, 28200),
    ];
  }

  /** Fade the crosshair out ahead of the freeze, then let the flash land. */
  beginSeal(seconds: number): void {
    this.crosshair.dataset.sealing = "true";
    this.crosshair.style.setProperty("--seal-fade", `${Math.max(0.15, seconds * 0.4).toFixed(2)}s`);
  }

  playFoldFlash(): void {
    this.crosshair.dataset.sealing = "false";
    this.flash.dataset.on = "false";
    // Force a reflow so the animation restarts on a second fold.
    void this.flash.offsetWidth;
    this.flash.dataset.on = "true";
    // The stamp is retired on the owner's call — the flash alone closes a
    // record until the sealing gesture is redesigned.
  }
}
