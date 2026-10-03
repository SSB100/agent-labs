import type { OwnerUiContext } from "./data";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const lookups=new WeakMap<OwnerUiContext,Map<string,Promise<boolean>>>();
/** The directory is a verified cache, not a complete ownership set. SQL mutation guards remain authoritative. */
export async function verifyOwnerBusiness(context:OwnerUiContext,businessId:unknown):Promise<boolean>{
  if(typeof businessId!=="string" || !uuid.test(businessId))return false;
  if(context.businesses.some(b=>b.id===businessId))return true;
  if(!uuid.test(context.userId ?? ""))return false;
  let cache=lookups.get(context);if(!cache){cache=new Map();lookups.set(context,cache);}
  if(!cache.has(businessId))cache.set(businessId,(async()=>{
    try{
      const {data,error}=await context.supabase.from("businesses").select("id,name,created_at,updated_at").eq("id",businessId).eq("owner_user_id",context.userId).maybeSingle();
      if(error || !data || data.id!==businessId || typeof data.name!=="string")return false;
      // Cache only this request's independently owner-verified exact record.
      // Directory total/page metadata and durable mutation authority are unchanged.
      if(!context.businesses.some(b=>b.id===businessId))context.businesses.push(data);
      return true;
    }catch{return false;}
  })());
  return cache.get(businessId)!;
}
