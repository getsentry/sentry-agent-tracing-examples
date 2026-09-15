import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import * as Sentry from "@sentry/node";
import { answer } from "./assistant.ts";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const conversationId = randomUUID();
Sentry.setConversationId(conversationId);
console.log(`Conversation: ${conversationId}`);
console.log("Ask about ORD-1001 or ORD-1002. Commands: /fail, /quit");
let failNextTurn = false;

try {
  while (true) {
    const question = (await terminal.question("You: ")).trim();
    if (question === "/quit") break;
    if (!question) continue;
    if (question === "/fail") {
      failNextTurn = true;
      console.log("The next order lookup will fail.");
      continue;
    }
    try {
      process.stdout.write("Assistant: ");
      await answer(question, failNextTurn);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\nRequest failed: ${message}. Ask again to retry.`);
    } finally {
      failNextTurn = false;
      await Sentry.flush(2000);
    }
  }
} finally {
  terminal.close();
  await Sentry.flush(2000);
}
