# Phase D 스펙 — 프로시저럴 오디오 (2026-08-20)

원칙: 에셋 파일 0 (WebAudio 합성만), 자동재생 정책 준수(첫 사용자 제스처에서 AudioContext resume), SOUND 토글 실동작(설정 저장), reduced-motion과 무관하지만 볼륨은 보수적으로. 렌더-온리 경계와 동일하게 "오디오는 상태를 구독만" — 시뮬레이션에 절대 개입 금지.

## 구조
- `src/audio/engine.ts`: AudioContext 관리, 마스터 게인, mute, 노드 팩토리(osc/noise/filter/env). 순수 브라우저 모듈(core 밖).
- `src/audio/score.ts`: 사운드 정의(주파수/엔벨로프/필터 파라미터를 데이터로).
- 연결: main.ts의 snapshot 핸들러에서 상태 전이 감지 → engine.trigger(name). MemoryScene은 건드리지 않음.

## 사운드 목록 (전부 합성)
- ambient: 저역 드론(사인 2개 디튠 + 저역필터 노이즈, 매우 작게), 방마다 근음 반음 차이로 진행감(crossing D, trace E♭, handoff F, lastHold G).
- record-start: 짧은 테이프 클릭 + 상승 글리산도(0.3s).
- fold: 시그니처 사운드 — 하강 후 리버스 스윕(0.7s, 시간 접힘 느낌: 피치 다운→업 미러).
- echo-materialize(리플레이 시작): 시안 시머(고역 사인 클러스터 + 느린 어택).
- winch/hold 루프: 저역 크리크(톱니파 저주파 + 필터 LFO), hold.active 동안만.
- push 루프: 돌 마찰(브라운 노이즈 + 저역필터), force>0 동안만.
- bridge/gate open: 둔탁한 스톤 임팩트(노이즈 버스트 + 저역 공진).
- carrier pickup/stage/deliver: 목질 노크 3종(피치 차이).
- success: 앰버 화음(장3화음 아르페지오, 따뜻한 저역 패드 0.9s).
- fail(rerecord): 하강 단2도(부드럽게, 벌주지 않는 톤).
- ending: 드론이 장화음으로 해결 + 고역 별빛 아르페지오(4s).
- UI: 버튼 포커스/클릭 微클릭(선택).

## 게이트
- validate 그린 + mute 토글 e2e 1개(aria-pressed + engine 상태) + 자동재생 경고 콘솔 0.
