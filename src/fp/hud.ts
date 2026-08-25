import type { ViewModel } from "./scene";
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
  private readonly finaleSeal = element("div", "finale-seal", "封");
  /** What the player leaves in the building, counted. Shown after the title. */
  private readonly finaleEpilogue = element("p", "finale-epilogue");
  private endingTimers: number[] = [];
  private readonly resultHeading = element("h2");
  private readonly resultBody = element("p");
  private readonly resultHint = element("p", "hint");
  private readonly again = element("button", undefined, "R · 다시 기록");
  private readonly onward = element("button", undefined, "N · 다음 방");
  /** Picks the campaign back up mid-roster. Only ever shown when a save exists. */
  private readonly continueButton = element("button");
  /**
   * Says the game is paused. Without it, a pause empties the whole interface —
   * a judge lost pointer lock, watched every gauge vanish, and reported the
   * HUD as broken rather than the game as waiting.
   */
  private readonly pauseNote = element("div", "pause-note", "일시 정지 — 클릭해서 계속");
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
   * 默 — shown only while the archive is silenced, and nothing at all otherwise.
   * A speaker icon that is always there, crossed out or not, is a control panel;
   * this is a mark that appears when something is off.
   */
  private readonly mutedMark = element("div", "muted-mark", "默");
  private readonly notice = element("p", "notice");

  private promptSignature = "";
  private subtitleText = "";
  private subtitleUntil = 0;
  private lastEntryLine: string | null = null;

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
    this.title.append(
      startButton,
      this.continueButton,
      element("p", "hint", "W A S D 이동 · 마우스 시점 · Space 점프 · E 잡기\n⏎ 기록 끝내기 · R 다시 기록 · N 다음 방 · Esc 멈춤 · M 음소거"),
    );

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
    this.finale.append(this.finaleSeal, this.finaleTitle, this.finaleEpilogue);
    this.blackout.hidden = true;
    this.finale.hidden = true;

    this.notice.textContent = "마우스 왼쪽 버튼을 누른 채 움직여 시점을 돌리세요";
    this.notice.hidden = true;
    this.mutedMark.hidden = true;

    this.pauseNote.hidden = true;
    this.root.append(
      this.crosshair,
      this.pass,
      this.tape,
      this.subtitle,
      this.notice,
      this.pauseNote,
      this.prompts,
      this.flash,
      this.seal,
      this.blackout,
      this.finale,
      ...(this.showDiagnostic ? [this.diagnostic] : []),
      this.mutedMark,
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

  /** Called once per rendered frame; everything below diffs before it touches the DOM. */
  update(view: ViewModel, now: number): void {
    const playing = view.started && !view.paused;
    this.title.hidden = view.started;
    this.crosshair.hidden = !playing;
    const pausedShown = view.started && view.paused && !this.ended;
    if (this.pauseNote.hidden !== !pausedShown) this.pauseNote.hidden = !pausedShown;
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
    const showNotice = playing && view.pointerLockDenied && !view.dragLookLearned && !this.ended;
    // Never taken out of the layout again once it has appeared: hidden cuts a
    // fade off mid-way, and an element at zero opacity with no pointer events
    // is not in anybody's way.
    if (showNotice) this.notice.hidden = false;
    if (this.notice.dataset.shown !== String(showNotice)) {
      this.notice.dataset.shown = String(showNotice);
    }

    const pass = view.phase === "recording" ? "1회차 · 기록" : view.phase === "replay" ? "2회차 · 재생" : view.phase === "success" ? "보관 완료" : "다시 기록";
    const phaseName = `${view.chamberNumber} ${view.chamberName} · ${pass}`;
    if (this.passLabel.textContent !== phaseName) this.passLabel.textContent = phaseName;
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
      ? (view.tapeArmed ? "남은 기록 시간" : "기록 대기 — 움직이면 시작됩니다")
      : "잔상 시간";
    if (this.tapeLeft.textContent !== leftLabel) this.tapeLeft.textContent = leftLabel;
    const rightLabel = `${remaining.toFixed(1)}s`;
    if (this.tapeRight.textContent !== rightLabel) this.tapeRight.textContent = rightLabel;

    // Nothing to point at once the corridor has started closing: a wayfinding
    // hint under the last thing the game says is the game talking over itself.
    this.renderPrompts(view.closing ? [] : this.promptsFor(view));
    this.renderSubtitle(view, now);
    this.renderResult(view);

    if (this.showDiagnostic) {
      const diagnostic = `${Math.round(view.fps)} fps`;
      if (this.diagnostic.textContent !== diagnostic) this.diagnostic.textContent = diagnostic;
    }
  }

  /**
   * Only ever offer a key that will do something. A prompt for ⏎ before the tape
   * is long enough to fold is the exact kind of lie that made the old tutorial
   * unplayable.
   */
  private promptsFor(view: ViewModel): Prompt[] {
    if (!view.recordingEnabled) {
      // No fold, no rerecord — neither key does anything here, so neither is
      // offered. The room is walked, and that is the whole of it.
      return view.phase === "success" ? [] : [{ key: null, label: "빛으로 나가세요", tone: "echo" }];
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
      if (view.hasPlate && view.plateDutyInReplay) {
        // 03: the plate is the second pass's job. "Walk to the plate" here
        // steered a judge onto it with the recording running — the one move
        // the room is built to refuse. Say whose turn it is, and what THIS
        // pass is for: "record your steps" told a judge nothing about which
        // steps, and cost five tries.
        prompts.push({ key: null, label: "이 발판은 2회차에 밟습니다 — 지금은 닫힌 문 쪽으로 걸어 두세요", tone: "plain" });
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
            ? "발판을 지나쳤습니다 — 한 걸음 뒤로"
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
          prompts.push({ key: null, label: "발판 위입니다 — 잠시 그대로", tone: "go" });
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
            ? "발판이 왼쪽에 있습니다 — 직접 밟으세요"
            : view.plateBearing === "right"
              ? "발판이 오른쪽에 있습니다 — 직접 밟으세요"
              : view.plateBearing === "behind"
                ? "발판을 지나쳤습니다 — 뒤로 돌아 밟으세요"
                : "오른쪽 발판을 직접 밟으세요 — 당신의 발이 문을 엽니다")
          : view.plateForEchoOnly
            ? "이 발판은 잔상의 것입니다 — 문이 열릴 때까지 기다리세요"
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
        return [{ key: null, label: "발판이 눌렸습니다 — 곧 문이 열립니다", tone: "go" }];
      }
      if (view.doorOpen && !view.exitOpen && view.plateActive) {
        // Say why the standing matters, or it reads as a goal in itself — a
        // judge who was not on the plate obeyed this line for a whole cycle,
        // standing in the middle of the room waiting for permission to move.
        return [{ key: null, label: "그대로 밟고 계세요. 잔상이 문을 지나면 출구가 열립니다", tone: "echo" }];
      }
      // "Walk into the light" cost one judge six tries and another ten,
      // because the brightest thing on screen was the wrong door both times —
      // the line now says which way. And in a grip room the way out is open
      // exactly as long as the echo's hand holds, so that clause stays.
      const dir = view.exitBearing === "ahead" ? "앞" : view.exitBearing === "left" ? "왼쪽" : view.exitBearing === "right" ? "오른쪽" : "뒤";
      const out = view.hasPlate
        ? `출구는 ${dir}입니다 — 빛으로 나가세요`
        : `잔상이 잡아 주는 동안입니다 — ${dir}의 출구로 나가세요`;
      // Where the exit has its own gate, the doors stop mattering the moment
      // it opens: in 03 leaving the plate shuts the first door behind the
      // echo, and requiring it open again sent the coaching back to "step on
      // the plate" while the way out stood waiting.
      // Every door, not the first: in 05 the way-in opened and this line sent
      // the player at a way-on still shut.
      const canLeave = view.exitGated ? view.exitOpen : view.allDoorsOpen && view.exitOpen;
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
    let offered = "";
    for (const hint of view.hints) {
      if (view.attempts >= hint.after) offered = hint.line;
    }
    return offered;
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
      this.resultBody.textContent = view.lastError
        ? (view.lastError === "door-closed" && !view.hasPlate
          ? "문이 닫힌 채였습니다. 잡은 손이 문을 엽니다."
          : view.lastError === "door-closed" && view.plateDutyInReplay
            // The generic line says "press the plate and leave" — in the
            // role-reversal room that reads as one move when it is two, and a
            // judge took the two halves for a contradiction.
            ? "문이 닫힌 채였습니다. 2회차에 오른쪽 발판을 밟고 있어야 잔상이 지나갑니다 — 출구는 발판 너머 동쪽 통로 끝에 있습니다."
            : view.lastError === "out-of-time"
            ? (view.exitOpen
              ? "시간이 다 되었습니다. 출구는 열려 있었으니 — 다음에는 길이 열리는 순간 나가세요."
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
    // The frame counter is a development read-out and it was surviving onto the
    // last card in the game.
    this.diagnostic.hidden = true;
    this.crosshair.dataset.sealing = "true";

    // The seal comes down, and this one is allowed to linger — everywhere else
    // it is an impact and here it is the last thing that happens in the world.
    this.seal.dataset.on = "false";
    void this.seal.offsetWidth;
    this.seal.textContent = "封";
    this.seal.dataset.wet = "true";
    this.seal.dataset.on = "true";

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
      beat(9800, "당신이 지나간 자리마다, 당신이 남아 있었습니다.", 4600),
      beat(15000, "과거의 당신이 있었기에 —", 3000),
      beat(18400, "지금의 당신이 있습니다.", 4200),
      window.setTimeout(() => {
        this.clearTransient();
        this.finale.hidden = false;
        this.finale.dataset.on = "true";
      }, 23300),
      window.setTimeout(() => {
        if (tapesKept > 0) {
          this.finaleEpilogue.textContent = `이 보관소에는 당신의 잔상 ${tapesKept}개가 잠들어 있습니다.`;
        }
        this.finaleEpilogue.dataset.on = "true";
      }, 25900),
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
    // The archive stamps the record closed. Under reduced motion the seal still
    // appears and still says the same thing — it just does not travel to say it.
    this.seal.dataset.on = "false";
    void this.seal.offsetWidth;
    this.seal.textContent = "封";
    this.seal.dataset.on = "true";
  }
}
