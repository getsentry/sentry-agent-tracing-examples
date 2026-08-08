import * as Sentry from "@sentry/nextjs";

// Fake AcmePay gateway client. Like lib/db's query helper, it simulates the
// outbound call with jittered latency inside a span shaped like a real HTTP
// request, so refunds show a gateway hop in the trace.
export function issueRefund({
  chargeId,
  amount,
  currencyCode,
}: {
  chargeId: string;
  amount: string;
  currencyCode: string;
}): Promise<{ refundId: string; amount: string; currencyCode: string }> {
  return Sentry.startSpan(
    {
      name: "POST https://api.acmepay.test/v1/refunds",
      op: "http.client",
      attributes: {
        "http.request.method": "POST",
        "url.full": "https://api.acmepay.test/v1/refunds",
        "http.response.status_code": 201,
      },
    },
    async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, 120 + Math.random() * 180),
      );
      return {
        refundId: `re_${chargeId.slice(3)}`,
        amount,
        currencyCode,
      };
    },
  );
}
