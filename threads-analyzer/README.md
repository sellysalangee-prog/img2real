# 스레드 분석 (Threads Analyzer)

내 Threads 계정을 연결해 글의 성과를 분석하고, 댓글로 만난 사람들을 대신 기억해 주는 웹앱입니다.

| 탭 | 기능 |
|---|---|
| 댓글함 | 답할 댓글 모아 보기, 댓글 옆 인물 카드, 답글 실수 검사, 바로 답글 올리기 |
| 사람 | 댓글로 만난 사람 목록과 검색, 인물 카드(AI 자동 기록 + 직접 수정), 메모, 주고받은 댓글 |
| 분석 | 요약 지표, 게시글 목록, 시간대 히트맵, 글 특징별 비교, AI 분석 |

## 설치 순서

### 1. Meta 개발자 앱 만들기

1. https://developers.facebook.com/apps 에서 **앱 만들기**를 누릅니다.
2. 사용 사례에서 **Threads API 액세스**를 선택합니다.
3. **사용 사례 → 맞춤 설정 → 권한**에서 아래 5개를 추가합니다.
   - `threads_basic`, `threads_manage_insights`, `threads_read_replies`
   - `threads_content_publish`, `threads_manage_replies` (답글 올리기용)
4. **앱 역할 → 역할 → Threads 테스터 추가**에서 내 Threads 계정을 추가합니다.
5. Threads 앱에서 **설정 → 계정 → 웹사이트 권한 → 초대**로 가서 초대를 수락합니다.
6. **사용 사례 → 맞춤 설정 → 설정**에서 Threads 앱 ID와 앱 시크릿 코드를 확인합니다.

### 2. Claude API 키 받기

https://console.anthropic.com 에서 API 키를 만듭니다. 인물 정보 정리, 답글 검사, AI 분석에 사용됩니다.

### 3. Vercel에 배포하기

1. https://vercel.com 에 GitHub 계정으로 로그인합니다.
2. **Add New → Project**에서 이 저장소를 고르고, **Root Directory**를 `threads-analyzer`로 지정합니다.
3. **Environment Variables**에 아래 값을 넣고 Deploy를 누릅니다.

| 이름 | 값 |
|---|---|
| `THREADS_APP_ID` | Threads 앱 ID |
| `THREADS_APP_SECRET` | Threads 앱 시크릿 코드 |
| `APP_URL` | 배포 주소 (예: `https://my-threads.vercel.app`, 끝에 `/` 없이) |
| `SESSION_SECRET` | 32자 이상 무작위 문자열. **한 번 정하면 바꾸지 마세요** (저장된 토큰을 풀 때 씁니다) |
| `CRON_SECRET` | 무작위 문자열 (하루 1회 자동 수집 보호용) |
| `ANTHROPIC_API_KEY` | Claude API 키 |
| `MAX_POSTS` | (선택) 분석할 최근 글 수, 기본 150 |

### 4. 데이터베이스 연결

1. Vercel 프로젝트의 **Storage** 탭 → **Create Database** → **Neon (Postgres)** 를 고릅니다. 무료 플랜이면 충분합니다.
2. 프로젝트에 연결하면 `DATABASE_URL`이 자동으로 들어갑니다.
3. **Deployments**에서 최신 배포를 **Redeploy** 합니다.

표는 첫 접속 때 자동으로 만들어집니다.

### 5. 콜백 주소 등록

Meta 앱 설정의 Threads 설정에 아래 주소를 입력합니다.

- 리디렉션 콜백 URL: `https://<배포주소>/api/auth/callback`
- 제거 콜백 URL, 삭제 콜백 URL: `https://<배포주소>/`

### 6. 사용

배포 주소에 접속해 **Threads로 연결하기**를 누릅니다. 처음 연결하면 최근 30일 글의 댓글을 자동으로 모으고 사람별 정보를 정리합니다.

이전 버전에서 이미 연결했다면 답글 권한이 없으므로 **연결 해제 → 다시 연결**해 주세요.

## 인물 기억은 이렇게 동작합니다

- 하루 한 번(한국 시간 오전 6시) 최근 30일 글의 댓글을 자동으로 모읍니다. 댓글함의 **새 댓글 가져오기**로 바로 모을 수도 있습니다.
- 한 번에 최대 12명씩 정보를 정리하고, 남은 사람은 다음 수집 때 이어서 정리합니다.
- AI는 댓글 작성자가 **직접 밝힌 정보만** 기록합니다. 건강, 종교, 정치 성향, 금융 정보, 연락처 등은 기록하지 않습니다.
- 새 댓글이 기존 정보와 다르면 예전 정보는 "지난 정보"로 옮깁니다.
- 모든 정보는 근거 댓글과 함께 보이며, 직접 수정·삭제·추가할 수 있습니다.
- **이 사람 기억 지우기**를 누르면 정보와 메모를 지우고, 이후에도 그 사람의 정보는 기록하지 않습니다.
- 처음 수집할 때 7일보다 오래된 댓글은 댓글함에 넣지 않고 "답 안 함"으로 둡니다. 정보 정리에는 사용합니다.
- 비공개 계정은 아이디가 제공되지 않아 인물 카드를 만들 수 없습니다.

## 로컬에서 실행 (선택)

```bash
cd threads-analyzer
cp .env.example .env.local   # 값 채우기 (APP_URL은 https 주소 필요)
npm install
npm run dev
```

Meta는 리디렉션 주소로 https만 허용하므로 Vercel 배포를 권장합니다.

## 구조

| 경로 | 역할 |
|---|---|
| `app/api/auth/*` | Threads 로그인, 토큰 발급, 연결 해제 |
| `app/api/data`, `app/api/analyze` | 분석 탭 데이터와 AI 분석 |
| `app/api/sync`, `app/api/cron/sync` | 댓글 수집과 인물 정보 정리 (수동 / 매일 자동) |
| `app/api/inbox`, `app/api/comments/*` | 댓글함, 답 안 함 처리, 실수 검사, 답글 올리기 |
| `app/api/people/*`, `app/api/facts/*` | 인물 목록·상세, 메모, 정보 추가·수정·삭제 |
| `lib/db.ts` | 데이터베이스 연결과 표 정의 (계정별로 데이터를 나눠 저장) |
| `lib/memory.ts` | 댓글 저장, AI 정보 추출 |
| `lib/people.ts` | 댓글함·인물 조회와 수정, 답글 실수 검사 |
| `lib/threads.ts` | Threads API 호출 |
| `lib/session.ts`, `lib/crypto.ts` | 로그인 쿠키, 토큰 암호화 저장 |

## 서비스로 확장할 때

- 모든 데이터는 계정별로 분리 저장되어 있어, 클라이언트 계정을 추가해도 구조를 바꿀 필요가 없습니다.
- `accounts.status` 값(active / paused)으로 계정 이용을 켜고 끌 수 있습니다. 정기결제를 붙이면 결제 상태와 연결하면 됩니다.
- 정식 공개 전에 Meta 앱 심사, 개인정보 처리방침, 데이터 삭제 콜백 구현이 필요합니다.
