import type { prepareResearchBootstrap } from "@/research/qualification-server";

export type ResearchSetupState = {
  status: "idle" | "prepared" | "unavailable";
  message: string;
  preparation: Awaited<ReturnType<typeof prepareResearchBootstrap>> | null;
};
