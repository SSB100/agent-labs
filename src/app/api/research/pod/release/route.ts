import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {podApplicationCapability} from "@/products/discovery-r12-pod-server-key";
import {podExecutingRelease} from "@/products/discovery-r12-pod-release";
import {podResearchSchemaPins} from "@/products/discovery-r12-pod-runtime";
import {podResearchPackManifests} from "@/products/discovery-r12-pod-packs";
import {discoveryV2Hash} from "@/products/discovery-v2";
import {POD_THOROUGH_PROFILE,POD_THOROUGH_LIMITS} from "@/products/discovery-r12-pod-profile";
import {podId} from "@/products/discovery-r12-pod-owner-contract";
export const dynamic="force-dynamic";
/** Read-only nonsecret release metadata for the separately reviewed one-time
 * application template. This endpoint cannot install a grant or start work. */
export async function GET(request:Request){
 const businessId=new URL(request.url).searchParams.get("business"),client=await createClient();
 const claims=await client.auth.getClaims(),owner=claims.data?.claims?.sub;
 if(!podId(businessId)||claims.error||!podId(owner))return NextResponse.json({available:false},{status:403,headers:{"Cache-Control":"no-store"}});
 const business=await client.from("businesses").select("id").eq("id",businessId).eq("owner_user_id",owner).maybeSingle();
 if(business.error||business.data?.id!==businessId)return NextResponse.json({available:false},{status:403,headers:{"Cache-Control":"no-store"}});
 try{return NextResponse.json({version:"r12.pod-application-verifier.1",businessId,applicationCapabilityHash:createHash("sha256").update(podApplicationCapability()).digest("hex"),
  executingRelease:podExecutingRelease(),schemas:podResearchSchemaPins(),recoverySchemas:podResearchSchemaPins(true),packs:podResearchPackManifests().map(p=>({packKey:p.packKey,version:p.version,manifestHash:discoveryV2Hash(p)})),thorough:{profile:POD_THOROUGH_PROFILE,profileHash:discoveryV2Hash(POD_THOROUGH_LIMITS),schemas:podResearchSchemaPins(false,true),recoverySchemas:podResearchSchemaPins(true,true),packs:podResearchPackManifests(true).map(p=>({packKey:p.packKey,version:p.version,manifestHash:discoveryV2Hash(p)}))},authorityCreated:false}, {headers:{"Cache-Control":"no-store"}});}
 catch{return NextResponse.json({available:false},{status:503,headers:{"Cache-Control":"no-store"}});}
}
