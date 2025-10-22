# Pouch It POC - 프로젝트 컨텍스트

## 📱 프로젝트 개요

**프로젝트명:** `pouch-it-poc` (Pouch It - Proof of Concept)
**목적:** 모바일 기기의 스크린샷을 자동으로 감지, 압축, 업로드하는 React Native 애플리케이션

### 핵심 기능

- ✅ 기기 갤러리에서 스크린샷 자동 스캔 및 감지
- ✅ 이미지 압축 (expo-image-manipulator 사용)
- ✅ 배치 업로드 (BATCH_SIZE = 20)
- ✅ 병렬 업로드 지원 (토글 가능)
- ✅ 백그라운드 업로드 태스크 (expo-background-fetch + TaskManager)
- ✅ 업로드 상태 영구 저장 (MMKV 기반)
- ✅ 포그라운드/백그라운드 모두에서 작동
- ✅ 업로드 큐 및 진행률 추적

---

## 🏗️ 기술 스택

### 핵심 프레임워크

- **React Native:** 0.81.4
- **Expo SDK:** ~54.0.13
- **React:** 19.1.0
- **Expo Router:** 6.0.11 (파일 기반 라우팅)
- **TypeScript:** 5.9.2 (strict mode)

### 주요 라이브러리

| 용도          | 라이브러리                               | 버전           |
| ------------- | ---------------------------------------- | -------------- |
| 상태 관리     | react-native-mmkv                        | 3.3.3          |
| 애니메이션    | react-native-reanimated                  | ~4.1.1         |
| 네비게이션    | @react-navigation/bottom-tabs            | 7.4.0          |
| HTTP          | axios                                    | 1.12.2         |
| 이미지        | expo-image, expo-image-manipulator       | 3.0.9, 14.0.7  |
| 카메라/갤러리 | expo-camera, expo-media-library          | 17.0.8, 18.2.0 |
| 백그라운드    | expo-background-fetch, expo-task-manager | 14.0.7         |
| 파일 시스템   | expo-file-system                         | 19.0.17        |

### 아키텍처 특징

- **New Architecture 활성화:** React Native의 새 아키텍처 사용
- **React Compiler 실험:** 성능 최적화 실험
- **Typed Routes:** 안전한 라우트 타입 체크
- **MMKV 스토리지:** 동기식 고속 key-value 스토리지

---

## 📂 프로젝트 구조

```
pouch-it-poc/
├── app/                           # Expo Router 화면 (자동 라우팅)
│   ├── _layout.tsx               # 루트 레이아웃 + 네비게이션 설정
│   └── index.tsx                 # 메인 업로드 화면 (400+ 라인)
│
├── services/                      # 비즈니스 로직 (핵심 모듈)
│   ├── media.ts                  # 스크린샷 검색 및 갤러리 접근
│   ├── permissions.ts            # 카메라 & 갤러리 권한 관리
│   ├── unifiedUpload.ts          # 메인 업로드 로직 (560+ 라인)
│   │                             #   - 이미지 압축
│   │                             #   - 배치 처리
│   │                             #   - Axios vs FileSystem API 선택 가능
│   ├── uploadQueue.ts            # 업로드 큐 관리 (MMKV)
│   ├── uploadDB.ts               # 업로드 상태 저장 (MMKV)
│   ├── upload.ts                 # 업로드 래퍼/파사드
│   ├── backgroundUpload.ts       # 백그라운드 태스크 등록
│   └── settings.ts               # 앱 설정 (MMKV)
│
├── components/                    # 재사용 가능 UI 컴포넌트
│   ├── ui/                       # UI 전용 컴포넌트들
│   ├── themed-text.tsx           # 테마 지원 텍스트
│   ├── themed-view.tsx           # 테마 지원 컨테이너
│   └── ...
│
├── constants/                     # 설정 상수
│   ├── config.ts                 # API 엔드포인트 설정
│   └── theme.ts                  # 테마/색상 정의
│
├── hooks/                         # 커스텀 React 훅
│   ├── use-color-scheme.ts       # 색상 스킴 (light/dark)
│   └── use-theme-color.ts        # 테마 색상
│
├── assets/                        # 이미지 & 아이콘
├── ios/                          # 네이티브 iOS 프로젝트
├── .claude/                      # Claude Code 설정
│   └── settings.local.json       # 로컬 권한 설정
├── app.json                      # Expo 앱 설정
├── tsconfig.json                 # TypeScript 설정
├── eslint.config.js              # ESLint 설정
└── package.json                  # 의존성 & 스크립트
```

---

## 🔄 주요 아키텍처 패턴

### 1. 서비스 지향 아키텍처 (Service-Oriented Architecture)

- `services/` 디렉토리에 비즈니스 로직을 명확히 분리
- 각 서비스가 단일 책임을 가짐
- UI 로직과 비즈니스 로직의 완전한 분리

### 2. 파일 기반 라우팅 (Expo Router)

- `app/` 디렉토리 구조가 자동으로 라우팅 구조로 변환
- Type-safe 라우팅 지원
- 딥링킹 지원 (scheme: `pouchitpoc://`)

### 3. MMKV를 활용한 상태 관리

```typescript
// uploadDB.ts - 업로드된 스크린샷 추적
// uploadQueue.ts - 업로드 큐 관리
// settings.ts - 앱 설정 저장
```

- 동기식 접근으로 성능 최적화
- 앱 재시작 후에도 상태 유지

### 4. 하이브리드 HTTP 전략 (A/B 테스트 가능)

```typescript
// unifiedUpload.ts
const USE_AXIOS = true; // true: axios, false: FileSystem API
```

- Axios: 빠른 속도
- FileSystem API: 백그라운드 안정성
- 같은 압축/배치 로직, 다른 전송 방식

### 5. 백그라운드 업로드 태스크

- `expo-background-fetch` + `expo-task-manager`로 정기적 업로드
- AppState 모니터링으로 포그라운드/백그라운드 전환 감지
- 큐에 남은 파일을 자동으로 업로드

### 6. 이미지 처리 파이프라인

```typescript
// unifiedUpload.ts의 핵심 플로우:
1. media.ts에서 스크린샷 스캔
2. 20개 단위로 배치 생성 (BATCH_SIZE = 20)
3. expo-image-manipulator로 압축
4. Axios 또는 FileSystem으로 업로드
5. 성공/실패 상태를 uploadDB에 저장
6. 실패한 항목은 uploadQueue에 재추가
```

---

## 📡 API 설정

### 엔드포인트

- **Base URL:** `https://pouchit-api-dev-production.up.railway.app`
- **Screenshot Upload:** `POST /api/v3/screenshots`
- **Backend:** Railway.app 호스팅

### 사용자

- **Guest User ID:** `123e4567-e89b-12d3-a456-426614174000` (기본값)
- 익명 사용자도 업로드 가능한 구조

---

## 🚀 주요 개발 포인트

### 수정된 파일: `services/media.ts`

- 스크린샷 감지 및 갤러리 접근 로직
- 권한 처리
- 파일 필터링

### 중요한 상수들

- **BATCH_SIZE = 20:** 한 번에 업로드할 이미지 개수
- **COMPRESSION_QUALITY:** 이미지 압축 레벨
- **PARALLEL_UPLOADS:** 병렬 업로드 여부

### 개발 시 주의사항

1. **권한 처리:** 카메라/갤러리 권한 필수 (iOS/Android 모두)
2. **메모리 관리:** 대량 이미지 처리 시 메모리 누수 주의
3. **배터리 사용:** 백그라운드 업로드는 배터리 소모 고려
4. **네트워크 상태:** 오프라인 시 업로드 큐에 저장
5. **TypeScript:** strict mode이므로 타입 안전성 중요

---

## 🛠️ 유용한 명령어

```bash
# 개발 시작
yarn start

# 린트 체크
yarn lint

# iOS 빌드
yarn ios

# Android 빌드
yarn android

# 프로젝트 설정
yarn prebuild
```

---

## 📊 프로젝트 특징

- ✅ **Early Adoption:** React Native New Architecture 활용
- ✅ **Strict TypeScript:** 엄격한 타입 체킹
- ✅ **Modern React:** React 19 사용
- ✅ **Korean Development:** 한글 주석 포함
- ✅ **POC 단계:** 개념 증명 프로젝트로 시작

---

## 📝 기타 정보

- **현재 상태:** main 브랜치
- **최근 커밋:** 백그라운드 로그, 압축 병렬화 관련
- **수정 대기:** services/media.ts 파일
