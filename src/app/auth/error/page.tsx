import "../../auth-entry.css";
import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="authShell">
      <header className="authTopbar">
        <Link className="appBrand" href="/login" aria-label="Agent Labs sign in">
          <span className="brandMark" aria-hidden="true">
            AL
          </span>
          <span>
            <strong>Agent Labs</strong>
            <small>Private control centre</small>
          </span>
        </Link>
      </header>

      <section className="simpleState" aria-labelledby="auth-error-heading">
        <p className="eyebrow">Authentication</p>
        <h1 id="auth-error-heading">The authentication link could not be completed.</h1>
        <p>The link may have expired or already been used. Return to the login screen.</p>
        <Link className="primaryAction" href="/login">
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
