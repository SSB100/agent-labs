import "server-only";
import { fetchGenerationRouteProof } from "./generation-route";
import { fetchPublicResearchQuote } from "./qualification-quote";
import { publicResearchRuntime, type PublicResearchRuntime, type ResearchRuntimeScope } from "./qualification-runtime";

/** Test fixtures replace only this external-I/O factory. Owner authorization,
 * HMAC binding, actual runner, adapter serialization and admission stay real. */
export function researchQualificationDependencies() {
  return {
    now: (): number | Promise<number> => Date.now(),
    fetchQuote: fetchPublicResearchQuote,
    fetchGenerationRoute: fetchGenerationRouteProof,
    makeRuntime: (scope: ResearchRuntimeScope, verifyQuote: PublicResearchRuntime["verifyQuote"]): PublicResearchRuntime => publicResearchRuntime(scope, verifyQuote),
  };
}
