"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function WelcomeToast() {
  useEffect(() => {
    // ignore if screen height is too small
    if (window.innerHeight < 650) return;
    if (!document.cookie.includes("welcome-toast=2")) {
      toast("🛍️ Welcome to Acme Store!", {
        id: "welcome-toast",
        duration: Infinity,
        onDismiss: () => {
          document.cookie = "welcome-toast=2; max-age=31536000; path=/";
        },
        description: (
          <>
            A demo storefront with an AI shopping assistant — every chat turn
            becomes a full agent trace in{" "}
            <a
              href="https://docs.sentry.io/product/agents/"
              className="text-blue-600 hover:underline"
              target="_blank"
            >
              Sentry
            </a>
            . Try the sparkles button in the corner.
          </>
        ),
      });
    }
  }, []);

  return null;
}
