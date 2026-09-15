import * as Sentry from "@sentry/node";
import type { ToolCall } from "@mistralai/mistralai/models/components";
import { lookupOrder as runLookupOrder } from "./orders.ts";

export function traceTurn<T>(run: () => Promise<T>): Promise<T> {
  return Sentry.startSpan(
    {
      name: "invoke_agent Order Support",
      op: "gen_ai.invoke_agent",
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": "Order Support",
      },
    },
    async () => {
      try {
        return await run();
      } catch (error) {
        Sentry.captureException(error);
        throw error;
      }
    },
  );
}

export function lookupOrder(call: ToolCall, failLookup: boolean): Promise<string> {
  return Sentry.startSpan(
    {
      name: "execute_tool lookup_order",
      op: "gen_ai.execute_tool",
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "lookup_order",
        "gen_ai.tool.call.id": call.id,
        "gen_ai.tool.call.arguments": typeof call.function.arguments === "string"
          ? call.function.arguments : JSON.stringify(call.function.arguments),
      },
    },
    async (span) => {
      try {
        const result = await runLookupOrder(call, failLookup);
        span.setAttribute("gen_ai.tool.call.result", result);
        return result;
      } catch (error) {
        span.setStatus({ code: 2, message: "internal_error" });
        span.setAttribute("error.type", error instanceof Error ? error.name : "Error");
        throw error;
      }
    },
  );
}
