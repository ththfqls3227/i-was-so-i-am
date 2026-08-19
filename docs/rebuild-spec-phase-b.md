# Phase B 구현 스펙 — 코어·퍼즐·튜토리얼 (2026-08-19)

전제: `docs/rebuild-plan.md`의 진단을 읽을 것. 결정론 코어의 렌더-온리 경계는 절대 유지.
브랜치 `feat/rebuild`에서만 작업. 푸시 금지, main 직접 수정 금지. 작업 단위 커밋(메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

## B1. 코어 리팩터 (src/core)

1. **시간 접기 (fold) — 신규 핵심 API**: `Simulation.foldRecording()`.
   - phase==='recording'이고 `frames.length >= MIN_TAPE_TICKS`(30틱=1초)일 때만 동작.
   - 마지막으로 샘플된 입력 프레임(방향 비트 제외, ActionHeld만 유지 — 이동 중 fold 시 과거가 벽에 계속 걷는 것 방지)을 `chamber.tapeDurationTicks`까지 반복해 채우고 테이프 확정, replay 진입.
   - 기존 렌더 레이어의 `completeCrossingTutorialHold`(MemoryScene.ts:392-409, 입력 조작) **삭제** — UI가 `scene.foldRecording()` 호출로 대체. 코어가 유일한 입력 소스.
   - StepResult/SimulationState에 fold 발생 여부 노출(`foldedAtTick?: number`) — 렌더 연출용.
2. **리플레이 윈도우 고정**: graceEnd 기준을 `tape.duration`이 아니라 `chamber.tapeDurationTicks + GRACE_TICKS`로. (fold로 짧아진 테이프가 2회차 시간을 깎지 않도록. 현재는 fold가 테이프를 끝까지 채우므로 동작 동일 — 방어적 명시.)
3. **메커니즘 모듈화**: applyInteractions를 `mechanisms/hold.ts, force.ts, handoff.ts, door.ts`로 분리. 시그니처 통일 `(state, chamber, actors) => void`. 동작 불변(리플레이 코퍼스가 감시).
4. **door 일반화**: 한 방에 door + 임의 메커니즘 공존 가능. `door.gatedBy: 'hold'`는 기본 유지, `latchWhenPresentBeyondX`·`blocksPast` 유지. hold 없는 방의 door가 항상 닫히는 하드커플 제거.
5. **forceObject 양방향**: `pushDirection: 'left' | 'right'`(기본 right). isAlignedPusher가 미는 방향 반대면에서 그 방향을 보고 있을 때 인정. minX/maxX 목표를 방향에 따라 사용. 기여자 이동 시 벽 충돌 무시하던 것(`contributor.x += delta`)을 moveActor 경로로 통과시켜 벽 클리핑 제거.
6. **이동 정규화**: 대각선 intent 벡터를 크기 1로 정규화(현재 √2배 빠름). MOVE_PER_TICK 불변.
7. **결정론 강화**: `Math.hypot` 전부 `Math.sqrt(dx*dx+dy*dy)`로 교체(크로스엔진 라운딩 위험 제거).
8. **데드 데이터 해소**: 시뮬 타겟 판정이 상수 TARGET_RADIUS 대신 `chamber.hold.radius`/`handoff.radius`를 읽도록(없으면 상수 폴백). frozenSuccess 클론 제거. ActionPressed 비트는 테이프 포맷 유지 위해 기록은 계속하되 미사용임을 주석 명시.
9. **실패 사유 구조화**: lastError를 코드화(`echo-faded`, `door-closed`, `hold-released-early`, `carrier-not-staged`, `delivery-gate-closed`, `block-not-bridged` 등) → UI가 코드→카피 매핑. 문자열 직비교 금지.
10. `simulationVersion`을 `production-2.0.0`으로 bump. 유닛테스트 전부 그린으로 갱신(동작 변화는 테스트를 스펙에 맞게 수정 — 특히 대각선 정규화·fold·grace 기준).

## B2. 퍼즐 재설계 (src/content) — 전 방 chamberVersion: 2, 골든 재작성

원칙: 방마다 새 아이디어 1개, 해법은 "타이밍 정밀도"가 아니라 "순서/역할 계획"에서 나온다. 골든 테이프는 프레임 정밀 금지 — 여유 마진(홀드는 필요치+1초 이상, 이동은 도달 후 여유틱) 포함해 저작. tapeDurationTicks ≤ 420틱(14초) 제약 준수.

- **Crossing (튜토리얼, 불변에 가깝게)**: 레이아웃·메커니즘 유지(hold→door, 래치 없음). tapeDurationTicks 240(8초) 유지. fold가 여기서 처음 등장.
- **Trace Weight (유지+가독성)**: 메커니즘 유지(hold latch + 협동 push threshold 2). 배치 튜닝 허용(윈치→문→블록 동선이 화면에서 한눈에 읽히게). force 게이지 데이터(state.forceObject.force)는 이미 있음 — UI에서 노출.
- **Handoff (선택+역할 계획 추가)**: 기존 carry→junction→redirect→delivery에 **hold 게이트 전달구** 추가. 1회차(과거): 기억 상자를 들어 교차점에 내려놓고 → 개폐기로 이동해 붙들기(전달구 개방) → fold. 2회차(현재): 상자를 받아 위로 우회 운반 → 과거가 열어둔 전달구에 투입. 과거 테이프가 2목표(운반→홀드) 시퀀스가 되고, "언제까지 붙들어야 하나"를 계획해야 함. B1-4(door 일반화) 필요.
- **Last Hold (피날레 — Crossing 리스킨 탈피)**: 2단계 과거 테이프. 1회차: 돌덩이를 **왼쪽으로** 밀어(B1-5 양방향) 틈에 다리 놓기 → 마지막 문 손잡이로 이동해 붙들기 → fold(과거는 영원히 남음). 2회차: 돌덩이 다리를 건너 → 과거가 붙든 문(blocksPast, requiredActor:'past')을 지나 출구로. 실패 사유: 다리 미완성(`block-not-bridged`) vs 문 닫힘(`hold-released-early`) 구분. 기존 이별 내러티브 유지·강화.
- **골든/코퍼스/테스트**: goldens 4개 재작성(마진 포함, fold 사용 케이스 포함). `buildReplayCorpus`를 4개 방 순환(`caseIndex % 4`)으로 확장, fold 케이스도 코퍼스에 포함. levels/production-core-mechanics/production-journey 테스트를 새 방 설계에 맞게 재작성 — 각 방의 "협동 없으면 실패" 어서션 유지. `npm run validate` 그린 필수.

## B3. 튜토리얼·UX 오버홀 (src/main.ts + MemoryScene 연결)

1. **스테이지 판정을 상태 유도로**: 거리/tapeTick 매직넘버(92/82/172 등) 전면 제거. 스테이지는 `phase, actor.targetId, hold.active/heldTicks, door.open/latched, forceObject.force/position, handoff.stagedByPast/redirectedByPresent/delivered, lastError 코드`에서만 유도. 체크리스트 항목은 상태 충족 즉시 ✓ (현재 1번 항목조차 체크 안 되는 버그 해소).
2. **fold UX**: 기록 중 상시 표시되는 보조 프롬프트 「⏎ 시간 접기 — 지금 행동을 유지한 채 남은 시간을 접습니다」(조건 미달 시 비활성). 터치: 전용 버튼 추가. fold 순간 0.6초 연출(오버레이 플래시 + 문구 「시간이 접힙니다」; 시뮬은 정지하지 않음 — 오버레이만).
3. **패스 전환 명료화**: 기록 종료→리플레이 진입 시 1초 배너 「청록색 과거가 당신의 기록을 재생합니다 — 이제 현재를 움직이세요」. 상단에 상시 패스 배지(1회차 기록 · 앰버 / 2회차 협동 · 시안) — 기존 요소 강화.
4. **전 방 카피 작성** (한국어 우선, 영어 병기; 어조는 DESIGN.md — 동사로 시작, 한 문장, 시적 표현은 성공 후에만):
   - Crossing p1: ①「황금 표식의 윈치로 가세요」②「Space를 누르고 있으세요 — 다리가 내려옵니다」③(1초 홀드 후)「⏎로 시간을 접으세요 — 이 손은 계속 붙들고 있게 됩니다」 p2: ④「과거가 윈치를 붙들고 있습니다. 다리를 건너 빛으로 가세요」 실패:「다리가 닫혔습니다 — R로 다시 기록하고, 윈치를 잡은 채 ⏎로 접으세요」
   - Trace Weight p1: ①「윈치를 붙들어 문을 여세요」②(래치 후)「손을 떼고, 돌덩이 곁으로 가세요」③「돌덩이에 손을 대세요 — 미래의 내가 함께 밀 것입니다」④「⏎ 시간 접기」 p2: ⑤「열린 문을 지나가세요」⑥「과거와 같은 면에서 함께 미세요 (힘 X/2)」 — 힘 게이지는 같은 스테이지 안에서도 실시간 갱신(기존 스테이지-diff 캐시 때문에 숫자가 멈추는 버그 수정).
   - Handoff p1: ①「기억 상자를 들어 올리세요 (Space)」②「황금 교차점에 내려놓으세요」③「개폐기로 가서 붙드세요 — 전달구가 열립니다」④「⏎ 시간 접기」 p2: ⑤「상자를 받아 위쪽 길로 옮기세요」⑥「과거가 열어둔 전달구에 넣으세요」 실패(gate):「전달구가 닫혀 있습니다 — 1회차에서 개폐기를 더 오래 붙드세요」
   - Last Hold p1: ①「돌덩이를 왼쪽 틈으로 미세요 — 다리가 됩니다」②「마지막 문의 손잡이를 붙드세요」③「⏎ — 과거는 여기, 문 곁에 남습니다」 p2: ④「돌덩이 다리를 건너세요」⑤「문을 지나세요 — 과거는 따라올 수 없습니다」 실패(bridge):「틈이 그대로입니다 — 돌덩이를 끝까지 밀어야 해요」/(door):「문이 닫혔습니다 — 과거가 손잡이를 놓쳤어요」
5. **실패 피드백 노출**: lastError 코드→카피를 튜토리얼 카드에 항상 표시(현재 CSS로 숨겨진 #hint/#controls/#chamber-subtitle는 제거하거나 복원 — 죽은 DOM 쓰기 정리). 실패 시 「↺ R 다시 기록」 강조는 유지.
6. **입력 버그 수정**: R은 `started && !paused`에서만 rerecord. 오버레이 버튼 포커스 중 Space/Enter preventDefault 금지(키보드 접근성). Esc 동작 유지.
7. **e2e 갱신**: 좌표 임계값(230/235/240)은 chamber 정의에서 파생하거나 `__I_WAS_SO_I_AM__.state` 기반 조건으로 교체. 카피 문자열 어서션 갱신. `__I_WAS_SO_I_AM__` API 형태 유지(스토리지 키 불변). fold 경로 e2e 1개 추가(키보드 ⏎). visual-capture는 유지.
8. **터치**: fold 버튼 추가 외 기존 레이아웃 유지. 코스 포인터에서 프롬프트 문구는 키 이름 대신 버튼 명칭.

## B4. 검증 후속 수정 (2026-08-20, 독립 검증자 발견)

근본 원인: `updateAction`의 targetLockout이 "한 번 놓친 액터는 ActionHeld가 유지되는 한 어떤 타겟도 재획득 불가"로 동작. fold가 꼬리를 ActionHeld로 채우므로 리플레이의 과거가 영구 잠김.

1. **타겟 잠금 의미론 수정 (블로커/메이저 공통 해결)**: 잠금은 "방금 놓친 그 타겟의 즉시 재획득 방지"로 한정. `targetLockout`에 잠긴 타겟 id를 함께 저장하고, 다른 eligible 타겟이 나타나면 잠금 해제 후 획득. 기존 안티플랩 목적(core.test.ts의 히스테리시스 테스트) 의미는 보존하되 재타게팅 허용으로 갱신.
2. **운반 중 캐리어 배타**: 다른 액터가 들고 있는 handoff 캐리어는 타 액터의 eligibleTarget 후보에서 제외 (Handoff 타겟 훔치기 제거).
3. **exit 게이트 명시화**: force.ts/handoff.ts의 무조건 `state.exit.open` 기록 제거. `ChamberDefinition.exitGate?: 'force' | 'handoff'` 도입, 기본값은 현행 동작 보존(handoff 존재 시 handoff, 아니면 forceObject 존재 시 force). 지정 메커니즘만 exit를 쓴다.
4. **회귀 테스트**: (a) Trace Weight "튜토리얼 문구 그대로" 프레임(윈치 해제 직후 오른쪽+행동 동시 홀드 → fold) → 성공 어서션. (b) Handoff에서 현재가 과거 곁으로 캐리어를 들고 지나가는 타이밍에도 과거가 스위치 재획득 → 성공. (c) 들고 있는 캐리어는 타 액터가 획득 불가.
5. **실패 카피 방별 분기**: failureCopy를 `(code, chamberId)`로 — traceWeight의 unseated force는 「무게추를 함께 끝까지 밀어야 해요」, lastHold는 기존 「틈이 그대로입니다…」 유지. 문자열 비교 금지 원칙 유지.
6. **fold 프롬프트 노출 조건**: 좁은 데스크톱(≤900px, fine pointer)에서도 표시 — 미디어쿼리를 coarse pointer 기준으로 분리.
7. **visual-capture 출력 경로**: 커밋된 `.omx/artifacts/...png`를 덮어쓰지 않도록 캡처를 `test-results/visual/`(비추적)로 저장, visual-diff.mjs가 그 경로를 읽게 갱신. 커밋된 아티팩트는 의도적 승격 시에만 교체.
8. 이 스펙 문서(`docs/rebuild-spec-phase-b.md`)를 커밋에 포함 (플랜→스펙→구현 체인 증빙).

## 검증 게이트 (각 단계 후)
- `npm run validate` 그린 (typecheck, lint, 147+ 유닛, 코퍼스, 레벨, 라이선스, 빌드, dist-smoke).
- B3 후: `npx playwright test --project=chromium` 그린 + 4개 방 골든 경로 실키보드 통과.
- 렌더-온리 경계: MemoryScene에서 simulation.step 외 입력 조작 없음 확인(lint-core는 core만 보므로 수동 확인).
