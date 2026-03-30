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
[code.js] 프레임 감지 → exportAsync(PNG, preview) → base64 변환
    ↓ figma.ui.postMessage({ type: "selection-changed" })
[ui.html] 프레임 카드 누적 추가 + 스피너 표시
    ↓ figma.ui.postMessage({ type: "previews-done" })
[ui.html] 썸네일 img 업데이트
    ↓ 사용자가 "UX 검증 실행" 클릭
    ↓ parent.postMessage({ type: "export-frames-for-review" })
[code.js] 설정 scale로 재export
    ↓ figma.ui.postMessage({ type: "export-done" })
[ui.html] 컨텍스트 + base64 이미지 → API 호출
    ↓ API 응답
[ui.html] 결과 카드 표시 → 자동 스크롤
```

## UI 구조

### 1depth 탭 (공통 상단)
| 탭 | data-tab | 상태 |
|---|---|---|
| 검증 | `review` | 기본 활성 |
| 컨텍스트 | `context` | — |
| 설정 | `settings` | — |

탭 우측에 **전체 초기화 버튼** (순환 화살표 아이콘) — `selectedFrames` 초기화 + 결과/로딩 숨김.

---

### 검증 탭 (`#tab-review`)

**스크롤 영역 (위→아래)**
1. **프레임 그리드** (`#selection-info`)
   - 빈 상태: 안내 텍스트 표시
   - 프레임 있으면: 4열 grid, 각 카드에 번호 뱃지 + 썸네일 img (로딩 중 스피너) + 프레임명 + 개별 제거 버튼(×)
   - 최대 프레임 수 초과분은 누적 추가 시 무시
2. **활성 프리셋 배지** (`#active-preset-section`) — 프리셋 선택 시 표시
3. **검증 유형** select (`#review-type`)
   - `screen`: 화면 단위 UX 리뷰
   - `flow`: 플로우 검증
   - `localization`: 시장별 비교 검증
4. **타겟 시장** 칩 그룹 (JP / TH / TW, 복수 선택, toggle)
5. **추가 맥락** textarea (`#additional-context`, optional)
6. **로딩** (`#loading`) — 스피너 + 분석 중 텍스트
7. **결과 카드** (`#result-area`)
   - 헤더: 상태 dot + 제목 + 복사 버튼
   - 본문: `pre-wrap` 텍스트 (최대 360px, 내부 스크롤)
   - 피드백 영역: textarea + 재검증 버튼 (성공 시만 표시, 피드백 입력 시 활성화)
   - 푸터: "새 검증" 버튼 (clearAll) / "재검증" 버튼

**하단 고정 푸터**: UX 검증 실행 버튼 (`#btn-review`, 프레임 없으면 disabled)

---

### 컨텍스트 탭 (`#tab-context`)

**프리셋 바** (스크롤 밖, 상단 고정)
- Row 1: 프리셋 드롭다운 (`#preset-select`) + 삭제 버튼 (기존 프리셋 선택 시만 표시)
  - 옵션: "── 프리셋 없음 ──" / "➕ 새 프리셋 만들기" / 저장된 프리셋 목록
- Row 2: 새 프리셋 이름 입력 + 저장 버튼 ("새 프리셋 만들기" 선택 시만 표시)

**스크롤 영역** — 5개 접이식(collapsible) 섹션
| 섹션 id | 필드 id | 내용 |
|---|---|---|
| `ctx-principles` | `#field-principles` | UX 원칙 |
| `ctx-accessibility` | `#field-accessibility` | 접근성 기준 |
| `ctx-scenarios` | `#field-scenarios` | 유저 시나리오 |
| `ctx-market` | `#field-market` | 시장별 고려사항 |
| `ctx-extra` | `#field-extra` | 기타 제약 조건 |

각 섹션: 헤더 클릭 → `.collapsed` 토글, max-height 0 ↔ 300px 전환.

**하단 고정 푸터**: "컨텍스트 저장" / "프리셋 업데이트" 버튼 (프리셋 선택 상태에 따라 텍스트 변경)

---

### 설정 탭 (`#tab-settings`)

**스크롤 영역**
1. **API 상태 배너** (`#settings-status`) — 연결 상태에 따라 초록/빨강
2. **API 연결 그룹**
   - 프로바이더 select (`#api-mode`): `anthropic` / `openai` / `gateway` / `bedrock`
   - 조건부 필드 (선택에 따라 show/hide):
     - `anthropic` → API Key (`#api-key`)
     - `openai` → OpenAI API Key (`#openai-api-key`)
     - `gateway` → Gateway URL (`#gateway-url`) + PAT 토큰 (`#gateway-pat`)
     - `bedrock` → Bedrock Proxy URL (`#bedrock-proxy-url`)
3. **모델 그룹** — 프로바이더별 옵션 동적 변경
   - `anthropic`/`bedrock`: Claude Sonnet 4 / Claude Opus 4
   - `openai`: GPT-4o / GPT-4.1
   - `gateway`: GPT-4o / GPT-4.1 / Claude Sonnet 4.6 / Claude Opus 4.6
4. **Export 설정 그룹**
   - 스크린샷 해상도: 1x(기본) / 1.5x / 2x
   - 최대 프레임 수: 3 / 6 / 8(기본)
5. **언어 그룹**: 한국어(`ko`) / English(`en`) — 변경 즉시 UI 반영, 저장은 별도

**하단 고정 푸터**: 설정 저장 버튼

---

## State 구조

```js
// 프레임 선택 목록 (누적)
let selectedFrames = [];           // [{ id, name, imageBase64 }]

// 재검증용 직전 파라미터
let lastReviewParams = null;       // { frames, reviewType, markets, additionalContext }
let lastResultText = "";           // 직전 결과 텍스트 (재검증 시 이전 분석으로 포함)

// 컨텍스트 프리셋
let presets = {};                  // { [name]: { principles, accessibility, scenarios, market, extra } }
let activePreset = null;           // 현재 선택된 프리셋 이름 (null = 없음)

// 설정
let settings = {
  apiMode: "anthropic",            // "anthropic" | "openai" | "gateway" | "bedrock"
  apiKey: "",
  bedrockProxyUrl: "",
  openaiApiKey: "",
  gatewayUrl: "",
  gatewayPat: "",
  model: "claude-sonnet-4-20250514",
  exportScale: "1",
  maxFrames: 8,
  lang: "ko",                      // "ko" | "en"
};

// 컨텍스트 필드값 (기본값 내장)
let contextData = {
  principles: "...",
  accessibility: "...",
  scenarios: "",
  market: "...",
  extra: "",
};
```

> **TODO (A/B 기능 추가 시)**: `reviewCtx`, `abCtx`, `abFrames` 상태 분리 필요.

---

## 프리셋 시스템

**동작 흐름:**
1. 드롭다운에서 "새 프리셋 만들기" 선택 → 이름 입력행 표시
2. 이름 입력 후 저장 → `presets[name] = readContextFields()` → `storageSet("ux-review-presets", presets)`
3. 기존 프리셋 선택 → `fillContextFields(presets[name])` + `contextData` 업데이트 + 삭제 버튼 표시
4. 저장 버튼이 "프리셋 업데이트"로 변경됨 (activePreset 기준)
5. 검증 탭 상단에 활성 프리셋 배지 표시 (`컨텍스트: {name}`)
6. "없음" 선택 → activePreset = null, 배지 숨김

**프리셋 데이터 구조:**
```js
{
  "LINE Messenger": {
    principles: "...",
    accessibility: "...",
    scenarios: "...",
    market: "...",
    extra: "...",
  }
}
```

---

## Figma 메시지 핸들러

### 수신 (`window.onmessage`)
| type | 처리 |
|---|---|
| `selection-changed` | 기존 id 중복 제외 후 새 프레임 누적 → `appendFrameCards()` |
| `selection-cleared` | 무시 (빈 곳 클릭 시 기존 목록 유지) |
| `previews-done` | `updateFramePreviews()` — img src 설정, 스피너 숨김 |
| `export-done` | `runAPICall(msg.frames)` — API 호출 실행 |
| `export-error` | 로딩 숨김 + 오류 카드 표시 |
| `storage-get-done` | `storageCallbacks[msg.key](msg.value)` — Promise resolve |

### 송신 (`parent.postMessage`)
| type | 페이로드 | 시점 |
|---|---|---|
| `export-frames-for-review` | `{ frameIds, scale }` | 검증 실행 버튼 클릭 |
| `storage-set` | `{ key, value }` | 설정/컨텍스트/프리셋 저장 |
| `storage-get` | `{ key }` | init() 및 필요 시 |

---

## 스토리지 키

| 키 | 저장 내용 |
|---|---|
| `ux-review-settings` | API 설정, 모델, export scale, maxFrames, lang |
| `ux-review-context` | 컨텍스트 5개 필드값 (기본 컨텍스트) |
| `ux-review-presets` | 프리셋 목록 `{ [name]: contextData }` |

> **TODO (A/B 기능 추가 시)**: `ux-review-ctx` (UX Review 전용), `ux-ab-ctx` (A/B 전용), `ux-ctx-presets` (공유) 키로 분리 예정.

---

## API 연동

### 프로바이더별 처리
- **anthropic** / **bedrock**: `callClaudeAPI()` → Anthropic Messages API 포맷
  - anthropic: `x-api-key` 헤더 + `anthropic-version` + `anthropic-dangerous-direct-browser-access`
  - bedrock: URL만 설정, 헤더 없음 (프록시가 인증 처리)
- **openai** / **gateway**: `callOpenAICompatAPI()` → OpenAI Chat Completions 포맷
  - `Authorization: Bearer {token}`
  - gateway URL 기반으로 `/chat/completions` append

### 프롬프트 빌드
- `buildSystemPrompt()`: contextData 5개 필드 → 마크다운 시스템 프롬프트, 언어 지시 포함
- `buildUserPrompt(reviewType, markets, additionalContext, frames)`: 검증 유형별 분석 지시 + 프레임명 목록
- 이미지: `content[]` 배열에 base64 PNG (Anthropic) 또는 `image_url` (OpenAI)

### 재검증 (Re-review)
- 이전 결과 텍스트 + 디자이너 피드백을 `additionalContext`에 합쳐서 동일 API 재호출
- 피드백 입력 시에만 재검증 버튼 활성화

---

## 디자인 토큰

| 토큰 | 값 | 용도 |
|---|---|---|
| Primary Green | `#06C755` | 브랜드 컬러, 활성 탭, CTA, 스피너 |
| Background | `#2c2c2c` | 전체 배경 |
| Surface | `#363636` | 카드, 설정 그룹 |
| Border | `#3a3a3a` / `#444` | 구분선, 입력 테두리 |
| Text Primary | `#e0e0e0` | 기본 텍스트 |
| Text Secondary | `#888` / `#999` | 보조 텍스트, 레이블 |
| Text Disabled | `#555` / `#666` | placeholder, 비활성 |
| Error Red | `#ff6b6b` | 오류 상태 |
| Border Radius | `8px` | 카드, 입력, 버튼 |
| Border Radius (chip) | `100px` | 시장 칩 |
| Scrollbar | `4px`, `#555` | 모든 스크롤 영역 |

**컴포넌트 스타일:**
- 모든 탭 패널: `display:flex; flex-direction:column; height:100vh` — 스크롤 영역 + 하단 고정 푸터 구조
- 입력 포커스: `border-color: #06C755`
- 버튼 disabled: `background: #444; color: #666`
- 섹션 간격: `margin-bottom: 20px`
- 카드 내부 padding: `16px`

---

## i18n

한국어(`ko`) / 영어(`en`) 2개 언어 지원. `i18n` 객체에 키-값으로 관리.
- 정적 문자열: `data-i18n` 속성으로 DOM 바인딩
- placeholder: `data-i18n-ph` 속성
- 함수형 (보간 필요): `t("loading_sub")(n)` 형태로 호출
- 언어 변경: `settings.lang` 업데이트 → `applyI18n()` 즉시 호출

---

## TODO (향후 작업)

### 1. A/B 검증 기능 추가
- 검증 탭에 "UX 리뷰" / "A/B 검증" 2depth 서브탭 추가
- A/B 탭: 두 버전의 프레임 각각 배정 (A 슬롯 / B 슬롯) 방식으로 수정
  - 현재 단일 `selectedFrames`를 `reviewFrames` / `abFrames`로 분리
- 컨텍스트 탭도 UX Review / A/B 각각 독립 패널로 분리
  - 스토리지 키: `ux-review-ctx`, `ux-ab-ctx` 분리, 프리셋은 `ux-ctx-presets` 공유

### 2. 리포트 생성 기능
- 검증 결과를 구조화된 문서 포맷(Markdown / HTML)으로 export
- 프레임 썸네일 + 검증 결과 조합

### 3. Confluence 연동
- 생성된 리포트를 Confluence 페이지로 자동 발행
- Confluence REST API + PAT 토큰 인증

---

## 참고
- 이 플러그인은 기존 UI QA 플러그인과 별도 프로젝트
- UI QA 플러그인의 아키텍처(Bedrock 연동, 이미지 export 패턴)를 참고 가능
- `ux-review-context.md`는 팀원에게 전달할 컨텍스트 패키지 샘플
