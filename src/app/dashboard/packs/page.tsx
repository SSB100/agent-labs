import { safeTablePage, historyRows } from "@/lib/core-ui/history-read";
import { HistoryPager } from "@/components/console/history-pager";
import { retainedFeedbackMessage } from "@/lib/core-ui/console-retained-feedback";
import { ConsoleRetainedWorkspace, ConsoleRecentRows } from "@/components/console/console-retained-workspace";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader, StatusPill } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import type { PackRelease, PackSnapshot } from "@/packs/types";
import { activatePack, launchInstalledPack, qualifyWebResearch, runEtsyDiscoverySimulation } from "./actions";
import "./packs.css";

export const dynamic="force-dynamic";
type Installation = {id:string;business_id:string;root_pack_id:string;status:string;snapshot:PackSnapshot};

export default async function PacksPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const context=await requireOwnerUiContext();
  const params=await searchParams;
  if(params.business && !context.businesses.some(b=>b.id===params.business)) notFound();
  const selected=context.businesses.find(b=>b.id===params.business) ?? (context.businessesUnavailable ? undefined : context.businesses[0]);
  const scopedBusinesses=selected ? [selected] : [];
  const [catalog,installed,qualificationCatalog]=await Promise.all([
    safeTablePage<PackRelease>(context,"packs","id,status,manifest","pack",{filters:[["manifest->>frameworkVersion","1.0"]],time:"pack_key",searchColumn:"manifest->>name",statusColumn:"status"}),
    safeTablePage<Installation>(context,"installed_packs","id,business_id,root_pack_id,status,snapshot","installation",{businessId:selected?.id,filters:[["status","active"]],time:"id"}),
    context.supabase.from("packs").select("id,status,manifest").in("pack_key",["workflow.web-research","workflow.etsy-product-discovery"]).eq("version","1.0.0").limit(3),
  ]);
  const packs=historyRows(catalog), installations=historyRows(installed), qualificationPacks=(qualificationCatalog.data??[]) as PackRelease[];
  const activeRead=selected&&packs.length?await context.supabase.from("installed_packs").select("root_pack_id",{count:"exact"}).eq("business_id",selected.id).eq("status","active").in("root_pack_id",packs.map(p=>p.id)).limit(26):{data:[],error:null,count:0};
  const activeAvailable=!activeRead.error && activeRead.count===activeRead.data?.length && (activeRead.data?.length??0)<=25;
  return <AppShell toolDestination="packs" active="packs" context={context} navigationBusinessId={selected?.id}><ConsoleRetainedWorkspace ownerId={context.userId}  notice={<p className="coreNotice">Catalog and installation pages are independently counted. Current activation is checked for the exact displayed releases. Business: {selected?.name ?? "Unavailable"}</p>} header={<><PageHeader eyebrow="System" title="Packs" description="Install capabilities, knowledge, workers, and workflows for each Business. Running workflows retain their starting versions." />
<form method="get"><input type="hidden" name="panel" value={params.panel ?? "catalog"}/><label>Business<select name="business" defaultValue={selected?.id}>{context.businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="coreButton" disabled={!selected}>Select Business</button></form>
{params.error && <p className="packNotice packNotice-error" role="alert">{retainedFeedbackMessage("packs","error",params.error)}</p>}
{params.message && <p className="packNotice" role="status">{retainedFeedbackMessage("packs","message",params.message)}</p>}
{(!catalog.page.available||!installed.page.available||!activeAvailable||qualificationCatalog.error) && <p role="alert">The pack catalog could not be loaded.</p>}</>} panels={[{ id: "catalog", label: "Catalog", content: <><section className="dashboardSection">
      <div className="sectionTitleRow"><div><p className="coreEyebrow">Available releases</p><h2>Pack catalog</h2><HistoryPager page={catalog.page} name="pack" label="Catalog releases"/></div><span className="coreCount">{packs.length}</span></div>
      <div className="packGrid"><ConsoleRecentRows label="Recent loaded packs records" rows={packs.map(({id,status,manifest:m})=><article className="packCard" key={id}>
        <div className="packCardHeading"><span className="coreEyebrow">{m.kind} · {m.ui.category}</span><StatusPill status={status}/></div>
        <h3>{m.name}</h3><p>{m.ui.summary}</p><small>{m.packKey} · {m.version}</small>
        <div className="packDependencies"><strong>Exact dependencies</strong>{m.dependencies.length?m.dependencies.map(d=><span key={d.packKey}>{d.packKey} @ {d.version}</span>):<span>No dependencies</span>}</div>
        <div className="packCardActions">{scopedBusinesses.map(b=>{
          const active=activeAvailable && activeRead.data?.some(i=>i.root_pack_id===id);
          return <form action={activatePack} key={b.id}><input type="hidden" name="businessId" value={b.id}/><input type="hidden" name="packId" value={id}/>
            <button type="submit" className="coreButton coreButton-primary" disabled={!activeAvailable||active||!["qualified","assisted","autonomous"].includes(status)}>{active?"Active":"Activate"} for {b.name}</button></form>;
        })}</div>
        <small>{m.evals.length} qualification checks required</small>
      </article>)} /></div>
    </section></> },
{ id: "installed", label: "Installed", content: <><section className="dashboardSection"><div className="sectionTitleRow"><div><p className="coreEyebrow">Business installations</p><h2>Active packs</h2><HistoryPager page={installed.page} name="installation" label="Installations"/></div><span className="coreCount">{installations.length}</span></div>
      {!installations.length&&<p className="sectionEmptyText">Activate a qualified release to install its definitions and exact dependencies.</p>}
      <div className="packGrid"><ConsoleRecentRows label="Recent loaded packs records" rows={installations.map(i=>{
        const root=i.snapshot.releases.find(r=>r.id===i.snapshot.rootPackId);
        if (!root) return null;
        return <article className="packCard" key={i.id}><p className="coreEyebrow">{context.businesses.find(b=>b.id===i.business_id)?.name}</p>
          <h3>{root.manifest.name} · {root.manifest.version}</h3>
          <div className="packDependencies"><strong>Installed versions</strong>{i.snapshot.releases.map(r=><span key={r.id}>{r.manifest.packKey} @ {r.manifest.version}</span>)}</div>
          {root.manifest.workflows.map(w=><form action={launchInstalledPack} className="packLaunch" key={w.key}>
            <input type="hidden" name="businessId" value={i.business_id}/><input type="hidden" name="installationId" value={i.id}/><input type="hidden" name="workflowKey" value={w.key}/>
            <input type="hidden" name="idempotencyKey" value={`pack:${crypto.randomUUID()}`}/>
            <label htmlFor={`input-${i.id}-${w.key}`}>{w.name} input</label>
            <textarea id={`input-${i.id}-${w.key}`} name="input" defaultValue={JSON.stringify(w.sampleInput,null,2)} required maxLength={50000} rows={4}/>
            <button type="submit" className="coreButton coreButton-primary">Run {w.name}</button>
          </form>)}
          <Link href="/dashboard/workflows">View workflows</Link>
        </article>;
      })} /></div>
    </section></> },
{ id: "qualification", label: "Qualification", content: <>{!qualificationPacks.some(p=>p.manifest.packKey === "workflow.web-research" || (p.manifest.packKey === "workflow.etsy-product-discovery" && p.manifest.version === "1.0.0" && p.status === "experimental")) ? <section><h2>No qualification tools in the loaded catalog</h2><p>Existing qualifications remain tied to exact Pack versions. This loaded catalog does not contain the supported Web Research or Etsy simulation qualification tools; no missing release or successful qualification is inferred.</p></section> : null}{qualificationPacks.some(p=>p.manifest.packKey === "workflow.web-research") ? <section className="dashboardSection">
      <div className="sectionTitleRow"><div><p className="coreEyebrow">Live qualification</p><h2>Web Research</h2></div></div>
      <p>Verify public source collection and a linked Evidence Pack using the configured model route.</p>
      <div className="packCardActions">{scopedBusinesses.map(b=><form action={qualifyWebResearch} key={b.id}>
        <input type="hidden" name="businessId" value={b.id}/><input type="hidden" name="idempotencyKey" value={`research-qualification:${crypto.randomUUID()}`}/>
        <button className="coreButton coreButton-primary" type="submit">Qualify Web Research for {b.name}</button>
      </form>)}</div>
    </section> : null}
{qualificationPacks.some(p => p.manifest.packKey === "workflow.etsy-product-discovery" && p.manifest.version === "1.0.0" && p.status === "experimental") ? <section className="dashboardSection">
      <div className="sectionTitleRow"><div><p className="coreEyebrow">Stage 12 · Simulation only</p><h2>Etsy Product Discovery</h2></div></div>
      <p>Run the sample original camping T-shirt concept through research, strategy, and independent review with mocked model responses. All nine releases stay experimental. No live demand, paid provider calls, publishing, or spending.</p>
      <p>The completed worker results pause in Needs You for acknowledgment of the simulation or a stop decision.</p>
      <div className="packCardActions">{scopedBusinesses.map(b => <form action={runEtsyDiscoverySimulation} key={b.id}>
        <input type="hidden" name="businessId" value={b.id}/><input type="hidden" name="idempotencyKey" value={`etsy-simulation:${crypto.randomUUID()}`}/>
        <button className="coreButton coreButton-primary" type="submit">Run Etsy discovery simulation for {b.name}</button>
      </form>)}</div>
    </section> : null}</> }]} /></AppShell>;
}
