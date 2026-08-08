"use client";

import { useChat } from "@ai-sdk/react";
import { Dialog, Transition } from "@headlessui/react";
import { SparklesIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { DefaultChatTransport } from "ai";
import type { AssistantUIMessage } from "lib/ai/tools";
import { Fragment, useState } from "react";
import { AssistantChat } from "./chat";

const transport = new DefaultChatTransport({ api: "/api/chat" });

export function Assistant() {
  const [isOpen, setIsOpen] = useState(false);
  // Chat state lives here, outside the dialog, so closing the panel
  // (e.g. to visit a recommended product) keeps the conversation.
  const { messages, status, error, sendMessage, stop } =
    useChat<AssistantUIMessage>({ transport });

  return (
    <>
      <button
        aria-label="Open shopping assistant"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-colors hover:bg-blue-500"
      >
        <SparklesIcon className="h-6" />
      </button>
      <Transition show={isOpen}>
        <Dialog onClose={() => setIsOpen(false)} className="relative z-50">
          <Transition.Child
            as={Fragment}
            enter="transition-all ease-in-out duration-300"
            enterFrom="opacity-0 backdrop-blur-none"
            enterTo="opacity-100 backdrop-blur-[.5px]"
            leave="transition-all ease-in-out duration-200"
            leaveFrom="opacity-100 backdrop-blur-[.5px]"
            leaveTo="opacity-0 backdrop-blur-none"
          >
            <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
          </Transition.Child>
          <Transition.Child
            as={Fragment}
            enter="transition-all ease-in-out duration-300"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transition-all ease-in-out duration-200"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <Dialog.Panel className="fixed bottom-0 right-0 top-0 flex h-full w-full flex-col border-l border-neutral-200 bg-white/80 p-6 text-black backdrop-blur-xl md:w-[420px] dark:border-neutral-700 dark:bg-black/80 dark:text-white">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-lg font-semibold">Shopping Assistant</p>
                <button
                  aria-label="Close shopping assistant"
                  onClick={() => setIsOpen(false)}
                  className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 text-black transition-colors dark:border-neutral-700 dark:text-white"
                >
                  <XMarkIcon className="h-6" />
                </button>
              </div>
              <AssistantChat
                messages={messages}
                status={status}
                error={error}
                sendMessage={sendMessage}
                stop={stop}
                onNavigate={() => setIsOpen(false)}
              />
            </Dialog.Panel>
          </Transition.Child>
        </Dialog>
      </Transition>
    </>
  );
}
