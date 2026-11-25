/**
 * 유튜브 인기 급상승 — 인기 영상 제목 20개. 공식 Data API. (trend-collector 이전)
 * env: YOUTUBE_API_KEY (필수), REGION_CODE (기본 KR). 키 없으면 예외.
 * meta.videoId 는 추출 단계의 "영상 단위 중복 제거"에 쓰인다.
 */
import { FETCH_TIMEOUT_MS } from "./http.mjs";

const API = "https://www.googleapis.com/youtube/v3";
const VIDEO_COUNT = 20;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`YouTube API: ${json.error?.errors?.[0]?.reason ?? json.error?.message ?? res.status}`);
  }
  return json;
}

export async function collect() {
  const key = process.env.YOUTUBE_API_KEY;
  // 키 누락을 0건으로 숨기지 않는다 — collect가 실패 사유로 드러낸다(#84).
  if (!key) throw new Error("YOUTUBE_API_KEY 미설정");
  const region = process.env.REGION_CODE || "KR";
  const out = [];

  // 1) 인기 급상승 영상 제목
  // statistics는 같은 videos 호출에 part만 얹는 것이라 쿼터 추가 비용이 없다.
  // 조회수·좋아요·공개시각을 meta에 남겨 두면 나중에 확산속도 가중(videoBoost)을
  // 켤 수 있다 — 사후 조회로는 "수집 당시 속도"를 복원할 수 없어서 지금부터 쌓는다.
  const vids = await getJson(
    `${API}/videos?part=snippet,statistics&chart=mostPopular&regionCode=${region}` +
      `&maxResults=${VIDEO_COUNT}&key=${key}`
  );
  const byId = new Map((vids.items ?? []).map((item) => [item.id, item]));
  const items = [...byId.values()];
  for (const it of items) {
    const st = it.statistics ?? {};
    out.push({
      source: "youtube",
      unit: "title",
      text: it.snippet.title,
      meta: {
        videoId: it.id,
        kind: "video_title",
        channelTitle: it.snippet.channelTitle,
        channelId: it.snippet.channelId,
        categoryId: it.snippet.categoryId,
        publishedAt: it.snippet.publishedAt,
        viewCount: Number(st.viewCount ?? 0),
        likeCount: st.likeCount === undefined ? null : Number(st.likeCount),
        commentCount: st.commentCount === undefined ? null : Number(st.commentCount),
      },
    });
  }

  return out;
}
