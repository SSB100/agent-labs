"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function createBusiness(formData: FormData) {
  const nameValue = formData.get("name");
  const name = typeof nameValue === "string" ? nameValue.trim() : "";

  if (name.length < 1 || name.length > 120) {
    redirect("/dashboard?error=invalid-business-name");
  }

  const supabase = await createClient();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (claimsError || !userId) {
    redirect("/login?error=session-required");
  }

  const { error } = await supabase.from("businesses").insert({
    name,
    owner_user_id: userId,
  });

  if (error) {
    redirect("/dashboard?error=business-create-failed");
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?message=business-created");
}
