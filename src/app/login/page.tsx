import "../auth-entry.css";
import { redirect } from "next/navigation";

import { ownerReturnPath } from "@/core/owner-entry";
import { createClient } from "@/lib/supabase/server";

import { login } from "./actions";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<string, string> = {
  "signed-out": "You have been signed out.",
};

const errors: Record<string, string> = {
  "auth-failed": "The email or password was not accepted.",
  "invalid-fields": "Enter a valid email and password.",
  "session-required": "Sign in to open the Agent Labs control centre.",
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const returnPath = ownerReturnPath(firstValue(query.returnTo));
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims?.sub) {
    redirect(returnPath);
  }

  const message = messages[firstValue(query.message) ?? ""];
  const error = errors[firstValue(query.error) ?? ""];

  return (
    <main className="loginShell">
      <section className="loginCard" aria-labelledby="login-heading">
        <div className="loginBrand">
          <span className="brandMark" aria-hidden="true">
            AL
          </span>
          <span>
            <strong>Agent Labs</strong>
            <small>Private control centre</small>
          </span>
        </div>

        <div className="loginHeading">
          <h1 id="login-heading">Sign in</h1>
          <p>Owner access only.</p>
        </div>

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

        <form className="loginForm" action={login}>
          <input type="hidden" name="returnTo" value={returnPath} />
          <label className="formField" htmlFor="email">
            <span>Email</span>
            <input
              autoComplete="email"
              id="email"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </label>

          <label className="formField" htmlFor="password">
            <span>Password</span>
            <input
              autoComplete="current-password"
              id="password"
              maxLength={72}
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>

          <button className="primaryButton" type="submit">
            Open control centre
          </button>
        </form>

        <p className="loginFooter">This application is not open for public registration.</p>
      </section>
    </main>
  );
}
