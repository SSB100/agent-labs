import {requireOwnerUiContext} from '@/lib/core-ui/data';
import {prepareDiscoveryR12Authority} from '@/products/discovery-r12-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
/** Owner-only nonsecret preparation. It enrolls nothing and invokes no provider.
 * The separately approved operator transaction registers exact expiring hashes. */
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||!request.body)return Response.json({error:'preparation_unavailable'},{status:403,headers});
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>512)return Response.json({error:'preparation_unavailable'},{status:413,headers});parts.push(part.value);}}finally{await reader.cancel();}
  const body:unknown=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='businessId,scopeId'||!('businessId'in body)||!('scopeId'in body)||typeof body.businessId!=='string'||typeof body.scopeId!=='string')return Response.json({error:'preparation_unavailable'},{status:400,headers});
  const prepared=await prepareDiscoveryR12Authority(await requireOwnerUiContext(),body.businessId,body.scopeId);
  return Response.json({...prepared,businessId:body.businessId,scopeId:body.scopeId},{headers});
 }catch{return Response.json({error:'preparation_unavailable'},{status:403,headers});}
}
