import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";

import { getDocList, readDocContent } from "@/lib/docs";

export async function generateStaticParams() {
  return getDocList().map((doc) => ({ slug: doc.slug }));
}

export default async function DocDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
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

