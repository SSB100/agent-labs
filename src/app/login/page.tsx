import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { login, signup } from "./actions";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<string, string> = {
  "check-email": "Check your email to confirm your account, then return here to sign in.",
  "signed-out": "You have been signed out safely.",
};

const errors: Record<string, string> = {
  "auth-failed": "The email or password was not accepted.",
  "invalid-fields": "Use a valid email and a password between 8 and 72 characters.",
  "session-required": "Sign in to open your Agent Labs dashboard.",
  "signup-failed": "The account could not be created. Check the details and try again.",
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims?.sub) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const message = messages[firstValue(query.message) ?? ""];
  const error = errors[firstValue(query.error) ?? ""];

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
        <span className="stageBadge">Stage 1</span>
      </header>

      <section className="authPanel" aria-labelledby="auth-heading">
        <div className="authIntro">
          <p className="eyebrow">Identity foundation</p>
          <h1 id="auth-heading">Enter your workspace.</h1>
          <p>
            Stage 1 provides secure authentication and owner-scoped Business records.
            Workflow and worker features remain intentionally unavailable until later stages.
          </p>
          <Link className="textLink" href="/">
            Return to foundation overview
          </Link>
        </div>

        <div className="authCard">
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

          <div className="authGrid">
            <form className="formStack" action={login}>
              <div>
                <p className="panelLabel">Existing account</p>
                <h2>Sign in</h2>
              </div>
              <label className="formField" htmlFor="login-email">
                <span>Email</span>
                <input
                  autoComplete="email"
                  id="login-email"
                  maxLength={254}
                  name="email"
                  required
                  type="email"
                />
              </label>
              <label className="formField" htmlFor="login-password">
                <span>Password</span>
                <input
                  autoComplete="current-password"
                  id="login-password"
                  maxLength={72}
                  minLength={8}
                  name="password"
                  required
                  type="password"
                />
              </label>
              <button className="primaryButton" type="submit">
                Sign in
              </button>
            </form>

            <form className="formStack" action={signup}>
              <div>
                <p className="panelLabel">New owner</p>
                <h2>Create account</h2>
              </div>
              <label className="formField" htmlFor="signup-name">
                <span>Display name</span>
                <input
                  autoComplete="name"
                  id="signup-name"
                  maxLength={120}
                  name="displayName"
                  type="text"
                />
              </label>
              <label className="formField" htmlFor="signup-email">
                <span>Email</span>
                <input
                  autoComplete="email"
                  id="signup-email"
                  maxLength={254}
                  name="email"
                  required
                  type="email"
                />
              </label>
              <label className="formField" htmlFor="signup-password">
                <span>Password</span>
                <input
                  autoComplete="new-password"
                  id="signup-password"
                  maxLength={72}
                  minLength={8}
                  name="password"
                  required
                  type="password"
                />
              </label>
              <button className="secondaryButton" type="submit">
                Create account
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
