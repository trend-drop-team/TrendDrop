import { serializeJsonLd, type JsonLd as JsonLdData } from "@/lib/seo";

/** 서버 렌더 HTML에 구조화 데이터를 싣는다 — 크롤러는 스크립트를 실행하지 않아도 읽는다(#140). */
export default function JsonLd({ data }: { data: JsonLdData | JsonLdData[] }) {
  const items = Array.isArray(data) ? data : [data];
  return items.map((item, index) => (
    <script
      key={index}
      type="application/ld+json"
      // serializeJsonLd가 `<`·`>`·`&`를 이스케이프하므로 수집 텍스트가 태그를 탈출하지 못한다.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }}
    />
  ));
}
