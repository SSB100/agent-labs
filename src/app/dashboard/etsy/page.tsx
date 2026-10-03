import { readState, readHistory, historyRows } from "@/lib/core-ui/history-read";
import { HistoryPager } from "@/components/console/history-pager";
import { notFound } from "next/navigation";
import { ConsoleRetainedWorkspace } from "@/components/console/console-retained-workspace";
import Link from "next/link";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { etsyConfigured, eligibleEtsyPackages } from "@/etsy/server";
import { EtsyWorkspace, type EtsyWorkspaceData } from "./workspace";
import "./etsy.css";
import { loadListingWorkspace, type ListingWorkspaceData } from "@/listing/server";
import { ListingWorkspace } from "./listing-workspace";
import { loadPublicationWorkspace, type PublicationWorkspaceData } from "@/etsy-publication/server";
import { PublicationWorkspace } from "./publication-workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const messages: Record<string, string> = {
  "publication-consent-required":"Publication needs separate confirmation of the exact draft, public data, verified total fees and renewal conditions.",
  "publication-blocked":"Publication is blocked by missing commercial evidence, current review, account setup or verified draft prerequisites. No automatic retry was started.",
  "publication-verified":"The same Etsy listing is active and its complete approved details were independently verified. Actual Etsy fee charges remain unreconciled.",
  "publication-needs-review":"The publication outcome needs a read-only check of the existing listing. A request already sent will never be repeated blindly.",
  "publication-stopped":"Further publication work is stopped. This cannot undo an already sent request, an active listing or a fee already incurred.",
  "qualification-consent-required":"Approve the separate five-call worker evaluation and its total spending limit before starting.",
  "qualification-blocked":"Worker qualification is blocked by setup, current catalog, the fixed test suite or its fresh budget check. No product or Etsy action was requested.",
  "listing-consent-required":"Approve the exact bounded model run and its spending limit before starting.",
  "listing-budget-invalid":"Choose a total listing allowance between US$0.01 and US$1.",
  "listing-blocked":"Listing preparation is blocked by its verified input, current qualification, setup or budget check. No automatic retry was started.",
  "listing-launch-uncertain":"The workflow launch could not be confirmed. Its durable record is preserved; it will not be launched again blindly.",
  "listing-stopped":"Further listing-preparation calls are stopped. In-flight costs and existing review records are preserved.",
  "listing-action-unavailable":"The listing action could not be confirmed. Refresh its durable history before continuing.",
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
  if (query.business && (!selection || !context.businesses.some(b => b.id === selection))) notFound();
  const business = context.businessesUnavailable ? undefined : context.businesses.find(b => b.id === selection) ?? context.businesses[0];
  const message = typeof query.message === "string" ? messages[query.message] : null;
  let data: EtsyWorkspaceData | null = null;
  let listing: ListingWorkspaceData | null = null;
  let publication: PublicationWorkspaceData | null = null;
  if (business) {
    [listing,publication] = await Promise.all([loadListingWorkspace(context,business.id),loadPublicationWorkspace(context,business.id,typeof query.publicationRequest === "string" ? query.publicationRequest : null)]);
    data = { businessId: business.id, businessName: business.name, configured: etsyConfigured(), unavailable: false, connection: null, packages: [], runs: [] };
    try {
      const [workspace, runs, packages] = await Promise.all([readState(context, business.id, "etsy_state"), readHistory<EtsyWorkspaceData["runs"][number]>(context,business.id,"etsy_runs","etsy"), eligibleEtsyPackages(context, business.id)]);
      if(!Object.hasOwn(workspace,"connection") || (workspace.connection!==null && (typeof workspace.connection!=="object" || Array.isArray(workspace.connection))))throw new Error("Connection metadata unavailable");
      data.connection = workspace.connection as EtsyWorkspaceData["connection"]; data.runs = historyRows(runs); data.packages = packages.choices; data.runsPage=runs.page; data.packagesPage=packages.page; data.packagesUnavailable=packages.unavailable;
    } catch { data.unavailable = true; }
  }
  return <AppShell toolDestination="etsy" active="accounts" context={context} navigationBusinessId={business?.id}><ConsoleRetainedWorkspace ownerId={context.userId}  notice={<p className="coreNotice">History is server-paged and counted independently. Package totals count structurally matching candidates; current authorization is rechecked for each bounded page and before any action. Etsy Personal Access is owner reported; configuration, OAuth, purpose and operation gates remain separate.</p>} header={<>{context.businessesUnavailable ? <p role="alert">Business records are unavailable. No alternate Business was selected.</p> : null}<PageHeader eyebrow="Etsy · Experimental" title="Etsy listings" description="Prepare reviewed drafts and check assisted publication readiness." actions={<Link className="coreButton" href={`/dashboard/accounts${business ? `?business=${business.id}` : ""}`}>Back to Accounts</Link>} />
{message && <p role="status" className="etsyMessage">{message}</p>}
{context.businesses.length > 1 && <form className="etsyBusiness" method="get"><label>Business<select name="business" defaultValue={business?.id}>{context.businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="coreButton">View</button></form>}</>} panels={[{ id: "listing", label: "Listing preparation", content: <><HistoryPager page={listing?.runsPage} name="listing" label="Listing runs"/><HistoryPager page={listing?.qualificationsPage} name="listingQualification" label="Qualification runs"/><HistoryPager page={listing?.sourcesPage} name="listingSource" label="Listing candidates"/>{listing && <ListingWorkspace data={listing} />}</> },
{ id: "drafts", label: "Drafts", content: <><HistoryPager page={data?.runsPage} name="etsy" label="Draft runs"/><HistoryPager page={data?.packagesPage} name="etsyPackage" label="Package candidates"/>{data?.packagesUnavailable ? <p role="alert">Current package validation is unavailable; an empty page does not mean no eligible packages exist.</p>:null}{data ? <EtsyWorkspace data={data} /> : <p>Create a Business to prepare Etsy drafts.</p>}</> },
{ id: "publication", label: "Publication receipts", content: <><HistoryPager page={publication?.runsPage} name="publication" label="Publication runs"/><HistoryPager page={publication?.draftsPage} name="publicationDraft" label="Verified draft candidates"/>{publication && <PublicationWorkspace data={publication} />}</> }]} /></AppShell>;
}
