import { setTimeout } from "node:timers/promises";
import type { Tool, ToolCall } from "@mistralai/mistralai/models/components";

const orders = new Map([
  ["ORD-1001", { status: "shipped", item: "Kettle", delivery: "Thursday" }],
  ["ORD-1002", { status: "processing", item: "Mug", delivery: "Next week" }],
]);

export const orderTool = {
  type: "function",
  function: {
    name: "lookup_order",
    description: "Look up the current status of an order by its ID.",
    parameters: {
      type: "object",
      properties: { orderId: { type: "string", description: "For example, ORD-1001" } },
      required: ["orderId"],
      additionalProperties: false,
    },
  },
} satisfies Tool;

export async function lookupOrder(call: ToolCall, failLookup: boolean): Promise<string> {
  if (call.function.name !== "lookup_order") throw new Error("Unknown tool");
  const args: unknown = typeof call.function.arguments === "string"
    ? JSON.parse(call.function.arguments)
    : call.function.arguments;
  if (typeof args !== "object" || args === null ||
      !("orderId" in args) || typeof args.orderId !== "string") {
    throw new Error("Missing orderId");
  }

  await setTimeout(250);
  if (failLookup) throw new Error("Order service unavailable (demo)");
  return JSON.stringify(orders.get(args.orderId) ?? { status: "not_found" });
}
