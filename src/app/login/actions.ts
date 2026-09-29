"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type Credentials = {
  displayName: string;
  email: string;
  password: string;
};

function readCredentials(formData: FormData): Credentials {
  const displayNameValue = formData.get("displayName");
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");

  return {
    displayName: typeof displayNameValue === "string" ? displayNameValue.trim() : "",
    email: typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "",
    password: typeof passwordValue === "string" ? passwordValue : "",
  };
}

function credentialsAreValid({ displayName, email, password }: Credentials) {
  return (
    email.length <= 254 &&
    email.includes("@") &&
    password.length >= 8 &&
    password.length <= 72 &&
    displayName.length <= 120
  );
}

function goToLogin(kind: "error" | "message", code: string): never {
  redirect(`/login?${kind}=${encodeURIComponent(code)}`);
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

  if (host && /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host)) {
    return `http://${host}`;
  }

  const productionHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "agent-labs-two.vercel.app";
  return `https://${productionHost}`;
}

export async function login(formData: FormData) {
  const credentials = readCredentials(formData);

  if (!credentialsAreValid(credentials)) {
    goToLogin("error", "invalid-fields");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });

  if (error) {
    goToLogin("error", "auth-failed");
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const credentials = readCredentials(formData);

  if (!credentialsAreValid(credentials)) {
    goToLogin("error", "invalid-fields");
  }

  const supabase = await createClient();
  const origin = await getRequestOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: credentials.email,
    password: credentials.password,
    options: {
      data: credentials.displayName
        ? {
            display_name: credentials.displayName,
          }
        : undefined,
      emailRedirectTo: `${origin}/auth/confirm?next=/dashboard`,
    },
  });

  if (error) {
    goToLogin("error", "signup-failed");
  }

  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  goToLogin("message", "check-email");
}
