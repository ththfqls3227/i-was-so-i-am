/**
 * Gate entry. The game itself lives in fp-main and is only fetched once this
 * module has confirmed the visitor can actually play it: a machine with WebGL
 * and a real pointer boots; anything else gets a card that says why, in the
 * archive's own paper, instead of a black screen and a console on fire.
 */

import "./fp/style.css";

const appEl = document.querySelector<HTMLElement>("#app");
if (!appEl) throw new Error("#app is missing from the document");
const app: HTMLElement = appEl;

function showCard(titleKo: string, bodyKo: string, bodyEn: string): void {
  document.querySelector("#boot-loading")?.remove();
  const card = document.createElement("div");
  card.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#06080c;padding:24px;";
  const paper = document.createElement("div");
  paper.style.cssText =
    "max-width:26rem;padding:2.4rem 2.2rem;background:#e9e2d0;color:#2b2620;border:1px solid #c9bfa4;" +
    'box-shadow:0 0 60px rgba(233,226,208,.08);font-family:"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;line-height:1.7;';
  const h = document.createElement("p");
  h.textContent = titleKo;
  h.style.cssText = "margin:0 0 1rem;font-size:1.05rem;font-weight:700;letter-spacing:.12em;";
  const ko = document.createElement("p");
  ko.textContent = bodyKo;
  ko.style.cssText = "margin:0 0 1rem;font-size:.92rem;";
  const en = document.createElement("p");
  en.textContent = bodyEn;
  en.style.cssText = "margin:0;font-size:.82rem;color:#6d6455;";
  paper.append(h, ko, en);
  card.append(paper);
  app.append(card);
}

function hasWebgl(): boolean {
  try {
    const probe = document.createElement("canvas");
    return probe.getContext("webgl2") !== null || probe.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

const touchOnly = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

if (touchOnly) {
  showCard(
    "I WAS, SO I AM",
    "이 게임은 키보드와 마우스로 진행됩니다. 데스크톱에서 열어 주세요.",
    "This game is played with a keyboard and a mouse. Please open it on a desktop.",
  );
} else if (!hasWebgl()) {
  console.error("WebGL is unavailable; the game was not started.");
  showCard(
    "I WAS, SO I AM",
    "이 보관소는 WebGL로 지어졌습니다. 지금 브라우저에서는 열리지 않습니다. 데스크톱 Chrome·Edge·Firefox 최신 버전에서 다시 열어 주세요.",
    "This archive is built on WebGL, which your browser could not provide. Please try a current desktop Chrome, Edge, or Firefox.",
  );
} else {
  import("./fp-main")
    .then(() => document.querySelector("#boot-loading")?.remove())
    .catch((error: unknown) => {
      console.error("The game failed to start.", error);
      showCard(
        "I WAS, SO I AM",
        "게임을 시작하지 못했습니다. 새로고침해 보시고, 계속 열리지 않으면 데스크톱 Chrome·Edge·Firefox 최신 버전에서 다시 열어 주세요.",
        "The game failed to start. Try reloading, or a current desktop Chrome, Edge, or Firefox.",
      );
    });
}
