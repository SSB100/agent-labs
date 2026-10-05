"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ownerLoginPath, ownerReturnPath } from "@/core/owner-entry";
import { createClient } from "@/lib/supabase/server";

type Credentials = {
  email: string;
  password: string;
};

function readCredentials(formData: FormData): Credentials {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");

  return {
    email: typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "",
    password: typeof passwordValue === "string" ? passwordValue : "",
  };
}

function credentialsAreValid({ email, password }: Credentials) {
  return (
    email.length > 3 &&
    email.length <= 254 &&
    email.includes("@") &&
    password.length >= 8 &&
    password.length <= 72
  );
}

function goToLogin(code: string, returnPath: string): never {
  redirect(ownerLoginPath(code, returnPath));
}

export async function login(formData: FormData) {
  const credentials = readCredentials(formData);
  const returnPath = ownerReturnPath(formData.get("returnTo"));

  if (!credentialsAreValid(credentials)) {
    goToLogin("invalid-fields", returnPath);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    goToLogin("auth-failed", returnPath);
  }

  revalidatePath("/", "layout");
  redirect(returnPath);
}
