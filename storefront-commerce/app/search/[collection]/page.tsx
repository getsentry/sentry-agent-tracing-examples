import {
  getCollection,
  getCollectionProducts,
  getCollections,
} from "lib/commerce";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import Grid from "components/grid";
import ProductGridItems from "components/layout/product-grid-items";
import { defaultSort, sorting } from "lib/constants";
import { parseSearchParams } from "lib/search-params";

export async function generateStaticParams() {
  const collections = await getCollections();
  return collections
    .filter((collection) => collection.handle)
    .map((collection) => ({ collection: collection.handle }));
}

export async function generateMetadata(props: {
  params: Promise<{ collection: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const collection = await getCollection(params.collection);

  if (!collection) return notFound();

  return {
    title: collection.seo?.title || collection.title,
    description:
      collection.seo?.description ||
      collection.description ||
      `${collection.title} products`,
  };
}

// Suspense keeps the params/searchParams access out of the route shell so
// navigations stay instant (instant-shell-url-data). The layout's boundary is
// not enough: on same-layout navigations only the page re-renders.
export default function CategoryPage(props: {
  params: Promise<{ collection: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={null}>
      <CategoryResults
        params={props.params}
        searchParams={props.searchParams}
      />
    </Suspense>
  );
}

async function CategoryResults(props: {
  params: Promise<{ collection: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { sort } = parseSearchParams(await props.searchParams);
  const params = await props.params;
  const { sortKey, reverse } =
    sorting.find((item) => item.slug === sort) ?? defaultSort;
  const products = await getCollectionProducts({
    collection: params.collection,
    sortKey,
    reverse,
  });

  return (
    <section>
      {products.length === 0 ? (
        <p className="py-3 text-lg">{`No products found in this collection`}</p>
      ) : (
        <Grid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <ProductGridItems products={products} />
        </Grid>
      )}
    </section>
  );
}
