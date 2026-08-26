# Compact Handoff — Codex 기획 과정과 현재 작업 — 2026-08-26

## 컴팩트 이후 가장 먼저 읽을 것

1. `.omx/context/compact-handoff-20260826-codex-planning.md` — 현재 포인터
2. `docs/codex-planning-process.md` — Deep Interview 질문 사다리와 스킬·도구 연혁
3. `docs/codex-collaboration.md` — 제출용 협업 설명과 정직성 경계
4. `docs/project-handoff-2026-08-26.md` — 현재 1인칭 캠페인 구조
5. `docs/deliverables-index.md` — 게임·썸네일·영상·스틸 위치
6. `.omx/plans/prd-rebuild-contest-improvement.md`와 `.omx/plans/test-spec-rebuild-contest-improvement.md` — 현재 개선 계획과 검증 계약

기존 `.omx/context/compact-handoff-20260826.md`는 당시 HEAD `6fd0c48`의 역사적 기록이다. 현재 재개 포인터로 사용하지 않는다.

## 현재 저장소 상태

- CWD: `/Users/sol/Desktop/Projects/echofold`
- 브랜치: `feat/rebuild`
- 문서 최종 검증 시 HEAD: `3241df75f4caeada78d81bb1b1dd094c94258f58`
- 제목: `I WAS, SO I AM`; 초기 코드명: `ECHOFOLD`
- 현재 제품: 데스크톱 브라우저용 1인칭 싱글플레이 자기협동 퍼즐, 10방+엔딩 회랑
- 현재 진입점: `index.html` → `src/boot.ts` → `src/fp-main.ts`
- Codex 4방 원형: `legacy.html` → `src/main.ts`

브랜치와 HEAD는 다른 작업에 의해 움직인 이력이 있다. 이 문서를 쓰는 동안에도 `7b8e9af`에서 `3241df7`로 이동했다. 재개 즉시 `git branch --show-current`, `git rev-parse HEAD`, `git status --short --branch`를 다시 읽는다. 어떤 변경도 reset, checkout, rebase, force-push로 되돌리지 않는다.

문서 작성 도중 `7b8e9af`에서 관찰한 아래 제품 변경은 `3241df7` 시점에는 별도 커밋으로 정리돼 있었다.

- `src/audio/fp-engine.ts`
- `src/fp/hud.ts`
- `src/fp/style.css`

최종 검증 시 남은 비문서 생성물은 다음과 같다.

- `dist-e2e-codex/` — untracked 생성물
- `dist-e2e-probe/` — untracked 생성물

제품 파일과 생성물은 이번 컴팩트 문서 작업의 소유 범위가 아니다. 수정·스테이징·삭제하지 않는다.

이번 컴팩트 준비가 만든 문서 변경은 아직 커밋하지 않았다. 공유 `feat/rebuild`가 동시 이동 중이어서 임의 커밋을 만들지 않은 것이다.

- `docs/codex-planning-process.md` — 새 파일
- `docs/codex-collaboration.md` — 기획 과정 요약 추가
- `docs/deliverables-index.md` — 새 기획 문서 링크 추가
- `.omx/context/compact-handoff-20260826-codex-planning.md` — 새 파일

재개 시 이 네 파일의 diff를 먼저 보존한다. 커밋할 때도 위 네 경로만 명시적으로 스테이징하고 `dist-e2e-*`는 포함하지 않는다.

## 게임의 변하지 않는 핵심

첫 번째 회차에서 미래의 나가 필요로 할 행동을 기록한다. Enter로 기록을 접으면 청록색 잔상이 같은 입력을 재생하고, 현재의 나는 그 행동과 협동해 혼자서는 풀 수 없는 방을 해결한다.

- 한 명의 과거 잔상 + 한 명의 현재 나
- 두 회차 사이 전체 방 초기화
- 위치 영상이 아니라 입력 의도 재생
- 어려운 조작이 아니라 역할 계획이 난도
- Portal식 단계별 챔버 학습
- 인식→신뢰→작별의 감정 진행
- 마지막에는 과거의 나가 문을 붙들고 현재의 나만 떠남
- 의미: “과거의 내가 있었기에 지금의 내가 있다. 지금까지 잘해왔고, 앞으로도 잘할 수 있다.”

현재 시각 정체성은 장경각에서 영감을 받은 한국의 기억 보관소다. 짙은 목재 서가, 경판 비례의 기억함, 살창 빛, 황동, 붉은 낙관, 주황 현재, 청록 잔상, 흰 출구를 사용한다.

오디오 방향도 최신 커밋에서 바뀌었다. 일반 방에서는 음악 게인이 0이라 효과음 중심이지만, `3241df7`부터 마지막 엔딩 독백이 시작되면 회랑 스코어가 4.5초에 걸쳐 돌아온다. 과거 문서의 “음악 완전 제거”보다 현재 소스가 우선한다.

## Codex 기획 원본 — 실제 Deep Interview

`$deep-interview --standard`를 실제로 실행했다.

- 인터뷰 ID: `3D974CD3-DB93-4EE8-8794-4F5814D3F106`
- 8라운드
- 최종 모호도 `0.03`, 종료 기준 `0.20`
- 요구사항: `/Users/sol/.omx/specs/deep-interview-echofold-game.md`
- 공개 안전 요약: `/Users/sol/.omx/interviews/echofold-game-20260812T201232Z.md`
- 문맥 스냅샷: `/Users/sol/.omx/context/echofold-game-interview-20260812T184040Z.md`
- 당시 컴팩트: `/Users/sol/.omx/context/echofold-compact-handoff.md`
- 합의 PRD: `/Users/sol/.omx/plans/prd-echofold.md`
- 테스트 명세: `/Users/sol/.omx/plans/test-spec-echofold.md`

질문 순서는 완성감→장르→콘셉트 유지→실제 플레이→방 리셋→잔상 수→피해야 할 것→최종 감정이었다. 상세는 `docs/codex-planning-process.md`에 공개 가능한 형태로 고정했다.

## Codex 스킬·도구 연혁

1. 공식 사이트/외부 조사로 브라우저·무로그인·제출 링크·썸네일·영상 조건 확인
2. `$deep-interview`로 추상적 의도를 8라운드 요구사항으로 변환
3. 선례 리서치로 과거 자아 재생 단독의 독창성 위험 확인
4. `$ralplan --direct`로 PRD·테스트 명세와 Planner→Architect→Critic 합의 형성
5. `$ralph`로 Phase 0/1 Trace+Weight 구현·반복 검증
6. 4방 `TraceWeight → Crossing → Handoff → LastHold` 확장
7. Playwright MCP/Playwright로 실제 키보드 플레이, 접근성, 콘솔, 크로스엔진 검증
8. `imagegen`으로 컨셉아트 생성 및 해시 프로비넌스 기록
9. `$visual-ralph`로 기준 이미지와 실제 Babylon.js 화면의 시각 반복 개선
10. `$ai-slop-cleaner`와 성능 회귀로 레거시 렌더 찌꺼기 제거 및 최종 검증

## 사람과 Codex의 경계

사용자는 브라우저 게임, 두 번 플레이하는 자기협동, Portal식 진행, 쉬운 조작, 과거의 나와 헤어지는 자아 회복 메시지를 결정했다. Codex는 질문을 통해 의도를 분리하고, 전체 리셋, 입력 의도 재생, 정확히 두 자아, 결정론 코어, 테스트 게이트를 설계·구현·검증했다.

현재 1인칭 10방+엔딩 캠페인은 이후 Claude 기반 멀티에이전트 협업으로 재구축됐다. “현재 게임 전체를 Codex가 만들었다”고 주장하지 않는다. Codex의 직접 범위는 초기 기획, 결정론 원형, 4방 수직 슬라이스, Babylon.js 3D 전환, 컨셉 이미지, Playwright MCP·브라우저 검증이다.

## 현재 결과물

- 현재 게임: `index.html`
- Codex 원형: `legacy.html`
- 기획 과정: `docs/codex-planning-process.md`
- Codex 제출 설명: `docs/codex-collaboration.md`
- 현재 캠페인: `docs/story-campaign.md`
- 아트 기준: `docs/art-janggyeonggak.md`
- 결과물 인덱스: `docs/deliverables-index.md`
- 제출 문안: `docs/submission-notes.md`
- 새 키아트 후보: `captures/submission/thumb-2-keyart-a.png`, `captures/submission/thumb-3-keyart-b.png`
- 현재 타이틀 아트: `public/assets/title-art.jpg`
- 기존 인게임 감정 썸네일: `captures/submission/thumb-1-last-window.png`
- 현재 OG: `public/og-image.jpg`
- 영상: `captures/submission/video/demo-draft.mp4`
- Codex 컨셉·실제 화면: `.omx/artifacts/visual-ralph/humanoid-redesign/`

`docs/submission-notes.md`에는 2026-08-26 오너 선택으로 `thumb-3-keyart-b.png`가 기록돼 있다. 컴팩트 후에는 이 키아트와 현재 1인칭 빌드의 실제 느낌이 일치하는지 먼저 육안 확인하고, 필요하면 `imagegen`으로 별도 새 파일을 만든다. `public/assets/title-art.jpg`를 확인 없이 덮어쓰지 않는다.

## 최신 검증 증거의 경계

이번 컴팩트 문서 작업 직전 현재 브랜치에서 확인된 것은 저장소 상태와 산출물 위치다. 이전 Codex 개선 세션에서는 현재 이동 중인 트리에서 다음을 확인했다.

- typecheck PASS
- 중간 캠페인 스펙 대상 ESLint PASS
- `git diff --check` PASS
- 중간 캠페인 Chromium 브라우저 스펙 PASS 1회
- 전체 00→09→회랑 브라우저 여정 PASS 1회

그러나 이후 HEAD와 동시 작업 파일이 다시 변경됐다. 이 결과를 현재 `3241df7` 후보의 완전 동결 영수증으로 주장하지 않는다. 정확한 현재 후보는 깨끗한 격리 워크트리에서 전체 게이트를 다시 실행해야 한다.

역사적 Codex 4방 빌드의 별도 증거는 다음에 있다.

- `docs/prototype/gate-report.md`
- `docs/prototype/production-verification.md`
- `docs/prototype/mcp-verification.md`
- `docs/prototype/asset-provenance.md`

## 컴팩트 후 작업 순서

1. 현재 branch/HEAD/status를 다시 읽고 동시 변경을 보존한다.
2. `7b8e9af`와 `3241df7`에 포함된 중간 캠페인·엔딩·오디오 변경을 현재 기준으로 읽되 reset하지 않는다.
3. 정확한 현재 후보에서 typecheck, lint, unit, built-browser middle journey, full 10-room journey를 다시 검증한다.
4. 저장/이어하기, R·Esc·포인터락 회복, 현재 1인칭 성능/MCP/크로스엔진 영수증의 남은 간극을 닫는다.
5. `thumb-3-keyart-b.png`와 `public/assets/title-art.jpg`를 실제 최신 게임 화면과 비교하고, 불일치하면 `imagegen`으로 새 16:9 썸네일을 별도 파일로 생성한다.
6. 한 커밋·한 빌드·한 영수증 세트를 동결하고 공개/백업 URL에서 무로그인 완주한다.

## 금지 사항

- 동시 작업을 reset, checkout, rebase, force-push로 되돌리지 않는다.
- `dist-e2e-codex/`, `dist-e2e-probe/`를 승인 없이 삭제하지 않는다.
- 과거 4방 검증을 현재 10방 후보의 영수증으로 섞지 않는다.
- Codex가 현재 10방 전체를 작성했다고 주장하지 않는다.
- 컨셉 일러스트를 실제 인게임 화면인 것처럼 주장하지 않는다.
- 썸네일·타이틀 아트를 확인 없이 덮어쓰지 않는다.
