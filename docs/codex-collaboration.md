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

## 5. 제출 전 개편
2026-08-19~ 제출 전 개편(시간 접기 메커니즘, 퍼즐 재설계, 튜토리얼 정직성 게이팅, 시네마틱 비주얼, 프로시저럴 오디오)은 Claude 기반 멀티에이전트 협업으로 진행했습니다. Codex가 세운 결정론 코어와 검증 체계 위에서 이루어졌으며, 전 과정은 이 리포지토리의 커밋 이력에 남아 있습니다.
