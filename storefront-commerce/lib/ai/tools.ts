import * as Sentry from "@sentry/nextjs";
import { tool } from "ai";
import * as db from "lib/db";
import { DEMO_CUSTOMER_ID } from "lib/db/data";
import { issueRefund } from "lib/payments";
import type { InferUITools, UIDataTypes, UIMessage } from "ai";
import type { Product } from "lib/commerce/types";
import { z } from "zod";

// Compact product shape returned by tools: enough for the chat's product
// cards without flooding the model context (or the recorded tool spans)
// with variant data.
export type ProductCard = {
  handle: string;
  title: string;
  description: string;
  price: string;
  currencyCode: string;
  image: string;
  sizes?: string[];
};

export type AccountInfo = {
  customer:
    | {
        name: string;
        email: string;
        memberSince: string;
        loyaltyTier: string;
        loyaltyPoints: number;
      }
    | undefined;
  orders: {
    id: string;
    createdAt: string;
    status: string;
    total: string;
    currencyCode: string;
    items: {
      title: string;
      variant: string;
      quantity: number;
      productHandle: string;
    }[];
  }[];
};

const toCard = (product: Product): ProductCard => ({
  handle: product.handle,
  title: product.title,
  description: product.description,
  price: product.priceRange.minVariantPrice.amount,
  currencyCode: product.priceRange.minVariantPrice.currencyCode,
  image: product.featuredImage.url,
  sizes: product.options.find((option) => option.name === "Size")?.values,
});

export const tools = {
  searchProducts: tool({
    description:
      "Search the Acme Store catalog. Search by product-type keywords " +
      '(e.g. "hoodie", "mug", "stickers") and/or filter by collection. ' +
      "Results render as product cards in the chat.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Keywords matched against title, description, and tags"),
      collection: z
        .enum(["apparel", "accessories", "desk"])
        .optional()
        .describe("Limit results to one collection"),
    }),
    execute: async ({ query, collection }) => {
      const term = query?.toLowerCase().trim();
      const products = collection
        ? (await db.selectProductsByCollection(collection)).filter(
            (product) =>
              !term ||
              product.title.toLowerCase().includes(term) ||
              product.description.toLowerCase().includes(term) ||
              product.tags.some((tag) => tag.includes(term)),
          )
        : await db.selectProducts({ search: term });

      return { products: products.slice(0, 6).map(toCard) };
    },
  }),

  getProduct: tool({
    description:
      "Get one product by its handle, e.g. after a search turned it up. " +
      "Renders as a product card in the chat.",
    inputSchema: z.object({
      handle: z.string().describe('The product handle, e.g. "acme-hoodie"'),
    }),
    execute: async ({ handle }) => {
      const product = await db.selectProduct(handle);
      return { product: product ? toCard(product) : null };
    },
  }),

  getAccountInfo: tool({
    description:
      "Get the signed-in customer's profile, loyalty status, and recent " +
      "orders. Use for questions about the customer's account, orders, " +
      "deliveries, or points. Renders as an account card in the chat.",
    inputSchema: z.object({}),
    execute: async (): Promise<AccountInfo> => {
      const [customer, orders] = await Promise.all([
        db.selectCustomer(DEMO_CUSTOMER_ID),
        db.selectOrders(DEMO_CUSTOMER_ID, 5),
      ]);

      return {
        customer: customer && {
          name: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          memberSince: customer.memberSince,
          loyaltyTier: customer.loyalty.tier,
          loyaltyPoints: customer.loyalty.points,
        },
        orders: orders.map((order) => ({
          id: order.id,
          createdAt: order.createdAt,
          status: order.status,
          total: order.total.amount,
          currencyCode: order.total.currencyCode,
          items: order.lines.map((line) => ({
            title: line.title,
            variant: line.variantTitle,
            quantity: line.quantity,
            productHandle: line.productHandle,
          })),
        })),
      };
    },
  }),

  refundOrder: tool({
    description:
      "Refund one of the signed-in customer's orders in full. Use when the " +
      "customer asks to refund or return an order. Confirm which order " +
      "(getAccountInfo lists recent orders with their ids) before calling.",
    inputSchema: z.object({
      orderId: z.string().describe('The order id, e.g. "1036"'),
    }),
    execute: async ({ orderId }) => {
      const order = await db.selectOrder(DEMO_CUSTOMER_ID, orderId);
      if (!order) {
        return {
          refunded: false as const,
          reason: `No order ${orderId} found on this account`,
        };
      }

      try {
        const payment = await db.selectPayment(orderId);
        const refund = await issueRefund({
          chargeId: payment.chargeId,
          amount: order.total.amount,
          currencyCode: order.total.currencyCode,
        });
        return {
          refunded: true as const,
          refundId: refund.refundId,
          orderId,
          amount: order.total.amount,
          currencyCode: order.total.currencyCode,
        };
      } catch (error) {
        // The AI SDK catches tool errors and feeds them back to the model as
        // an error result, so capture here or no issue is ever created.
        // handled:false because from the app's perspective the tool crashed;
        // rethrowing keeps the execute_tool span failed and lets the model
        // apologize to the customer.
        Sentry.captureException(error, { mechanism: { handled: false } });
        throw error;
      }
    },
  }),
};

// Typed UI messages so the chat panel gets typed `tool-*` parts.
export type AssistantUIMessage = UIMessage<
  unknown,
  UIDataTypes,
  InferUITools<typeof tools>
>;
