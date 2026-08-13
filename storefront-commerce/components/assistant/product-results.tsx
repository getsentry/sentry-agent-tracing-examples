import Price from "components/price";
import type { ProductCard } from "lib/ai/tools";
import Image from "next/image";
import Link from "next/link";

// Tool results rendered as real storefront UI: the same tile treatment the
// template's grid uses, linking into the product pages.

export function ProductResults({
  products,
  onNavigate,
}: {
  products: ProductCard[];
  onNavigate: () => void;
}) {
  if (products.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No matching products found.
      </p>
    );
  }

  return (
    <div className="grid w-full grid-cols-2 gap-3">
      {products.map((product) => (
        <Link
          key={product.handle}
          href={`/product/${product.handle}`}
          onClick={onNavigate}
          prefetch={true}
          className="group overflow-hidden rounded-lg border border-neutral-200 bg-white transition-colors hover:border-blue-600 dark:border-neutral-800 dark:bg-black dark:hover:border-blue-600"
        >
          <div className="relative aspect-square w-full">
            <Image
              src={product.image}
              alt={product.title}
              fill
              sizes="180px"
              className="object-cover transition duration-300 ease-in-out group-hover:scale-105"
            />
          </div>
          <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
            <h4 className="truncate text-sm font-medium">{product.title}</h4>
            <Price
              className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400"
              amount={product.price}
              currencyCode={product.currencyCode}
              currencyCodeClassName="hidden"
            />
          </div>
        </Link>
      ))}
    </div>
  );
}

export function ProductResult({
  product,
  onNavigate,
}: {
  product: ProductCard | null;
  onNavigate: () => void;
}) {
  if (!product) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        That product could not be found.
      </p>
    );
  }

  return (
    <Link
      href={`/product/${product.handle}`}
      onClick={onNavigate}
      prefetch={true}
      className="group flex w-full gap-3 overflow-hidden rounded-lg border border-neutral-200 bg-white p-3 transition-colors hover:border-blue-600 dark:border-neutral-800 dark:bg-black dark:hover:border-blue-600"
    >
      <div className="relative h-24 w-24 shrink-0">
        <Image
          src={product.image}
          alt={product.title}
          fill
          sizes="96px"
          className="rounded-md object-cover"
        />
      </div>
      <div className="min-w-0">
        <h4 className="truncate text-sm font-medium">{product.title}</h4>
        <Price
          className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400"
          amount={product.price}
          currencyCode={product.currencyCode}
          currencyCodeClassName="hidden"
        />
        <p className="mt-1 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
          {product.description}
        </p>
        {product.sizes ? (
          <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
            Sizes: {product.sizes.join(" · ")}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
