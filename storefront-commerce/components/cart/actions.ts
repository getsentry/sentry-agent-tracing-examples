"use server";

import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";
import { TAGS } from "lib/constants";
import {
  addToCart,
  createCart,
  getCart,
  removeFromCart,
  updateCart,
} from "lib/commerce";
import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// useActionState seeds the form with `null` and then feeds each action its own
// previous return value, which is a message on failure and nothing on success.
type CartActionState = string | null | undefined;

export async function addItem(
  prevState: CartActionState,
  selectedVariantId: string | undefined,
) {
  if (!selectedVariantId) {
    return "Error adding item to cart";
  }

  try {
    await addToCart([{ merchandiseId: selectedVariantId, quantity: 1 }]);
    updateTag(TAGS.cart);
  } catch (e) {
    // Server actions return their error to the form instead of throwing, so
    // Next never reaches the onRequestError hook instrumentation.ts wires to
    // Sentry — every catch in this file has to report for itself.
    Sentry.captureException(e);
    return "Error adding item to cart";
  }
}

export async function removeItem(
  prevState: CartActionState,
  merchandiseId: string,
) {
  try {
    const cart = await getCart();

    if (!cart) {
      return "Error fetching cart";
    }

    const lineItem = cart.lines.find(
      (line) => line.merchandise.id === merchandiseId,
    );

    if (lineItem && lineItem.id) {
      await removeFromCart([lineItem.id]);
      updateTag(TAGS.cart);
    } else {
      return "Item not found in cart";
    }
  } catch (e) {
    Sentry.captureException(e);
    return "Error removing item from cart";
  }
}

export async function updateItemQuantity(
  prevState: CartActionState,
  payload: {
    merchandiseId: string;
    quantity: number;
  },
) {
  const { merchandiseId, quantity } = payload;

  try {
    const cart = await getCart();

    if (!cart) {
      return "Error fetching cart";
    }

    const lineItem = cart.lines.find(
      (line) => line.merchandise.id === merchandiseId,
    );

    if (lineItem && lineItem.id) {
      if (quantity === 0) {
        await removeFromCart([lineItem.id]);
      } else {
        await updateCart([
          {
            id: lineItem.id,
            merchandiseId,
            quantity,
          },
        ]);
      }
    } else if (quantity > 0) {
      await addToCart([{ merchandiseId, quantity }]);
    }

    updateTag(TAGS.cart);

    Sentry.logger.info("commerce.cart.updated", {
      "commerce.merchandise_id": merchandiseId,
      "commerce.quantity": quantity,
      "user.id": DEMO_USER.id,
    });
  } catch (e) {
    Sentry.captureException(e);
    return "Error updating item quantity";
  }
}

export async function redirectToCheckout() {
  const cart = await getCart();

  // The checkout button only renders inside an open cart, so reaching this
  // without one means the cart cookie was lost mid-session. Thrown rather than
  // returned, so instrumentation.ts's onRequestError hook reports it.
  if (!cart) {
    throw new Error("Checkout was requested for a session with no cart");
  }

  redirect(cart.checkoutUrl);
}

export async function createCartAndSetCookie() {
  const cart = await createCart();
  (await cookies()).set("cartId", cart.id);
}
