import { isSupabaseConfigured } from "@/lib/supabase/env";

const stageItems = [
  "Cloud application scaffold",
  "Supabase connection",
  "Vercel deployment foundation",
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
      label: "Vercel",
      detail: vercelEnvironment
        ? `${vercelEnvironment} deployment`
        : "Local or GitHub scaffold",
      state: vercelEnvironment ? "Deployed" : "Ready to import",
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
            The first deployable Agent Labs V2 shell is in place. This foundation keeps
            application hosting, identity and durable data separate from the workflow
            packs that will be added later.
          </p>
          <div className="actions">
            <a className="primaryAction" href="/api/health">
              View health check
            </a>
            <a
              className="secondaryAction"
              href="https://github.com/SSB100/agent-labs"
              rel="noreferrer"
              target="_blank"
            >
              Open repository
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
          <p>Configuration is checked at runtime without exposing keys.</p>
        </div>

        <div className="serviceGrid">
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
