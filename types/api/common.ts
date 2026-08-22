export type ApiMeta = {
  /** 이 응답이 실제 DB에서 왔는지, mock 폴백인지. */
  source: "db" | "mock";
  updatedAt: string;
  [key: string]: unknown;
};

export type ApiResult<T> = {
  data: T;
  meta: ApiMeta;
};
