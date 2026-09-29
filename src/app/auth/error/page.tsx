import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="authShell">
      <header className="authTopbar">
        <Link className="brand" href="/" aria-label="Agent Labs home">
          <span className="brandMark" aria-hidden="true">
            AL
          </span>
          <span>
            <strong>Agent Labs</strong>
            <small>V2 foundation</small>
          </span>
        </Link>
      </header>

      <section className="simpleState" aria-labelledby="auth-error-heading">
        <p className="eyebrow">Authentication</p>
        <h1 id="auth-error-heading">The confirmation link could not be completed.</h1>
        <p>The link may have expired or already been used. Return to sign in and try again.</p>
        <Link className="primaryAction" href="/login">
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
