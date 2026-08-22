# Codex Collaboration Record

이 게임의 토대는 OpenAI Codex와 함께 만들었습니다. 아래는 리포지토리 안에서 확인 가능한 증빙과 함께 정리한 협업 기록입니다.

## 1. 결정론 코어 아키텍처 — Codex 세션 산출
- 결정론 30Hz 고정틱 시뮬레이션, 입력 비트마스크, 「기록→협동」 테이프 리플레이, FNV 체크섬 무결성.
- 100케이스 리플레이 코퍼스가 30/60/144Hz 렌더 케이던스에서 체크섬 동일성을 Node와 Chromium/Firefox/WebKit 전부에서 증명하는 검증 체계.
- 증빙: `docs/prototype/gate-report.md`, `docs/prototype/production-verification.md`

## 2. 4개 방 확장·Babylon.js 마이그레이션 — Codex 작업 브리프 사이클
- 사전 작업 브리프 → 구현 → 사후 게이트 문서로 이어지는 Codex 세션 운영 기록.
- 증빙: `.omx/context/expand-four-room-game-20260813T132556Z.md`, `.omx/context/babylon-humanoid-redesign-20260814T102841Z.md`

## 3. 컨셉아트 — Codex imagegen
- 아트 디렉션과 제출 썸네일의 원본인 컨셉아트 4장을 Codex의 imagegen으로 생성, SHA-256으로 프로비넌스 고정. 런타임 래스터 미사용 정책과 함께 관리.
- 증빙: `docs/prototype/asset-provenance.md`, `docs/prototype/assets-manifest.json`, `.omx/artifacts/visual-ralph/humanoid-redesign/reference-v1.png`

## 4. Playwright MCP — Codex가 게임을 직접 플레이하며 검증
- 프로젝트 스코프 Playwright MCP 서버를 구성해 Codex가 브라우저에서 4개 방을 키보드로 완주하고, 접근성 스냅샷·콘솔 무오류·WebGL 성능 트레이스를 검증.
- 증빙: `.codex/config.toml`, `docs/prototype/mcp-verification.md`, `scripts/playwright-mcp-server.mjs`

## 5. 1인칭 재구축 — Codex의 유산 위에서 (2026-08-19~22)
제출작은 1인칭 캠페인(방 10개+엔딩 회랑)으로 백지 재구축한 버전입니다. Claude 기반 멀티에이전트 협업으로 진행했고, Codex의 기여는 코드 복사가 아니라 **아키텍처와 검증 문화의 이식**으로 살아 있습니다:

- **결정론 규율의 이식**: 새 3D 심(`src/sim/`, 커밋 9415b0c)은 Codex가 프로토타입에서 확립한 패턴 — 30Hz 고정틱, FNV 체크섬, 테이프 버저닝, 크로스엔진 리플레이 코퍼스 — 을 그대로 따릅니다. 4엔진(Node/Chromium/Firefox/WebKit) 749틱 체크섬 일치 검증(커밋 fae7372)은 Codex 시절 코퍼스 방법론(§1)의 직계입니다.
- **구코드가 신코드를 가르친 사례**: 재구축 중 발견된 치명 버그(재생 창 만료 시 메아리가 잡은 것을 놓음)의 수정(커밋 01ca6d0)은 Codex가 작성한 2D 코어 `src/core/mechanisms/hold.ts`의 grace 처리 선례를 근거로 했습니다.
- **원형의 보존**: Codex가 만든 4개 방 빌드는 베이스라인 커밋(bd193f2)으로 스냅샷되어 있고, **배포물에도 `legacy.html`로 함께 실려 지금도 플레이 가능합니다** — 협업의 출발점을 심사위원이 직접 확인할 수 있습니다.

전 과정은 이 리포지토리의 커밋 이력에 남아 있습니다.

## 6. 제출 폼용 요약 (≤500자)
이 게임은 OpenAI Codex와의 협업에서 출발했습니다. Codex가 결정론 30Hz 리플레이 코어와 크로스엔진 체크섬 검증 체계를 세웠고, Babylon.js 마이그레이션과 Playwright MCP 기반 자가 플레이테스트, imagegen 컨셉아트까지 수행했습니다. 제출작인 1인칭 캠페인은 그 위에서 재구축한 것으로, Codex의 아키텍처 패턴(고정틱·체크섬·리플레이 코퍼스)을 계승하며 4개 브라우저 엔진에서 749틱 결정론 일치를 유지합니다. Codex가 만든 원형 빌드는 배포물의 legacy.html에서 지금도 플레이할 수 있습니다.
