/**
 * 유튜브 인기 급상승 — 영상 제목 + 상위 댓글. 공식 Data API. (trend-collector 이전)
 * env: YOUTUBE_API_KEY (필수), REGION_CODE (기본 KR). 키 없으면 빈 배열.
 * meta.videoId 는 추출 단계의 "영상 단위 중복 제거"에 쓰인다.
 */
const API = "https://www.googleapis.com/youtube/v3";
const VIDEO_COUNT = 20; // mostPopular 상위 N 영상
const COMMENT_VIDEOS = 8; // 댓글을 긁을 영상 수 (쿼터 절약)
const COMMENTS_PER_VIDEO = 15;

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    throw new Error(`YouTube API: ${json.error.errors?.[0]?.reason ?? json.error.message}`);
  }
  return json;
}

export async function collect() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return []; // 키 없으면 조용히 스킵
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
  const items = vids.items ?? [];
  for (const it of items) {
    const st = it.statistics ?? {};
    out.push({
      source: "youtube",
      unit: "title",
      text: it.snippet.title,
      meta: {
        videoId: it.id,
        kind: "video_title",
        publishedAt: it.snippet.publishedAt,
        viewCount: Number(st.viewCount ?? 0),
        likeCount: st.likeCount === undefined ? null : Number(st.likeCount),
        commentCount: st.commentCount === undefined ? null : Number(st.commentCount),
      },
    });
  }

  // 2) 상위 영상들의 인기 댓글 (댓글 꺼진 영상은 건너뜀)
  for (const it of items.slice(0, COMMENT_VIDEOS)) {
    try {
      const cj = await getJson(
        `${API}/commentThreads?part=snippet&videoId=${it.id}&order=relevance` +
          `&maxResults=${COMMENTS_PER_VIDEO}&key=${key}`
      );
      for (const c of cj.items ?? []) {
        const snip = c.snippet.topLevelComment.snippet;
        const text = snip.textOriginal.replace(/\s+/g, " ").trim();
        if (text) {
          out.push({
            source: "youtube",
            unit: "comment",
            text,
            meta: { videoId: it.id, likeCount: Number(snip.likeCount ?? 0) },
          });
        }
      }
    } catch {
      // 댓글 비활성/오류 영상은 조용히 스킵
    }
  }

  return out;
}
