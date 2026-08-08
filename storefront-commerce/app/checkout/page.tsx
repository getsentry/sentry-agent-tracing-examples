import { CheckCircleIcon } from "@heroicons/react/24/outline";
import Link from "next/link";

export const metadata = {
  title: "Checkout",
  description: "Demo checkout - no payment is taken.",
};

// The cart's checkoutUrl points here instead of a Shopify checkout.
export default function CheckoutPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <CheckCircleIcon className="h-16 text-blue-600" />
      <h1 className="mt-6 text-2xl font-bold">This is where checkout ends</h1>
      <p className="mt-4 text-neutral-500 dark:text-neutral-400">
        Acme Store is a demo: the catalog, cart, and shopping assistant are
        real, but there is nothing to buy. Head back and ask the assistant for
        something else instead.
      </p>
      <Link
        href="/"
        prefetch={true}
        className="mt-8 rounded-full bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
      >
        Continue shopping
      </Link>
    </div>
  );
}
