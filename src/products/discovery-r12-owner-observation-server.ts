import "server-only";
import { discoveryV2Hash } from "./discovery-v2-hash";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { boundedRpc, requestDeadline } from "../core/request-deadline";
import { validateOwnerObservationBundle, validateOwnerObservationSelection,
  type OwnerObservationBundle, type OwnerObservationSelection } from "./discovery-r12-owner-observation";

const id=(v:unknown):v is string=>typeof v==="string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
const fail=():never=>{throw new Error("r12_owner_observation_unavailable");};

async function authority(context:OwnerUiContext,businessId:string,_grantId:string) {
  void _grantId;
  if (!id(businessId) || !id(context.userId) || !await verifyOwnerBusiness(context,businessId)) return fail();
  const claims=await context.supabase.auth.getClaims();
  if (claims.error || claims.data?.claims?.sub !== context.userId) return fail();
  // Own private captures do not create grants, spending or provider access.
  return null;
}

/** Authenticated private capture storage, not a provider verification or send. */
async function observation(context:OwnerUiContext,businessId:string,grantId:string,operation:"save"|"read",payload:Record<string,unknown>) {
  const serverKey=await authority(context,businessId,grantId);
  const result=await boundedRpc(context.supabase.rpc("r12_owner_observation_server",{
    p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:serverKey,
  }),requestDeadline(15_000),10_000);
  const data=result.data;
  if (result.error || !object(data) || Object.keys(data).sort().join(",") !== "bundle,version" || data.version !== "r12.owner-observation-receipt.1") return fail();
  return validateOwnerObservationBundle(data.bundle,{businessId,ownerId:context.userId});
}

export async function saveOwnerResearchObservation(context:OwnerUiContext,businessId:string,grantId:string,raw:unknown):Promise<OwnerObservationBundle> {
  const bundle=validateOwnerObservationBundle(raw,{businessId,ownerId:context.userId});
  const saved=await observation(context,businessId,grantId,"save",{bundle});
  if (saved.id !== bundle.id || saved.bundleHash !== bundle.bundleHash) return fail();
  return saved;
}

export async function readOwnerResearchObservation(context:OwnerUiContext,businessId:string,grantId:string,bundleId:string):Promise<OwnerObservationBundle> {
  if (!id(bundleId)) return fail();
  const saved=await observation(context,businessId,grantId,"read",{bundleId});
  if (saved.id !== bundleId) return fail();
  return saved;
}

/** Resolve every selected immutable row before constructing a reviewed packet.
 * SQL repeats ownership, membership and hash checks under confirmation locks. */
export async function readOwnerResearchObservationSelection(context:OwnerUiContext,businessId:string,grantId:string,raw:unknown):Promise<OwnerObservationSelection|null> {
  const selection=validateOwnerObservationSelection(raw);
  if (selection===null) return null;
  const bundleIds=new Set(selection.manifest.map(m=>m.bundleId)),artifactIds=new Set<string>(),sourceIds=new Set<string>();
  let bytes=0,observations=0;
  for (const pin of selection.manifest) {
    const bundle=await readOwnerResearchObservation(context,businessId,grantId,pin.bundleId);
    if (bundle.bundleHash !== pin.bundleHash || pin.selectedObservationIds.some(v=>!bundle.observations.some(o=>o.id===v))) return fail();
    bytes+=Buffer.byteLength(JSON.stringify(bundle));observations+=bundle.observations.length;
    if (bytes>16_384 || observations>8) return fail();
    for (const o of bundle.observations) {
      if (artifactIds.has(o.id) || bundleIds.has(o.id) || sourceIds.has(o.sourceId)) return fail();
      artifactIds.add(o.id);sourceIds.add(o.sourceId);
    }
  }
  return selection;
}

/** Bounded, owner-scoped history; no external disclosure or provider operation. */
export async function listOwnerResearchObservations(context:OwnerUiContext,businessId:string,grantId:string) {
  const serverKey=await authority(context,businessId,grantId);
  const result=await boundedRpc(context.supabase.rpc("r12_owner_observation_server",{
    p_business_id:businessId,p_operation:"list",p_payload:{},p_server_key:serverKey,
  }),requestDeadline(15_000),10_000);
  const data=result.data;
  if(result.error || !object(data) || Object.keys(data).sort().join(",")!=="bundles,version" ||
     data.version!=="r12.owner-observation-list.1" || !Array.isArray(data.bundles) || data.bundles.length>20) return fail();
  return data.bundles.map(raw=>validateOwnerObservationBundle(raw,{businessId,ownerId:context.userId}));
}
export function selectWholeOwnerObservationBundle(bundle:OwnerObservationBundle):OwnerObservationSelection {
  const manifest=[{bundleId:bundle.id,bundleHash:bundle.bundleHash,selectedObservationIds:bundle.observations.map(o=>o.id)}];
  return {manifest,manifestHash:discoveryV2Hash(manifest)};
}
