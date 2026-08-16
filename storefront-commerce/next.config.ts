import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16's stable replacement for the template's experimental
  // ppr/useCache flags — required for the 'use cache' directives in lib/commerce.
  cacheComponents: true,
  // Prefetch only the static shell of routes with dynamic data (cart cookie,
  // searchParams) so <Link prefetch={true}> stops triggering full dynamic
  // renders — see the instant-link-prefetch-partial warning.
  partialPrefetching: true,
  experimental: {
    inlineCss: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Routes browser events through the app's own origin, so a reader running
  // the demo behind an ad blocker still gets client errors, replays, and the
  // browser half of each trace.
  tunnelRoute: true,
  // Source map upload only happens when SENTRY_AUTH_TOKEN is set, so builds
  // stay green in environments without Sentry credentials.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
