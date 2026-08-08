"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        {/* The App Router does not expose status codes for errors, so pass 0
            to render Next's generic error page. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
