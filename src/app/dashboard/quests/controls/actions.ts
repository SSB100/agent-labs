"use server";

import { createClient } from "@/lib/supabase/server";
import { ADMISSION_RPC, type AdmissionOwnerOperation } from "@/core/admission-contract";
import { containsCredentialLikeValue } from "@/core/quest-intake";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function saveOperatingControl(businessId: string, operation: AdmissionOwnerOperation, payload: unknown, submissionId: string): Promise<{ok:boolean;message:string}> {
  if (!UUID.test(businessId) || !UUID.test(submissionId) || !["propose","confirm","revoke","pause","resume"].includes(operation)) return {ok:false,message:"Invalid request. Reload this Business."};
  let encoded: string;
  try { encoded = JSON.stringify(payload); } catch { return {ok:false,message:"Invalid request."}; }
  if (!encoded || encoded.length > 24000 || containsCredentialLikeValue(payload)) return {ok:false,message:"The request is too large or contains credential-like content. Use Connections for credentials."};
  const client = await createClient();
  const {data:claims,error:authError} = await client.auth.getClaims();
  if (authError || !claims?.claims?.sub) return {ok:false,message:"Your session expired. Sign in and reload before saving."};
  const {error} = await client.rpc(ADMISSION_RPC.owner,{p_business_id:businessId,p_operation:operation,p_payload:payload,p_submission_id:submissionId});
  return error ? {ok:false,message:"The change could not be verified. Reload and review current revisions, exposure and eligibility before retrying."} : {ok:true,message:"Saved. No provider operation was started."};
}
