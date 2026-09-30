export type ApiMeta = {
  /** 이 응답이 실제 DB에서 왔는지, mock 폴백인지. */
  source: "db" | "mock";
  updatedAt: string;
  /** 최신 run이 실제로 수집된 시각(ISO). 신선도 표시("마지막 수집 N분 전")에 쓴다. */
  latestCollectedAt?: string | null;
  [key: string]: unknown;
};

export type ApiResult<T> = {
  data: T;
  meta: ApiMeta;
};
