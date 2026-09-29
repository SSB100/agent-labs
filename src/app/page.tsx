import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/supabase/env";

const stageItems = [
  "Cloud application scaffold",
  "Supabase and Vercel connection",
  "Identity and Business foundation",
];

export default function HomePage() {
  const supabaseConfigured = isSupabaseConfigured();
  const vercelEnvironment = process.env.VERCEL_ENV;

  const services = [
    {
      label: "Application",
      detail: "Next.js App Router and TypeScript",
      state: "Ready",
      ready: true,
    },
    {
      label: "Supabase",
      detail: supabaseConfigured
        ? "Agent Labs project environment is configured"
        : "Add the two public Supabase environment variables",
      state: supabaseConfigured ? "Connected" : "Configuration needed",
      ready: supabaseConfigured,
    },
    {
      label: "Identity",
      detail: "Email/password auth with owner-scoped Business records",
      state: "Foundation ready",
      ready: true,
    },
    {
      label: "Vercel",
      detail: vercelEnvironment
        ? `${vercelEnvironment} deployment`
        : "Local or GitHub scaffold",
      state: vercelEnvironment ? "Deployed" : "Ready to deploy",
      ready: Boolean(vercelEnvironment),
    },
  ];

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Agent Labs home">
          <span className="brandMark" aria-hidden="true">
            AL
          </span>
          <span>
            <strong>Agent Labs</strong>
            <small>V2 foundation</small>
          </span>
        </a>
        <span className="stageBadge">Stage 1</span>
      </header>

      <section className="hero" id="top">
        <div className="heroCopy">
          <p className="eyebrow">Cloud foundation</p>
          <h1>Build specialised AI workforces on a dependable core.</h1>
          <p className="intro">
            Agent Labs V2 now has its first secure owner workspace. Authentication,
            durable Business records and row-level isolation are in place before any
            workflow or worker logic is introduced.
          </p>
          <div className="actions">
            <Link className="primaryAction" href="/login">
              Sign in or create account
            </Link>
            <Link className="secondaryAction" href="/dashboard">
              Open dashboard
            </Link>
            <a className="secondaryAction" href="/api/health">
              View health check
            </a>
          </div>
        </div>

        <aside className="stagePanel" aria-label="Current foundation scope">
          <p className="panelLabel">Current scope</p>
          <ol>
            {stageItems.map((item, index) => (
              <li key={item}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ol>
          <p className="scopeNote">No workflow or worker logic has been added yet.</p>
        </aside>
      </section>

      <section className="statusSection" aria-labelledby="status-heading">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Infrastructure status</p>
            <h2 id="status-heading">Foundation services</h2>
          </div>
          <p>Configuration is checked at runtime without exposing secrets.</p>
        </div>

        <div className="serviceGrid fourColumns">
          {services.map((service) => (
            <article className="serviceCard" key={service.label}>
              <div className="serviceHeader">
                <h3>{service.label}</h3>
                <span className={service.ready ? "status ready" : "status pending"}>
                  {service.state}
                </span>
              </div>
              <p>{service.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <span>Agent Labs V2</span>
        <span>Workflow first. Durable by design.</span>
      </footer>
    </main>
  );
}
