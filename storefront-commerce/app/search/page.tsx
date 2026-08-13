import Grid from "components/grid";
import ProductGridItems from "components/layout/product-grid-items";
import { defaultSort, sorting } from "lib/constants";
import { getProducts } from "lib/commerce";
import { parseSearchParams } from "lib/search-params";
import { Suspense } from "react";

export const metadata = {
  title: "Search",
  description: "Search for products in the store.",
};

// Suspense keeps the searchParams access out of the route shell so
// navigations stay instant (instant-shell-url-data). The layout's boundary is
// not enough: on same-layout navigations only the page re-renders.
export default function SearchPage(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <Suspense fallback={null}>
      <SearchResults searchParams={props.searchParams} />
    </Suspense>
  );
}

async function SearchResults(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { sort, q: searchValue } = parseSearchParams(await props.searchParams);
  const { sortKey, reverse } =
    sorting.find((item) => item.slug === sort) ?? defaultSort;

  const products = await getProducts({ sortKey, reverse, query: searchValue });
  const resultsText = products.length > 1 ? "results" : "result";

  return (
    <>
      {searchValue ? (
        <p className="mb-4">
          {products.length === 0
            ? "There are no products that match "
            : `Showing ${products.length} ${resultsText} for `}
          <span className="font-bold">&quot;{searchValue}&quot;</span>
        </p>
      ) : null}
      {products.length > 0 ? (
        <Grid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          <ProductGridItems products={products} />
        </Grid>
      ) : null}
    </>
  );
}
