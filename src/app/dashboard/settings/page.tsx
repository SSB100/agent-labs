import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { ConsoleRetainedWorkspace, ConsoleRecentRows } from "@/components/console/console-retained-workspace";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
export const dynamic = "force-dynamic";
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireOwnerUiContext(), query = await searchParams;
  const requested = query.business;
  if (requested && (typeof requested !== "string" || !context.businesses.some(b => b.id === requested))) notFound();
  const selected = context.businesses.find(b => b.id === requested);
  return <AppShell active="settings" toolDestination="settings" context={context} navigationBusinessId={selected?.id}>
    <ConsoleRetainedWorkspace ownerId={context.userId} header={<PageHeader eyebrow="Private owner workspace" title="Profile & Business" description="Your profile is separate from Business rules and execution authority." />} panels={[
      { id: "profile", label: "Profile", content: <section><h2>Owner profile</h2><dl className="detailList"><div><dt>Display name</dt><dd>{context.displayName}</dd></div><div><dt>Email</dt><dd>{context.email}</dd></div><div><dt>Access</dt><dd>Administratively provisioned owner account. Public registration is disabled.</dd></div></dl><form action="/auth/signout" method="post"><button className="coreButton" type="submit">Sign out</button></form></section> },
      { id: "businesses", label: "Businesses", content: <section><h2>Owned Businesses</h2><p>Loaded Business directory only. Directory paging and persistent rules remain pending R06 and R04.</p>{context.businessesUnavailable ? <p role="alert">Business records are unavailable. No substitute Business was selected.</p> : <ConsoleRecentRows label="Owned Businesses" rows={(selected ? [selected] : context.businesses).map(b => <article className="businessCard" key={b.id}><h3>{b.name}</h3><p>Business {b.id}</p><Link className="coreButton" href={`/dashboard?view=overview&business=${b.id}`}>Open this Business</Link><Link className="coreButton" href={`/dashboard?view=connections&business=${b.id}`}>Connections</Link></article>)} />}</section> },
      { id: "boundaries", label: "Privacy & access", content: <section><h2>Private by design</h2><p>Signed-out visitors see the private login screen. Business records remain owner scoped. Provider credentials remain server only, separate from worker context.</p><p>Current profile fields are read only. Persistent Business rules, versioning and Quest identity require the independently reviewed R04 contract.</p></section> },
    ]} />
  </AppShell>;
}
