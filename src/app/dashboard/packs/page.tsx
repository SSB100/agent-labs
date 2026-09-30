import Link from "next/link";
import { AppShell, PageHeader, StatusPill } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import type { PackRelease, PackSnapshot } from "@/packs/types";
import { activatePack, launchInstalledPack, qualifyWebResearch } from "./actions";
import "./packs.css";

export const dynamic="force-dynamic";
type Installation = {id:string;business_id:string;root_pack_id:string;status:string;snapshot:PackSnapshot};

export default async function PacksPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const context=await requireOwnerUiContext();
  const [catalog,installed,params]=await Promise.all([
    context.supabase.from("packs").select("id,status,manifest").eq("manifest->>frameworkVersion","1.0").order("pack_key").order("version"),
    context.supabase.from("installed_packs").select("id,business_id,root_pack_id,status,snapshot").eq("status","active"),searchParams,
  ]);
  const packs=(catalog.data??[]) as PackRelease[], installations=(installed.data??[]) as Installation[];
  return <AppShell active="packs" context={context}>
    <PageHeader eyebrow="System" title="Packs" description="Install capabilities, knowledge, workers, and workflows for each Business. Running workflows retain their starting versions." />
    {params.error && <p className="packNotice packNotice-error" role="alert">{params.error}</p>}
    {params.message && <p className="packNotice" role="status">{params.message}</p>}
    {(catalog.error||installed.error) && <p role="alert">The pack catalog could not be loaded.</p>}
    {packs.some(p=>p.manifest.packKey === "workflow.web-research") ? <section className="dashboardSection">
      <div className="sectionTitleRow"><div><p className="coreEyebrow">Live qualification</p><h2>Web Research</h2></div></div>
      <p>Verify public source collection and a linked Evidence Pack using the configured model route.</p>
      <div className="packCardActions">{context.businesses.map(b=><form action={qualifyWebResearch} key={b.id}>
        <input type="hidden" name="businessId" value={b.id}/><input type="hidden" name="idempotencyKey" value={`research-qualification:${crypto.randomUUID()}`}/>
        <button className="coreButton coreButton-primary" type="submit">Qualify Web Research for {b.name}</button>
      </form>)}</div>
    </section> : null}
    <section className="dashboardSection">
      <div className="sectionTitleRow"><div><p className="coreEyebrow">Available releases</p><h2>Pack catalog</h2></div><span className="coreCount">{packs.length}</span></div>
      <div className="packGrid">{packs.map(({id,status,manifest:m})=><article className="packCard" key={id}>
        <div className="packCardHeading"><span className="coreEyebrow">{m.kind} · {m.ui.category}</span><StatusPill status={status}/></div>
        <h3>{m.name}</h3><p>{m.ui.summary}</p><small>{m.packKey} · {m.version}</small>
        <div className="packDependencies"><strong>Exact dependencies</strong>{m.dependencies.length?m.dependencies.map(d=><span key={d.packKey}>{d.packKey} @ {d.version}</span>):<span>No dependencies</span>}</div>
        <div className="packCardActions">{context.businesses.map(b=>{
          const active=installations.some(i=>i.business_id===b.id&&i.root_pack_id===id);
          return <form action={activatePack} key={b.id}><input type="hidden" name="businessId" value={b.id}/><input type="hidden" name="packId" value={id}/>
            <button type="submit" className="coreButton coreButton-primary" disabled={active||!["qualified","assisted","autonomous"].includes(status)}>{active?"Active":"Activate"} for {b.name}</button></form>;
        })}</div>
        <small>{m.evals.length} qualification checks required</small>
      </article>)}</div>
    </section>
    <section className="dashboardSection"><div className="sectionTitleRow"><div><p className="coreEyebrow">Business installations</p><h2>Active packs</h2></div><span className="coreCount">{installations.length}</span></div>
      {!installations.length&&<p className="sectionEmptyText">Activate a qualified release to install its definitions and exact dependencies.</p>}
      <div className="packGrid">{installations.map(i=>{
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
      })}</div>
    </section>
  </AppShell>;
}
