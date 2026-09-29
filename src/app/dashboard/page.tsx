import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { createBusiness } from "./actions";

export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Business = {
  created_at: string;
  id: string;
  name: string;
  updated_at: string;
};

const navigation = [
  { label: "Dashboard", stage: "Now", active: true },
  { label: "Workflows", stage: "Stage 3" },
  { label: "Needs You", stage: "Stage 7" },
  { label: "Accounts", stage: "Later" },
  { label: "Settings", stage: "Later" },
];

const messages: Record<string, string> = {
  "business-created": "Business created and owner membership recorded.",
};

const errors: Record<string, string> = {
  "business-create-failed": "The Business could not be created. Try again.",
  "invalid-business-name": "Use a Business name between 1 and 120 characters.",
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = claims?.sub;

  if (claimsError || !userId) {
    redirect("/login?error=session-required");
  }

  const [{ data: businessData, error: businessError }, { data: profileData }] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("id, name, created_at, updated_at")
        .eq("owner_user_id", userId)
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    ]);

  const businesses = (businessData ?? []) as Business[];
  const displayName =
    typeof profileData?.display_name === "string" && profileData.display_name.trim()
      ? profileData.display_name
      : typeof claims.email === "string"
        ? claims.email
        : "Owner";
  const query = await searchParams;
  const message = messages[firstValue(query.message) ?? ""];
  const error = errors[firstValue(query.error) ?? ""];

  return (
    <div className="appFrame">
      <aside className="appSidebar">
        <Link className="appBrand" href="/dashboard" aria-label="Agent Labs dashboard">
          <span className="brandMark" aria-hidden="true">
            AL
          </span>
          <span>
            <strong>Agent Labs</strong>
            <small>V2 Core</small>
          </span>
        </Link>

        <nav className="appNav" aria-label="Agent Labs sections">
          {navigation.map((item) =>
            item.active ? (
              <Link className="navItem active" href="/dashboard" key={item.label}>
                <span>{item.label}</span>
                <small>{item.stage}</small>
              </Link>
            ) : (
              <span aria-disabled="true" className="navItem disabled" key={item.label}>
                <span>{item.label}</span>
                <small>{item.stage}</small>
              </span>
            ),
          )}
        </nav>

        <div className="sidebarFoot">
          <span>Stage 1</span>
          <p>Identity and Business foundation only.</p>
        </div>
      </aside>

      <main className="appMain">
        <header className="workspaceHeader">
          <div>
            <p className="eyebrow">Owner workspace</p>
            <h1>Welcome, {displayName}.</h1>
          </div>
          <form action="/auth/signout" method="post">
            <button className="ghostButton" type="submit">
              Sign out
            </button>
          </form>
        </header>

        {message ? (
          <p className="notice success" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        {businessError ? (
          <p className="notice error" role="alert">
            Business records could not be loaded.
          </p>
        ) : null}

        <section className="dashboardGrid">
          <article className="businessPanel" aria-labelledby="businesses-heading">
            <div className="panelHeading">
              <div>
                <p className="panelLabel">Durable containers</p>
                <h2 id="businesses-heading">Businesses</h2>
              </div>
              <span className="countBadge">{businesses.length}</span>
            </div>

            {businesses.length ? (
              <div className="businessList">
                {businesses.map((business) => (
                  <article className="businessCard" key={business.id}>
                    <div>
                      <h3>{business.name}</h3>
                      <p>Created {formatDate(business.created_at)}</p>
                    </div>
                    <span>Owner</span>
                  </article>
                ))}
              </div>
            ) : (
              <div className="emptyState">
                <h3>No Businesses yet</h3>
                <p>Create the first durable Business container for future packs and workflows.</p>
              </div>
            )}
          </article>

          <aside className="createPanel" aria-labelledby="create-business-heading">
            <p className="panelLabel">Stage 1 action</p>
            <h2 id="create-business-heading">Create a Business</h2>
            <p>
              A Business will become the durable home for goals, installed packs, connected
              accounts, products and workflow history in later stages.
            </p>
            <form action={createBusiness} className="formStack compact">
              <label className="formField" htmlFor="business-name">
                <span>Business name</span>
                <input
                  id="business-name"
                  maxLength={120}
                  name="name"
                  placeholder="Example: North Star Studio"
                  required
                  type="text"
                />
              </label>
              <button className="primaryButton" type="submit">
                Create Business
              </button>
            </form>
          </aside>
        </section>

        <section className="foundationStrip" aria-labelledby="foundation-heading">
          <div>
            <p className="panelLabel">Current boundary</p>
            <h2 id="foundation-heading">Stage 1 remains deliberately small.</h2>
          </div>
          <ul>
            <li>Supabase Auth sessions validated with signed claims</li>
            <li>Owner-scoped Business reads and writes enforced by RLS</li>
            <li>No workflow or worker execution logic</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
