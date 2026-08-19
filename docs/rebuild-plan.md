# I WAS, SO I AM — 본선 진출 리빌드 플랜 (2026-08-19)

목표: OpenAI Game Builders Seoul 2026 예선 통과 (top 40). 제출 마감 **8/26**, 심사 8/27.
심사 기준: Playability · Originality · Codex Collaboration · Release Potential · Presentation.

확정 결정 (2026-08-19, 오너):
- 공개 타이틀 **「I WAS, SO I AM」 유지**. 코드네임 echofold 흔적만 전면 제거.
- 아트 방향: **시네마틱 석실** — reference-v1.png 컨셉아트를 인엔진 목표로. 프로시저럴 유지(런타임 래스터 금지 정책 유지).
- 스코프: 4개 방 유지 + **퍼즐 재설계 포함** (방 추가 없음).
- 오디오: **WebAudio 프로시저럴 합성** (에셋 파일 0).

## 검증된 진단 (4영역 매핑 + 적대적 검증 완료)

### 강점 (지킬 것)
- 결정론 30Hz 코어 + 테이프 리플레이: 견고. 147 유닛테스트, 100케이스 코퍼스가 30/60/144Hz 체크섬 동일성을 Node+브라우저 3엔진에서 증명. 이 아키텍처는 Codex Collaboration 스토리의 핵심 증거.
- 타이틀 화면 타이포/카피, 앰버=현재·시안=과거 색 언어, 한/영 이중언어.
- Codex 협업 흔적 풍부(.codex/config.toml MCP, imagegen 프로비넌스, 게이트 문서) — 단, 심사용 내러티브로 큐레이션 안 됨.

### 치명 문제 (직접 재현 + 코드 검증됨)
1. **튜토리얼**: 체크리스트를 그대로 따라도 실패(오너·Fable 각자 재현). 원인: (a) 기록이 고정 길이라 조기 종료 불가 → 실패 1회당 ~16-20초 강제 루프, (b) 튜토리얼 스테이지가 거리·tapeTick 매직넘버(92/82/172)로 판정돼 실제 상태와 어긋남, (c) 렌더 레이어가 입력을 조작하는 자동 빨리감기(completeCrossingTutorialHold)가 무설명 시간점프 유발, (d) lastError 표시 UI가 CSS로 숨겨져 있음(style.css:78), (e) handoff/lastHold는 튜토리얼 카피 자체가 없음.
2. **그래픽**: 전부 MeshBuilder 프리미티브+StandardMaterial, 텍스처는 스톤 DynamicTexture 1장. hardwareScaling 1.25 다운스케일(흐릿함), 그림자 512px 1개, samples=1. 컨셉아트와 갭 극대. ~~성능도 나쁨: 평균 37.9ms(≈26fps)~~ → **정정(C1, 2026-08-20)**: 37.9ms는 헤드리스 크로미움의 SwiftShader(CPU) 폴백 측정 아티팩트. 실제 GPU(M5 Pro) 8.3ms(120Hz vsync 상한), 픽셀/패스 바운드이며 지오메트리 비용 0 — 비주얼 예산 여유 큼.
3. **퍼즐 깊이**: Last Hold는 Crossing의 플래그 리스킨(둘 다 hold→door→exit). 실패 조건이 전 방 공통 타임아웃 하나뿐. 결정 포인트 없음, 해법 1개 고정.
4. **구조적 제약**: applyInteractions 단일 함수(102줄)에 전 메커니즘 인라인. door는 hold에만 하드커플, forceObject는 오른쪽 단방향 전용, chambers의 radius 필드는 데드 데이터(시뮬은 상수 사용), ActionPressed 비트 미사용, 대각선 이동 √2배 빠름(정규화 없음).
5. **품질 갭**: `npm run validate`는 E2E를 안 돌림. 모든 브라우저 테스트가 dev 서버 대상 — **프로덕션 빌드를 실행하는 자동 테스트가 0개**. E2E는 좌표 매직넘버(230/235/240)와 한국어 카피 문자열에 강결합 → 이번 개편으로 대량 파손 예정. Math.hypot 크로스엔진 결정론 위험.
6. **오디오 전무** + 죽은 SOUND 토글. favicon 404.
7. **git 커밋 0개** — 개발 과정 증빙이 커밋 이력에 없음.

### 알려진 함정 (작업 시 주의)
- 테이프는 chamberVersion에 엄격 잠금 → 방 데이터 수정 시 골든 테이프 전부 재작성 필요. 골든은 프레임 단위 수작업이라 상수 튜닝에도 침묵 파손.
- tapeDurationTicks ≤ 14s×30 유닛테스트 제약(core.test.ts:86-91, production-journey.test.ts:41-43).
- E2E 스로틀: webdriver 감지 시 8fps 렌더 — E2E 스크린샷은 실제 룩 증거가 아님.
- reuseExistingServer로 스테일 서버 테스트 위험. 포트 4173이 3곳에 하드코딩.
- `__I_WAS_SO_I_AM__` 전역·localStorage 키·한국어 카피가 E2E/스크립트 전반의 로드베어링 문자열.

## 실행 페이즈

### Phase A — 파운데이션 (즉시)
- EchofoldScene.ts → MemoryScene.ts 파일명 정리(클래스는 이미 MemoryScene), import 수정, 문서 내 echofold 코드네임 정리.
- favicon(SVG 데이터 URI, 에셋 0 정책 유지), 404 제거.
- validate 그린 확인.

### Phase B — 코어 게임플레이 & 튜토리얼 (D1-3)
- **조기 기록 종료**: 기록 중 확정 키(Enter/长按 ACT 등)로 테이프를 현재 틱에서 종료. 실패 루프 16-20s → 수초로.
- 시뮬 리팩터: 메커니즘 모듈화(hold/force/handoff/door 독립), door를 임의 메커니즘에 게이트 가능하게, forceObject 양방향, 대각선 정규화, Math.hypot 제거, 데드 코드(ActionPressed, frozenSuccess, trail) 정리.
- 튜토리얼 재설계: 스테이지를 매직넘버가 아닌 실제 심 상태(targetId, hold.active, door.open 등)에서 유도. 체크리스트 실시간 체크. 자동 빨리감기를 "시간 접기" 명시 연출로 재정의하거나 제거. lastError 노출. handoff/lastHold 전용 카피 작성. R 전역 캡처 버그 수정.
- 퍼즐 재설계: Last Hold를 Crossing 리스킨에서 탈피(멀티 메커니즘 결합 + 이별 연출 강화), Handoff에 경로 선택 도입, 실패에 이유 있는 피드백.
- 골든 테이프 재작성 + 코퍼스 4개 방 전체로 확장 + 유닛/E2E 테스트 갱신.

### Phase C — 비주얼 오버홀 (D3-5) — 목표: reference-v1.png
- 병목 조사 후 성능 예산 확보(현 26fps 원인 규명).
- 카메라: 더 가깝고 낮은 시네마틱 프레이밍, 방별 구도.
- 라이팅: 출구 광축(볼류메트릭 느낌), 키/필 재설계, 그림자 1024+, SSAO2, 컬러그레이딩(ACES·비네트), 블룸 재튜닝.
- 재질: 프로시저럴 PBR(노멀/러프니스 DynamicTexture), 석재 대형 블록 아키텍처로 벽 재구축(네온 슬랩 제거), 바닥 반사/습기.
- 캐릭터: 인체 비례 개선, 의상 실루엣, 포즈·게이트 애니메이션 커브 개선, 에코 고스트 셰이더 강화.
- 파티클: 먼지 모트, 시간접기 이펙트, 에코 잔상.
- hardwareScaling 1.0(적응형 폴백), samples 상향.

### Phase D — 오디오 (D5)
- WebAudio 합성 엔진: 앰비언트 드론, SFX(기록 시작/종료/시간접기/윈치/다리/밀기/성공/실패/엔딩). SOUND 토글 실동작.

### Phase E — 제출 (D6-7)
- 프로덕션 빌드 E2E(VITE_E2E 빌드 대상) 추가, validate에 E2E 서브셋 포함.
- 배포(공개 URL), OG 메타+썸네일(reference-v1 16:9), 설명 ≤200자.
- Codex Collaboration 내러티브 문서(기존 증빙 큐레이션), 데모 영상(≤3분) 소재·스토리보드.
- 신선한 눈 플레이테스트(오너 지인 등) — PRD 열린 게이트.

## 진행 규칙
- 결정론 코어의 렌더-온리 경계 유지(입력 조작 제거 포함).
- 커밋/푸시는 오너 승인 후에만. 승인 시 작업 단위 커밋으로 개발 과정 증빙 축적.
- 각 페이즈 종료마다 실플레이 검증(Playwright headed) + 스크린샷 비교.
