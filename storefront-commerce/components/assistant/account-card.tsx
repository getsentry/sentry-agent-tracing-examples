import clsx from "clsx";
import Price from "components/price";
import type { AccountInfo } from "lib/ai/tools";
import type { OrderStatus } from "lib/commerce/types";

const statusStyles = {
  Delivered:
    "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  "In transit": "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  Processing:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
} satisfies Record<OrderStatus, string>;

export function AccountCard({ customer, orders }: AccountInfo) {
  if (!customer) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No account found.
      </p>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-black">
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 p-3 dark:border-neutral-800">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-medium">{customer.name}</h4>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {customer.email} · member since {customer.memberSince}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">
          {customer.loyaltyTier} · {customer.loyaltyPoints.toLocaleString()} pts
        </span>
      </div>
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {orders.map((order) => (
          <li key={order.id} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Order #{order.id}</p>
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  statusStyles[order.status],
                )}
              >
                {order.status}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
              {order.items
                .map((item) =>
                  item.quantity > 1
                    ? `${item.quantity}× ${item.title}`
                    : item.title,
                )
                .join(", ")}
            </p>
            <div className="mt-1 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              <span>{new Date(order.createdAt).toLocaleDateString()}</span>
              <Price
                className="font-medium text-black dark:text-white"
                amount={order.total}
                currencyCode={order.currencyCode}
                currencyCodeClassName="hidden"
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
