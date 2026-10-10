import "server-only";
import { createQuestControllerStore } from "../lib/quest-controller-runtime";
import { createRuntimeClient } from "../lib/supabase/runtime";
import { fetchDiscoveryR12Quote } from "./discovery-r12-quote";
import { createDiscoveryR12QuestAdapter } from "./discovery-r12-adapter";
import { fetchAdaptiveResearchQuote } from "./discovery-r12-adaptive-quote";
/** Tests replace external I/O only; Core/owner/R05/R07 checks remain real. */
export function discoveryR12ServerDependencies() { return { createController: createQuestControllerStore, createClient: createRuntimeClient, quote: fetchDiscoveryR12Quote, adaptiveQuote: fetchAdaptiveResearchQuote, createAdapter: createDiscoveryR12QuestAdapter }; }
