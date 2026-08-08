import type { Metadata } from "next";

import Prose from "components/prose";
import { getPage, getPages } from "lib/commerce";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export async function generateStaticParams() {
  const pages = await getPages();
  return pages.map((page) => ({ page: page.handle }));
}

export async function generateMetadata(props: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = await getPage(params.page);

  if (!page) return notFound();

  return {
    title: page.seo?.title || page.title,
    description: page.seo?.description || page.bodySummary,
    openGraph: {
      publishedTime: page.createdAt,
      modifiedTime: page.updatedAt,
      type: "article",
    },
  };
}

// The Suspense wrapper keeps the params access out of the route shell so
// navigations stay instant (instant-shell-url-data). A boundary in the parent
// layout is not enough: on same-layout navigations only the page re-renders.
export default function Page(props: { params: Promise<{ page: string }> }) {
  return (
    <Suspense fallback={null}>
      <PageContent params={props.params} />
    </Suspense>
  );
}

async function PageContent(props: { params: Promise<{ page: string }> }) {
  const params = await props.params;
  const page = await getPage(params.page);

  if (!page) return notFound();

  return (
    <>
      <h1 className="mb-8 text-5xl font-bold">{page.title}</h1>
      <Prose className="mb-8" html={page.body} />
      <p className="text-sm italic">
        {`This document was last updated on ${new Intl.DateTimeFormat(
          undefined,
          {
            year: "numeric",
            month: "long",
            day: "numeric",
          },
        ).format(new Date(page.updatedAt))}.`}
      </p>
    </>
  );
}
