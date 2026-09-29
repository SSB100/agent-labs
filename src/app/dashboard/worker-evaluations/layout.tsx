import type { ReactNode } from "react";

export const maxDuration = 300;

type WorkerEvaluationsLayoutProps = {
  children: ReactNode;
};

export default function WorkerEvaluationsLayout({
  children,
}: WorkerEvaluationsLayoutProps) {
  return children;
}
