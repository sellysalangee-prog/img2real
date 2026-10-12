# 스레드 분석 (Threads Analyzer)

내 Threads 계정을 연결해 게시글 성과를 분석하는 개인용 웹앱입니다.

- 요약: 총 조회수, 평균 참여율, 팔로워, 일별 조회수, 반응 좋은 글 TOP 5
- 게시글: 전체 글 목록과 지표, 조회수·참여율 정렬
- 인사이트: 요일·시간대 히트맵, 글 특징별 참여율 비교, Claude AI 분석

## 설치 순서

### 1. Meta 개발자 앱 만들기

1. https://developers.facebook.com/apps 에서 **앱 만들기**를 누릅니다.
2. 사용 사례에서 **Threads API 액세스**를 선택합니다.
3. **사용 사례 → 맞춤 설정 → 권한**에서 아래 3개를 추가합니다.
   - `threads_basic`, `threads_manage_insights`, `threads_read_replies`
4. **앱 역할 → 역할 → Threads 테스터 추가**에서 내 Threads 계정을 추가합니다.
5. Threads 앱에서 **설정 → 계정 → 웹사이트 권한 → 초대**로 가서 초대를 수락합니다.
6. **사용 사례 → 맞춤 설정 → 설정**에서 아래 값을 확인합니다.
   - Threads 앱 ID, Threads 앱 시크릿 코드
   - 리디렉션 콜백 URL은 3단계에서 배포 주소가 나온 뒤에 입력합니다.

### 2. Claude API 키 받기

https://console.anthropic.com 에서 API 키를 만듭니다. AI 분석 버튼을 누를 때만 사용됩니다.

### 3. Vercel에 배포하기

1. https://vercel.com 에 GitHub 계정으로 로그인합니다.
2. **Add New → Project**에서 이 저장소를 고릅니다.
3. **Root Directory**를 `threads-analyzer`로 지정합니다.
4. **Environment Variables**에 아래 값을 넣고 Deploy를 누릅니다.

| 이름 | 값 |
|---|---|
| `THREADS_APP_ID` | Threads 앱 ID |
| `THREADS_APP_SECRET` | Threads 앱 시크릿 코드 |
| `APP_URL` | 배포 주소 (예: `https://my-threads.vercel.app`, 끝에 `/` 없이) |
| `SESSION_SECRET` | 32자 이상 아무 문자열 (비밀번호처럼 길고 무작위로) |
| `ANTHROPIC_API_KEY` | Claude API 키 |
| `MAX_POSTS` | (선택) 분석할 최근 글 수, 기본 150 |

배포 주소를 처음엔 모를 수 있습니다. 일단 배포한 뒤 주소를 확인하고 `APP_URL`을 넣고 **Redeploy** 하면 됩니다.

### 4. 콜백 주소 등록

Meta 앱 설정의 Threads 설정에 아래 주소를 입력합니다.

- 리디렉션 콜백 URL: `https://<배포주소>/api/auth/callback`
- 제거 콜백 URL, 삭제 콜백 URL: `https://<배포주소>/` (개인용이라 형식만 맞추면 됩니다)

### 5. 사용

배포 주소에 접속해 **Threads로 연결하기**를 누르면 끝입니다.

## 로컬에서 실행 (선택)

```bash
cd threads-analyzer
cp .env.example .env.local   # 값 채우기 (APP_URL은 https 주소 필요)
npm install
npm run dev
```

Meta는 리디렉션 주소로 https만 허용하므로, 로컬 테스트보다 Vercel 배포를 권장합니다.

## 구조

| 경로 | 역할 |
|---|---|
| `app/api/auth/*` | Threads 로그인, 토큰 발급, 연결 해제 |
| `app/api/data` | 프로필·게시글·지표 조회 (토큰 자동 갱신) |
| `app/api/analyze` | 답글 수집 + Claude AI 분석 |
| `lib/threads.ts` | Threads API 호출 |
| `lib/analysis.ts` | 참여율, 순위, 히트맵, 특징별 비교 계산 |
| `lib/session.ts` | 토큰을 암호화해 쿠키에 저장 |
| `components/*` | 화면 |

## 참고

- 데이터는 서버에 저장하지 않고, 접속하거나 새로고침할 때마다 Threads에서 새로 가져옵니다.
- 팔로워 수가 100명 미만이면 일부 계정 지표가 비어 있을 수 있습니다.
- 토큰은 60일간 유효하며, 만료 7일 전부터 접속할 때 자동으로 갱신됩니다.
