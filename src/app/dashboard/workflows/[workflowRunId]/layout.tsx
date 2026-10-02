import type { ReactNode } from "react";
import { AppShell } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
export default async function WorkflowLayout({ children, params }: { children: ReactNode; params: Promise<{ workflowRunId: string }> }) {
  const context = await requireOwnerUiContext(), { workflowRunId } = await params;
  const result = await context.supabase.from("workflow_runs").select("business_id").eq("id", workflowRunId).maybeSingle();
  const businessId = result.data?.business_id;
  return <AppShell active="workflows" context={context} workflowRunId={workflowRunId} navigationBusinessId={context.businesses.some(b => b.id === businessId) ? businessId : undefined}>{children}</AppShell>;
}
