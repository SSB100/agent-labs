import Link from "next/link";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { etsyConfigured, etsyRpc, eligibleEtsyPackages } from "@/etsy/server";
import { EtsyWorkspace, type EtsyWorkspaceData } from "./workspace";
import "./etsy.css";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const messages: Record<string, string> = {
  connected: "Etsy shop connected. Draft preparation still requires a qualified product and your approval.", disconnected: "Stored Etsy access removed and unfinished draft work stopped.",
  "connection-consent-required": "Confirm the account connection before continuing to Etsy.", "connection-unavailable": "The connection could not be completed. No new draft was requested.",
  "action-unavailable": "The action could not be confirmed. Check the current records before continuing.", "draft-consent-required": "Approve the exact draft and sharing of its images before continuing.",
  "draft-blocked": "Draft work is blocked by missing authority, an existing run or an upstream qualification check. No automatic retry is performed.",
  "draft-verified": "The Etsy draft, price, attributes and images were read back and verified. It remains unpublished.",
  "draft-needs-review": "The saved draft needs verification. Earlier writes will not be repeated blindly.", "draft-stopped": "Further draft work stopped. Existing Etsy resources are retained.",
};
export default async function EtsyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireOwnerUiContext(), query = await searchParams;
  const selection = typeof query.business === "string" ? query.business : null;
  const business = context.businesses.find(b => b.id === selection) ?? context.businesses[0];
  const message = typeof query.message === "string" ? messages[query.message] : null;
  let data: EtsyWorkspaceData | null = null;
  if (business) {
    data = { businessId: business.id, businessName: business.name, configured: etsyConfigured(), unavailable: false, connection: null, packages: [], runs: [] };
    try {
      const [workspace, packages] = await Promise.all([etsyRpc(context, business.id, "workspace"), eligibleEtsyPackages(context, business.id)]);
      data.connection = workspace.connection as EtsyWorkspaceData["connection"]; data.runs = workspace.runs as EtsyWorkspaceData["runs"]; data.packages = packages;
    } catch { data.unavailable = true; }
  }
  return <AppShell active="accounts" context={context}><PageHeader eyebrow="Etsy · Experimental" title="Etsy drafts" description="Turn an approved product into a verified draft. Publication stays off." actions={<Link className="coreButton" href="/dashboard/accounts">Back to Accounts</Link>} />
    {message && <p role="status" className="etsyMessage">{message}</p>}
    {context.businesses.length > 1 && <form className="etsyBusiness" method="get"><label>Business<select name="business" defaultValue={business?.id}>{context.businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="coreButton">View</button></form>}
    {data ? <EtsyWorkspace data={data} /> : <p>Create a Business to prepare Etsy drafts.</p>}
  </AppShell>;
}
