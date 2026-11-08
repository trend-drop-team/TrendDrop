import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";

import { readDocContent } from "@/lib/docs";
import { currentUserCanViewDocs } from "@/server/http/current-user";

// generateStaticParams는 쓰지 않는다 — currentUserCanViewDocs가 cookies()를 읽으므로 이
// 페이지는 어차피 요청마다 동적 렌더링된다(#79). 정적 프리렌더링 대상이 아니다.

export default async function DocDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await currentUserCanViewDocs())) notFound();

  const { slug } = await params;
  const doc = await readDocContent(slug);

  if (!doc) {
    notFound();
  }

  return (
    <div className="page-shell">
      <main className="app-main">
        <div className="doc-backlink">
          <Link className="ghost-button link-button" href="/docs">
            ← 문서 목록
          </Link>
        </div>

        <section className="panel docs-panel">
          <div className="panel-heading docs-panel-heading">
            <div>
              <p className="section-kicker">DOCUMENT VIEWER</p>
              <h2>{doc.title}</h2>
            </div>
          </div>
          <article className="markdown-body">
            <ReactMarkdown>{doc.content}</ReactMarkdown>
          </article>
        </section>
      </main>
    </div>
  );
}

