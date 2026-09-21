import * as Sentry from "@sentry/node";
import { defineHook } from "eve/hooks";

export default defineHook(Sentry.eveConversationHook());
