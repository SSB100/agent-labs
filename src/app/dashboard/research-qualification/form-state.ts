import type { prepareResearchBootstrap, verifySavedResearchInferenceRoute } from "@/research/qualification-server";

export type ResearchSetupState = {
  status: "idle" | "prepared" | "unavailable";
  message: string;
  preparation: Awaited<ReturnType<typeof prepareResearchBootstrap>> | null;
};

export type ResearchRouteState = {
  status: "idle" | "verified" | "unavailable";
  message: string;
  verification: Awaited<ReturnType<typeof verifySavedResearchInferenceRoute>> | null;
};
