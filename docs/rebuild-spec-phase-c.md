# Phase C 스펙 — 시네마틱 석실 비주얼 오버홀 (2026-08-20)

목표 이미지: `.omx/artifacts/visual-ralph/humanoid-redesign/reference-v1.png`.
읽는 법: 지배적인 따뜻한 키라이트(출구에서 유입) + 깊은 냉색 그림자 + 시안 액센트(패드/고스트) + 큰 석재 블록 아키텍처 + 화면의 1/5~1/6을 차지하는 캐릭터.
불변 조건: 렌더-온리 경계, 런타임 래스터 에셋 0(프로시저럴만), reduced-motion 존중, actorScreenPosition/E2E 계약 유지, 60fps 목표(최소 40fps).

## C1. 카메라·라이팅·포스트·성능 베이스 (최대 시각 델타 우선)
1. 성능 조사 먼저: scene instrumentation으로 드로우콜/프레임 타임 측정, 원인 규명(의심: 소형 메시 다수, adaptToDeviceRatio+FXAA+glow 조합). 정적 메시 재질별 MergeMeshes, material.freeze(), freezeActiveMeshes(). hardwareScaling 1.25→1.0(선명도 회복), 저성능 기기 적응형 폴백(프레임타임 측정 후 자동 강등).
2. 카메라: radius 18.4→13.5(lower/upper 12.5~14.5), beta 1.05→1.15(더 낮게), fov 0.7→0.78. 방별 타깃 오프셋 유지, 출구 오토포커스 유지.
3. 라이트 리그 재설계:
   - key DirectionalLight를 출구 방향에서 들어오게(따뜻함 1.0/0.62/0.30, intensity 2.6), 그림자 1024 + blurKernel 8.
   - hemispheric 1.05→0.35(냉색 스틸블루), ambientColor 소폭 상향.
   - 출구 광축: 가짜 볼류메트릭 콘 메시(additive 그라디언트 DynamicTexture, 카메라 페이싱 아님—고정) + 출구 PointLight 강화 + glow 포함. VolumetricLightScattering 포스트는 비용 문제로 배제.
   - temporal/living PointLight 강도·범위 재조정(핫스팟 제거, range 7).
4. 포스트: toneMapping ACES on, contrast 1.35, exposure 1.05, vignette(weight 2.2, 남색), bloom threshold 0.9→0.65 / weight 0.1→0.25 / kernel 16→48, FXAA 유지, samples는 성능 여유 시 4.
5. 타이틀 화면 무료 연출: !started 동안 카메라 alpha 저속 드리프트(reduced-motion 시 정지).

## C2. 아키텍처·재질 리빌드
1. 석재 텍스처 v2 (1024px): 러닝본드 대형 블록(가로 4~5개), 블록별 명도 변주, 모서리 다크닝(가짜 AO), 하단 습기 그라디언트, 간헐 이끼/청록 패치. 캔버스 높이맵→Sobel로 노멀맵 생성해 bumpTexture 적용(StandardMaterial 유지). specular 저강도.
2. 벽: 경계벽(뒤/왼쪽) 0.72→2.6~3.2유닛 진짜 석실 벽으로(카메라에 잘리는 앞/오른쪽은 낮게 유지해 가시성 확보). 내부 장애물 벽은 0.48 유지+bronze 캡.
3. 백드롭 정리: 부유 빔 제거, ruin-pillar를 벽에 붙은 두꺼운 기둥+아치 니치(어두운 인셋)로 교체, 시안 룬 슬릿은 패드 쪽 2~3개만. 출구 위 부서진 아치 실루엣.
4. 바닥: 대형 플래그스톤 텍스처, 저강도 스페큘러(빛 스트릭), bronze 인레이 유지. 균열/파편 소품 소량.
5. 방별 프롭 드레싱(B2 의미 반영): handoff-gate=포트컬리스 바, last-bridge-stone=거친 바위 클러스터, 윈치=로프 코일+스포크 디테일, 전달 크래들 명시적 수구.
6. 심연(chasm): 대비 심화, 시안 에지 슬림화, 저부 안개 그라디언트.

## C3. 캐릭터·이펙트·비트
1. 휴머노이드 v2: 비례(머리 축소, 몸통 연장, 부츠), 현재=앰버 튜닉+후드 실루엣(원뿔/캡슐 조합), 에코=additive 시안 + 수직 시머 + 사지 말단 페이드. 게이트 진폭·리드미컬 보폭 튜닝, 밀기 자세 lean-in, 윈치 crouch 유지.
2. 파티클: 광축 먼지 모트(~60개), 패스 전환 에코 머티리얼라이즈 버스트, fold 시간 접힘 링(토러스 스케일+페이드). reduced-motion 시 전부 정적/비활성.
3. 에코 잔상: trailPositions 데드코드를 실제 잔상(페이드 인스턴스)으로 되살리거나 완전 삭제 — 성능 보고 결정.
4. 마감: 죽은 코드 정리, 캡처 스크립트로 4개 방 스크린샷 산출(오케스트레이터 비주얼 리뷰용).

## 게이트
- 각 청크 후: validate 그린 + chromium e2e 그린 + 비스로틀 headed 캡처 4방(리뷰 제출).
- C1 후 performance-smoke 재실행: avg < 20ms 목표(현 37.9ms).
