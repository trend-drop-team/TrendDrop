import type { ApiMeta } from "@/types/api/common";

/**
 * 응답 중 하나라도 mock 대체(`meta.source === "mock"`)면 "샘플 데이터" 배지를 띄운다(#87).
 * mock은 개발 환경에서만 나오지만, 화면에서 실데이터처럼 보이지 않게 명시한다.
 */
export default function SampleDataBadge({ metas }: { metas: Array<Pick<ApiMeta, "source">> }) {
  if (!metas.some((meta) => meta.source === "mock")) return null;

  return (
    <p className="sample-data-badge" role="note">
      <span className="sample-data-badge-label">샘플 데이터</span>
      <span className="sample-data-badge-text">수집된 실데이터가 없어 예시 데이터를 보여주고 있습니다.</span>
    </p>
  );
}
