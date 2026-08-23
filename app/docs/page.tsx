import Link from "next/link";

import { getDocList } from "@/lib/docs";

export default function DocsIndexPage() {
  const docs = getDocList();

  return (
    <div className="page-shell">
      <header className="hero docs-hero">
        <section className="hero-grid docs-hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">PROJECT NOTES</p>
            <h1>기획 문서</h1>
            <p className="hero-text">
              TrendDrop 리서치와 서비스 방향 문서를 Next.js 앱 안에서 바로 읽을 수 있게 정리했습니다.
            </p>
          </div>

          <aside className="pulse-panel docs-list-panel">
            <div className="pulse-header">
              <p>문서 수</p>
              <span>{docs.length} files</span>
            </div>
            <div className="doc-list">
              {docs.map((doc) => (
                <Link className="doc-link" href={`/docs/${doc.slug}`} key={doc.slug}>
                  <strong>{doc.title}</strong>
                  <span>{doc.description}</span>
                </Link>
              ))}
            </div>
          </aside>
        </section>
      </header>
    </div>
  );
}

