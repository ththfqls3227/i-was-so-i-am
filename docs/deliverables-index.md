# 결과물·제출 자료 인덱스

이 문서는 제출에 실제로 쓸 자료만 모은 큐레이션 인덱스다. `captures/` 아래의 디버그·감사 스크린샷 전부를 제출 자료로 보지 않는다.

## 1. 게임

- 현재 제출작: `index.html` → `src/boot.ts` → `src/fp-main.ts`
- Codex가 만든 원형 빌드: `legacy.html` → `src/main.ts`
- 로컬 실행: `npm install` 후 `npm run dev`
- 현재 제출작 조작: WASD 이동, 마우스 시점, Space/E 상호작용, Enter 기록 종료, R 재기록, Esc 일시정지, M 음소거
- 대상: 데스크톱 최신 Chrome·Edge·Firefox, WebGL 필요, 로그인 없음

## 2. 게임 소개 문안

### A안 — 구조 중심, 현재 페이지 메타에 적용됨
과거의 나를 기록하고, 그 잔상과 함께 기억 보관소를 빠져나가는 1인칭 협동 퍼즐. ⏎로 기록을 끝내면 과거의 당신이 그 자세 그대로 남아 발판을 누르고, 문을 붙들어 줍니다. 열 개의 방, 그리고 두고 떠나야 하는 것.

### B안 — 경험 중심
혼자인데 협동 퍼즐입니다. 먼저 행동을 기록하고, 다음엔 그 기록과 함께 풉니다. 문을 붙들어 주는 청록빛 잔상은 전부 조금 전의 당신 — 마지막 방에서 당신은 자신을 두고 나옵니다. I WAS, SO I AM.

### English
A first-person co-op puzzle where your partner is your own past. Record what you do; end the record with Enter and the you of a moment ago stays behind — holding plates, holding doors. Ten rooms in a Korean memory archive, and one thing you must leave behind.

## 3. 썸네일

### 후보 1 — 회랑 마지막 창

![회랑 마지막 창](../captures/submission/thumb-1-last-window.png)

- 파일: `captures/submission/thumb-1-last-window.png`
- 규격: 3200×1800 PNG, 16:9
- 장점: 장경각 살창과 남겨진 잔상의 작별 정서가 강하고, 다른 시간 루프 게임과 구분되는 분위기가 있다.
- 주의: 매우 어둡고 추상적이어서 작은 썸네일에서는 게임플레이가 즉시 읽히지 않을 수 있다.
- 현재 `public/og-image.jpg`가 이 후보의 1280×720 축소판으로 연결되어 있다.

### 후보 2 — 잔상 대면

![잔상 대면](../captures/submission/07-echo-face.png)

- 파일: `captures/submission/07-echo-face.png`
- 규격: 3200×1800 PNG, 16:9
- 장점: 실제 1인칭 게임, 시안 잔상, 황동 발판, 한국식 서가가 한눈에 읽힌다.
- 주의: 현재 캡처 우측 상단의 FPS 표시가 보일 수 있으므로 메인 썸네일로 선택할 경우 FPS 없는 동일 구도의 재촬영이 권장된다.

### 현재 추천

- 감정·오리지널리티를 우선하면 후보 1.
- 심사위원이 게임 규칙을 즉시 알아보게 하려면 후보 2를 FPS 없이 재촬영.
- 최종 선택 전까지 페이지 메타와 OG 이미지는 후보 1 기준을 유지한다.

## 4. 인게임 스틸 10장

- `captures/submission/01-title.png`
- `captures/submission/02-recording.png`
- `captures/submission/03-plate.png`
- `captures/submission/04-fold.png`
- `captures/submission/05-echo-passby.png`
- `captures/submission/06-echo-alongside.png`
- `captures/submission/07-echo-face.png`
- `captures/submission/08-corridor.png`
- `captures/submission/09-exit.png`
- `captures/submission/10-success.png`

모두 3200×1800의 실제 인게임 캡처다. 동결 시점의 비교용 스틸 8장은 `captures/stills-frozen/`에 있다.

## 5. 데모 영상

- 편집 드래프트: `captures/submission/video/demo-draft.mp4` — 2분 20초, 약 29MB, 무음
- 원본 브라우저 녹화: `captures/submission/video/page@13338dc8757e354c4afa6974eb47940c.webm` — 약 15MB
- 게임은 음악을 의도적으로 끄고 효과음만 유지하지만, 현재 MP4에는 효과음도 들어 있지 않다.
- 제출 전 결정: 마지막 방과 엔딩을 모두 보여 줄지, 08 초입에서 끊고 “마지막 방은 직접”으로 남길지.

## 6. Codex 원형·컨셉아트·검증 증빙

- Codex 협업 설명: `docs/codex-collaboration.md`
- 원형 컨셉 기준 이미지: `.omx/artifacts/visual-ralph/humanoid-redesign/reference-v1.png`
- 원형 실제 협동 화면: `.omx/artifacts/visual-ralph/humanoid-redesign/actual-cooperation.png`
- 원형 튜토리얼 화면: `.omx/artifacts/visual-ralph/humanoid-redesign/tutorial-crossing.png`
- 컨셉아트 출처·해시: `docs/prototype/asset-provenance.md`, `docs/prototype/assets-manifest.json`
- MCP 브라우저 검증: `docs/prototype/mcp-verification.md`
- 4방 원형 검증: `docs/prototype/gate-report.md`, `docs/prototype/production-verification.md`
- 현재 캠페인 설계: `docs/story-campaign.md`
- 현재 아트 바이블: `docs/art-janggyeonggak.md`

## 7. 제출 전 남은 사람 게이트

1. `6272d87` 동결본을 유지할지, 이후 방 04 개선이 포함된 현재 HEAD를 새 후보로 승격할지 결정.
2. 선택한 후보에서 `npm run gate:submission`과 배포 빌드 E2E를 새로 실행하고 영수증을 보관.
3. 썸네일 후보 선택. 후보 2라면 FPS 없는 재촬영.
4. 데모 영상의 스포일러 범위와 무음 제출 여부 확정.
5. 공개 URL과 백업 URL 배포 후 로그인 없이 처음부터 끝까지 완주.
6. 오너 최종 플레이와 최소 한 명의 신선한 눈 플레이테스트.

