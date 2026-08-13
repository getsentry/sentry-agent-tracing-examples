import { Assistant } from "components/assistant/assistant";
import { CartProvider } from "components/cart/cart-context";
import { Navbar } from "components/layout/navbar";
import { WelcomeToast } from "components/welcome-toast";
import { GeistSans } from "geist/font/sans";
import { getCart } from "lib/commerce";
import { ReactNode, Suspense } from "react";
import { Toaster } from "sonner";
import "./globals.css";
import { baseUrl } from "lib/utils";
import { SITE_NAME } from "lib/constants";

export const metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  robots: {
    follow: true,
    index: true,
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Left unawaited so the layout shell renders before the cart resolves;
  // CartProvider unwraps the promise with `use` inside a client boundary.
  const cart = getCart();

  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="bg-neutral-50 text-black selection:bg-teal-300 dark:bg-neutral-900 dark:text-white dark:selection:bg-pink-500 dark:selection:text-white">
        <CartProvider cartPromise={cart}>
          <Navbar />
          <main>
            {children}
            <Toaster closeButton />
            <WelcomeToast />
          </main>
          {/* useChat creates a random per-visitor chat id, so the assistant
              must stream inside Suspense instead of being prerendered. */}
          <Suspense>
            <Assistant />
          </Suspense>
        </CartProvider>
      </body>
    </html>
  );
}
