# UX Review Figma Plugin

## 프로젝트 개요
피그마에서 프레임을 선택하면 Claude Vision API를 통해 UX 검증을 자동으로 수행하는 피그마 플러그인.

## 파일 구조
```
ux-review-plugin/
├── manifest.json          # 피그마 플러그인 설정
├── code.js                # 메인 스레드 (샌드박스) — 프레임 감지, PNG export
├── ui.html                # UI (iframe) — 검증 설정, API 호출, 결과 표시
├── ux-review-context.md   # UX 검증 컨텍스트 패키지 샘플
└── CLAUDE.md              # 이 파일
```

## 아키텍처

### 피그마 플러그인 이중 환경
- **code.js (메인 스레드)**: 피그마 API 접근 가능. DOM 접근 불가. `figma.ui.postMessage()`로 UI와 통신.
- **ui.html (iframe)**: DOM/네트워크 접근 가능. 피그마 API 접근 불가. `parent.postMessage()`로 메인 스레드와 통신.

### 데이터 플로우
```
[피그마 캔버스] 프레임 선택
    ↓ figma.on("selectionchange")
[code.js] 프레임 감지 → exportAsync(PNG, 1x) → base64 변환
    ↓ figma.ui.postMessage()
[ui.html] 썸네일 표시 + 검증 설정 UI
    ↓ 사용자가 "UX 검증 실행" 클릭
[ui.html] 컨텍스트 패키지 + base64 이미지 → Claude API 호출
    ↓ API 응답
[ui.html] 결과 카드에 표시 → 자동 스크롤
```

## 핵심 스펙

### 프레임
- 대상: 아이폰 화면 (375×812)
- Export: PNG, 1x 해상도
- 최대: 6장 (3×2 그리드 썸네일)
- 선택 즉시 썸네일 프리뷰 표시 (TODO: 현재 미구현)

### 검증 유형 3가지
1. **화면 단위 UX 리뷰**: 프레임 1장 + 시나리오 → 마찰 지점/개선안
2. **플로우 검증**: 프레임 2-6장 연속 → 단계 수/이탈 지점/연결성
3. **시장별 비교 검증**: 동일 화면 시장별 버전 → JP/TH/TW 적합성

### 타겟 시장
- JP (일본): 정보 밀도 높음, 텍스트 중심
- TH (태국): 비주얼/컬러풀 선호, 텍스트 간결
- TW (대만): JP 유사, Traditional Chinese 텍스트 영역 여유

### API
- **Anthropic Direct**: `https://api.anthropic.com/v1/messages` + API Key
- **AWS Bedrock**: 사내 프록시 서버 경유 (별도 세팅 필요)
- 모델: Claude Sonnet 4 (기본) / Claude Opus 4

### UI 구조 (3탭)
- **검증 탭**: 프레임 썸네일 그리드 → 검증 유형/시장 선택 → 실행 버튼(하단 고정) → 결과 카드
- **컨텍스트 탭**: 5개 섹션별 입력 (UX 원칙, 접근성, 유저 시나리오, 시장별 고려사항, 기타) → 저장 버튼(하단 고정)
- **설정 탭**: API 연결, 모델, Export 설정 → 저장 버튼(하단 고정)

## TODO (다음 단계)

### 1. 선택 즉시 썸네일 표시
- `selectionchange` 이벤트에서 바로 `exportAsync()` 호출
- export된 base64 이미지를 UI에 전송하여 썸네일 `<img>` 태그에 반영
- 성능 고려: 6장 동시 export 시 딜레이 가능 → 순차 처리 또는 로딩 표시

### 2. ui.html 실제 플러그인용으로 전환
- 프리뷰용 목업 데이터/데모 로직 제거
- 피그마 메시지 수신 (`window.onmessage`) 연결
- `callClaudeAPI()` 함수에서 실제 API 호출 구현
- Bedrock 프록시 모드 구현 (사내 환경에 맞게)

### 3. 프롬프트 빌드
- 컨텍스트 탭의 5개 섹션 내용을 조합하여 마크다운 프롬프트 생성
- 검증 유형별 프롬프트 템플릿 적용
- 이미지는 `content[]` 배열에 base64로 포함

### 4. 저장/불러오기
- 컨텍스트, 설정 데이터를 `figma.clientStorage`에 저장
- 프리뷰에서 쓰던 `localStorage` 대신 피그마 전용 스토리지 사용

## 디자인 토큰
- Primary Green: #06C755 (LINE 브랜드)
- Background: #2c2c2c (피그마 다크 테마)
- Surface: #363636
- Border: #3a3a3a, #444
- Text Primary: #e0e0e0
- Text Secondary: #888, #999
- Border Radius: 8px (카드), 6px (썸네일), 100px (칩)

## 참고
- 이 플러그인은 기존 UI QA 플러그인과 별도 프로젝트
- UI QA 플러그인의 아키텍처(Bedrock 연동, 이미지 export 패턴)를 참고 가능
- `ux-review-context.md`는 팀원에게 전달할 컨텍스트 패키지 샘플
