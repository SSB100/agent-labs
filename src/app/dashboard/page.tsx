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
  { label: "Control centre", active: true },
  { label: "Workflows" },
  { label: "Needs you" },
  { label: "Accounts" },
  { label: "Settings" },
];

const messages: Record<string, string> = {
  "business-created": "Business created.",
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
  const email = typeof claims.email === "string" ? claims.email : "Owner";
  const displayName =
    typeof profileData?.display_name === "string" && profileData.display_name.trim()
      ? profileData.display_name
      : email;
  const query = await searchParams;
  const message = messages[firstValue(query.message) ?? ""];
  const error = errors[firstValue(query.error) ?? ""];
  const summary = [
    { label: "Businesses", value: businesses.length.toString() },
    { label: "Active workflows", value: "0" },
    { label: "Needs you", value: "0" },
    { label: "Connected accounts", value: "0" },
  ];

  return (
    <div className="appFrame">
      <aside className="appSidebar">
        <Link className="appBrand" href="/dashboard" aria-label="Agent Labs control centre">
          <span className="brandMark" aria-hidden="true">
            AL
          </span>
          <span>
            <strong>Agent Labs</strong>
            <small>Control centre</small>
          </span>
        </Link>

        <nav className="appNav" aria-label="Agent Labs sections">
          {navigation.map((item) =>
            item.active ? (
              <Link className="navItem active" href="/dashboard" key={item.label}>
                {item.label}
              </Link>
            ) : (
              <span aria-disabled="true" className="navItem disabled" key={item.label}>
                <span>{item.label}</span>
                <small>Soon</small>
              </span>
            ),
          )}
        </nav>

        <div className="sidebarFoot">
          <span>Signed in</span>
          <p>{email}</p>
        </div>
      </aside>

      <main className="appMain">
        <header className="workspaceHeader">
          <div className="workspaceTitle">
            <p>Agent Labs</p>
            <h1>Control centre</h1>
          </div>
          <div className="workspaceAccount">
            <span>{displayName}</span>
            <form action="/auth/signout" method="post">
              <button className="ghostButton" type="submit">
                Sign out
              </button>
            </form>
          </div>
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

        <section className="summaryGrid" aria-label="Control centre summary">
          {summary.map((item) => (
            <article className="summaryCard" key={item.label}>
              <span className="summaryLabel">{item.label}</span>
              <strong className="summaryValue">{item.value}</strong>
            </article>
          ))}
        </section>

        <section className="dashboardGrid">
          <article className="businessPanel" aria-labelledby="businesses-heading">
            <div className="panelHeading">
              <div>
                <p className="panelLabel">Workspaces</p>
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
                <p>Create the first Business to begin setting up Agent Labs.</p>
              </div>
            )}
          </article>

          <aside className="createPanel" aria-labelledby="create-business-heading">
            <p className="panelLabel">New workspace</p>
            <h2 id="create-business-heading">Create a Business</h2>
            <form action={createBusiness} className="formStack compact">
              <label className="formField" htmlFor="business-name">
                <span>Business name</span>
                <input
                  id="business-name"
                  maxLength={120}
                  name="name"
                  placeholder="Business name"
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

        <section className="operationsPanel" aria-labelledby="operations-heading">
          <div className="panelHeading">
            <div>
              <p className="panelLabel">Live activity</p>
              <h2 id="operations-heading">Current operations</h2>
            </div>
          </div>
          <div className="operationEmpty">
            <strong>No workflows are running.</strong>
            <span>Workflow activity will appear here as later stages are connected.</span>
          </div>
        </section>
      </main>
    </div>
  );
}
