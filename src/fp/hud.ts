import type { ViewModel } from "./scene";
import type { FailureCode } from "../sim/types";

export interface HudCallbacks {
  onStart: () => void;
  onRerecord: () => void;
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
  private readonly subtitle = element("p", "subtitle");
  private readonly flash = element("div", "flash");
  private readonly title = element("div", "overlay title");
  private readonly result = element("div", "overlay result");
  private readonly resultHeading = element("h2");
  private readonly resultBody = element("p");
  private readonly resultHint = element("p", "hint");
  private readonly diagnostic = element("div", "diagnostic");

  private promptSignature = "";
  private subtitleText = "";
  private subtitleUntil = 0;
  private lastPhase: ViewModel["phase"] | null = null;

  constructor(parent: HTMLElement, private readonly callbacks: HudCallbacks) {
    for (let index = 0; index < 4; index += 1) this.crosshair.append(element("span"));

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
    startButton.addEventListener("click", () => this.callbacks.onStart());
    this.title.append(startButton, element("p", "hint", "W A S D 이동 · 마우스 시점 · Space 점프 · ⏎ 기록 끝내기 · R 다시 기록"));

    this.result.append(this.resultHeading, this.resultBody);
    const again = element("button", undefined, "R · 다시 기록");
    again.id = "rerecord-button";
    again.addEventListener("click", () => this.callbacks.onRerecord());
    this.result.append(again, this.resultHint);
    this.result.hidden = true;

    this.root.append(
      this.crosshair,
      this.pass,
      this.tape,
      this.subtitle,
      this.prompts,
      this.flash,
      this.diagnostic,
      this.title,
      this.result,
    );
    parent.append(this.root);
  }

  /** Called once per rendered frame; everything below diffs before it touches the DOM. */
  update(view: ViewModel, now: number): void {
    const playing = view.started && !view.paused;
    this.title.hidden = view.started;
    this.crosshair.hidden = !playing;
    this.tape.hidden = !playing;
    this.prompts.hidden = !playing;
    this.pass.hidden = !playing;

    this.crosshair.dataset.focus = String(view.focus !== null);

    const phaseName = view.phase === "recording" ? "1회차 · 기록" : view.phase === "replay" ? "2회차 · 재생" : view.phase === "success" ? "보관 완료" : "다시 기록";
    if (this.passLabel.textContent !== phaseName) this.passLabel.textContent = phaseName;
    if (this.pass.dataset.phase !== view.phase) this.pass.dataset.phase = view.phase;
    if (this.tape.dataset.phase !== view.phase) this.tape.dataset.phase = view.phase;

    const span = view.phase === "recording" ? view.tapeDuration : view.replaySpan;
    const progress = Math.max(0, Math.min(1, view.tapeTick / span));
    this.tapeFill.style.width = `${(progress * 100).toFixed(2)}%`;
    this.tapeMark.style.left = view.phase === "recording" ? "100%" : `${((view.tapeDuration / view.replaySpan) * 100).toFixed(2)}%`;
    const remaining = Math.max(0, (span - view.tapeTick) / 30);
    const leftLabel = view.phase === "recording" ? "기록 시간" : "재생 시간";
    if (this.tapeLeft.textContent !== leftLabel) this.tapeLeft.textContent = leftLabel;
    const rightLabel = `${remaining.toFixed(1)}s`;
    if (this.tapeRight.textContent !== rightLabel) this.tapeRight.textContent = rightLabel;

    this.renderPrompts(this.promptsFor(view));
    this.renderSubtitle(view, now);
    this.renderResult(view);

    const diagnostic = `${Math.round(view.fps)} fps`;
    if (this.diagnostic.textContent !== diagnostic) this.diagnostic.textContent = diagnostic;
  }

  /**
   * Only ever offer a key that will do something. A prompt for ⏎ before the tape
   * is long enough to fold is the exact kind of lie that made the old tutorial
   * unplayable.
   */
  private promptsFor(view: ViewModel): Prompt[] {
    if (view.phase === "recording") {
      const prompts: Prompt[] = [];
      if (!view.plateActive && !view.canFold) {
        prompts.push({ key: null, label: "앞의 발판으로 걸어가세요", tone: "plain" });
      }
      if (view.plateActive) {
        prompts.push({ key: "⏎", label: "기록 끝내기", tone: "go" });
      } else if (view.canFold) {
        prompts.push({ key: null, label: "발판을 밟은 채로 기록을 끝내면 좋습니다", tone: "plain" });
        prompts.push({ key: "⏎", label: "기록 끝내기", tone: "plain" });
      }
      return prompts;
    }
    if (view.phase === "replay") {
      return [
        { key: null, label: view.doorOpen ? "빛으로 나가세요" : "문이 열리기를 기다리거나, 직접 발판을 밟으세요", tone: "echo" },
      ];
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
    if (view.phase !== this.lastPhase) {
      const previous = this.lastPhase;
      this.lastPhase = view.phase;
      if (view.phase === "recording" && previous === null) {
        this.say("기록을 시작합니다. 하시던 대로 하세요.", now, 5200);
      } else if (view.phase === "recording") {
        this.say("다시 기록합니다.", now, 3000);
      } else if (view.phase === "replay") {
        this.say("지금 걷고 있는 것은 조금 전의 당신입니다.", now, 5200);
      }
    }
    const shown = this.subtitleText !== "" && now < this.subtitleUntil && !view.paused;
    if (this.subtitle.dataset.shown !== String(shown)) this.subtitle.dataset.shown = String(shown);
    if (shown && this.subtitle.textContent !== this.subtitleText) this.subtitle.textContent = this.subtitleText;
  }

  say(text: string, now: number, duration = 4200): void {
    this.subtitleText = text;
    this.subtitleUntil = now + duration;
    this.subtitle.textContent = text;
  }

  private renderResult(view: ViewModel): void {
    const finished = view.phase === "success" || view.phase === "rerecord";
    if (this.result.hidden !== !finished) this.result.hidden = !finished;
    if (!finished) return;
    if (view.phase === "success") {
      this.result.dataset.kind = "success";
      this.resultHeading.textContent = "보관 완료";
      this.resultBody.textContent = "당신이 지나간 자리를, 당신이 다시 지나갔습니다.";
      this.resultHint.textContent = "R · 다시 해보기";
    } else {
      this.result.dataset.kind = "fail";
      this.resultHeading.textContent = "다시 기록";
      this.resultBody.textContent = view.lastError ? FAILURE_COPY[view.lastError] : "이번 재생은 끝났습니다.";
      this.resultHint.textContent = "R을 눌러도 됩니다";
    }
  }

  playFoldFlash(): void {
    this.flash.dataset.on = "false";
    // Force a reflow so the animation restarts on a second fold.
    void this.flash.offsetWidth;
    this.flash.dataset.on = "true";
  }
}
