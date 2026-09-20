# TrendDrop Google 수집 소스 세팅

작성일: 2026-07-15

## 목적

TrendDrop MVP에서 외부 트렌드 후보를 수집하는 데 필요한 Google 계열 소스만 정리한다.

지금 쓰는 소스:

- YouTube Data API
- Google News RSS

지금 쓰지 않는 소스:

- Google Ads API
- Search Console API
- YouTube Analytics API

## 필요한 환경변수

```env
DATABASE_URL=
NEXT_PUBLIC_API_URL=http://localhost:4000
YOUTUBE_API_KEY=
```

Google News RSS는 별도 토큰이 필요 없다.

## YouTube Data API 세팅

1. Google Cloud Console에 들어간다.
2. 프로젝트를 선택한다.
3. `APIs & Services > Library`로 이동한다.
4. `YouTube Data API v3`를 검색해서 활성화한다.
5. `APIs & Services > Credentials`로 이동한다.
6. `Create credentials > API key`를 누른다.
7. 발급된 값을 `.env.local`의 `YOUTUBE_API_KEY`에 넣는다.

현재 프로젝트에서 쓰는 위치:

- `POST /api/admin/collect/youtube`
- API Lab의 `YouTube Data API 수집`

## Google News RSS 세팅

별도 세팅은 없다.

현재 프로젝트에서 쓰는 위치:

- `GET /api/google-news/preview`
- `POST /api/admin/collect/google-news`
- API Lab의 `Google News RSS 미리보기`
- API Lab의 `Google News RSS 저장`

RSS 조회 형식:

```text
https://news.google.com/rss/search?q={keyword}&hl=ko&gl=KR&ceid=KR:ko
```

## API Lab 사용 순서

1. `전체 설정 상태 확인`
2. `DB 테이블 생성`
3. `YouTube Data API 수집`
4. `Google News RSS 미리보기`
5. `Google News RSS 저장`
6. `저장된 트렌드 조회`

## 제외한 값

아래 값들은 MVP의 외부 트렌드 수집 목적에는 필요 없다.

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_REFRESH_TOKEN=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
SEARCH_CONSOLE_SITE_URL=
YOUTUBE_CHANNEL_ID=
```

이 값들은 내 광고 계정, 내 사이트, 내 채널 데이터를 조회할 때 쓰는 값이다. TrendDrop이 외부 트렌드 후보를 수집하는 지금 단계에서는 세팅하지 않는다.
