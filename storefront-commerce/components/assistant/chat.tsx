"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { SparklesIcon } from "@heroicons/react/24/outline";
import type { ChatStatus } from "ai";
import type { AssistantUIMessage } from "lib/ai/tools";
import { Fragment, useState } from "react";
import { AccountCard } from "./account-card";
import { ProductResult, ProductResults } from "./product-results";

const suggestions = [
  "Find me a hoodie",
  "Gift ideas for a desk setup",
  "Where is my order?",
  "How many loyalty points do I have?",
  "Refund my last order",
];

function ToolPending({ label }: { label: string }) {
  return (
    <p className="animate-pulse text-sm text-neutral-500 dark:text-neutral-400">
      {label}
    </p>
  );
}

function ToolError({ errorText }: { errorText?: string }) {
  return (
    <p className="text-sm text-red-600 dark:text-red-400">
      Tool failed: {errorText ?? "unknown error"}
    </p>
  );
}

export function AssistantChat({
  messages,
  status,
  error,
  sendMessage,
  stop,
  onNavigate,
}: {
  messages: AssistantUIMessage[];
  status: ChatStatus;
  error: Error | undefined;
  sendMessage: (message: { text: string }) => void;
  stop: () => void;
  onNavigate: () => void;
}) {
  const [input, setInput] = useState("");

  const submit = (message: PromptInputMessage) => {
    if (!message.text.trim()) return;
    sendMessage({ text: message.text });
    setInput("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="px-1">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<SparklesIcon className="h-8" />}
              title="Hi, I'm the Acme assistant"
              description="Ask about products, gifts, or your orders."
            />
          ) : null}
          {messages.map((message) => (
            <Fragment key={message.id}>
              {message.parts.map((part, i) => {
                const key = `${message.id}-${i}`;

                switch (part.type) {
                  case "text":
                    return (
                      <Message from={message.role} key={key}>
                        <MessageContent>
                          <MessageResponse>{part.text}</MessageResponse>
                        </MessageContent>
                      </Message>
                    );

                  case "tool-searchProducts":
                    switch (part.state) {
                      case "output-available":
                        return (
                          <ProductResults
                            key={key}
                            products={part.output.products}
                            onNavigate={onNavigate}
                          />
                        );
                      case "output-error":
                        return (
                          <ToolError key={key} errorText={part.errorText} />
                        );
                      default:
                        return (
                          <ToolPending key={key} label="Searching products…" />
                        );
                    }

                  case "tool-getProduct":
                    switch (part.state) {
                      case "output-available":
                        return (
                          <ProductResult
                            key={key}
                            product={part.output.product}
                            onNavigate={onNavigate}
                          />
                        );
                      case "output-error":
                        return (
                          <ToolError key={key} errorText={part.errorText} />
                        );
                      default:
                        return (
                          <ToolPending key={key} label="Looking up product…" />
                        );
                    }

                  case "tool-getAccountInfo":
                    switch (part.state) {
                      case "output-available":
                        return <AccountCard key={key} {...part.output} />;
                      case "output-error":
                        return (
                          <ToolError key={key} errorText={part.errorText} />
                        );
                      default:
                        return (
                          <ToolPending
                            key={key}
                            label="Fetching your account…"
                          />
                        );
                    }

                  case "tool-refundOrder":
                    switch (part.state) {
                      case "output-available":
                        return part.output.refunded ? (
                          <p
                            key={key}
                            className="text-sm text-green-700 dark:text-green-400"
                          >
                            Refunded {part.output.amount}{" "}
                            {part.output.currencyCode} for order{" "}
                            {part.output.orderId}.
                          </p>
                        ) : (
                          <p
                            key={key}
                            className="text-sm text-neutral-500 dark:text-neutral-400"
                          >
                            {part.output.reason}
                          </p>
                        );
                      case "output-error":
                        return (
                          <ToolError key={key} errorText={part.errorText} />
                        );
                      default:
                        return (
                          <ToolPending key={key} label="Processing refund…" />
                        );
                    }

                  default:
                    return null;
                }
              })}
            </Fragment>
          ))}
          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Something went wrong — is OPENROUTER_API_KEY set? ({error.message}
              )
            </p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {messages.length === 0 ? (
        <Suggestions className="mb-3">
          {suggestions.map((suggestion) => (
            <Suggestion
              key={suggestion}
              suggestion={suggestion}
              onClick={(text) => sendMessage({ text })}
            />
          ))}
        </Suggestions>
      ) : null}

      <PromptInput onSubmit={submit}>
        <PromptInputBody>
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder="Ask about products or your orders…"
          />
        </PromptInputBody>
        <PromptInputFooter className="justify-end">
          <PromptInputSubmit
            status={status}
            onStop={stop}
            disabled={
              status === "ready" || status === "error" ? !input.trim() : false
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
