import { randomBytes, createHash } from "node:crypto";
import { etsyJson, formBody } from "../etsy/adapter";
import { READ_SCOPES, ETSY_CALLBACK, fingerprint, requireConnection, record, type QualificationPermit } from "./contracts";
export type ReadTokens = { accessToken: string; refreshToken: string; userId: number; tokenExpiresAt: string; scopes: string[] };
export type EtsyReadProof = { userId: number; shopId: number; shopName: string; currency: string; listingCount: number; totalDrafts: number; factsHash: string; verifiedAt: string };
export type ReadApiConfig = { keystring: string; sharedSecret: string };
export function readOAuthStart(config: ReadApiConfig) {
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url"), nonce = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({response_type:"code",client_id:config.keystring,redirect_uri:ETSY_CALLBACK,scope:READ_SCOPES.join(" "),state,
    code_challenge_method:"S256",code_challenge:createHash("sha256").update(verifier).digest("base64url")});
  return {state,verifier,nonce,url:`https://www.etsy.com/oauth/connect?${query}`};
}
export type PermitProvider = (step: number, endpoint: string, method: "GET" | "POST", facts?: Record<string,unknown>) => Promise<QualificationPermit>;
async function request(config: ReadApiConfig, url: string, method: "GET" | "POST", step: number, permit: PermitProvider, fetcher: typeof fetch, token?: string, body?: URLSearchParams, facts?: Record<string,unknown>) {
  const authorization = await permit(step,url,method,facts), deadline=Date.parse(authorization.expiresAt);
  requireConnection(deadline>Date.now(),"connection_dispatch_expired");
  return etsyJson(fetcher,url,{method,headers:{"x-api-key":`${config.keystring}:${config.sharedSecret}`,Accept:"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body},
    {operation:method==="POST"?"r11.account.oauth":"r11.own-shop.read",admitDispatch:async descriptor=>{
      requireConnection(descriptor.endpoint===authorization.endpoint&&descriptor.method===authorization.method&&deadline>Date.now(),"connection_dispatch_expired");
    }});
}
export async function exchangeReadOAuth(config: ReadApiConfig, input: {code:string;verifier:string}, permit: PermitProvider, fetcher: typeof fetch=fetch): Promise<ReadTokens> {
  const owned={...config},value={...input};
  requireConnection(value.code.length>=8&&value.code.length<=4096&&/^[A-Za-z0-9_-]{43,128}$/.test(value.verifier));
  const raw=record(await request(owned,"https://api.etsy.com/v3/public/oauth/token","POST",0,permit,fetcher,undefined,formBody({grant_type:"authorization_code",client_id:owned.keystring,redirect_uri:ETSY_CALLBACK,code:value.code,code_verifier:value.verifier})));
  const scopes=typeof raw.scope==="string"?raw.scope.split(" "):[];
  requireConnection(raw.token_type==="Bearer"&&typeof raw.access_token==="string"&&/^\d+\.[^\s]{8,8192}$/.test(raw.access_token)&&typeof raw.refresh_token==="string"&&/^\d+\.[^\s]{8,8192}$/.test(raw.refresh_token)&&
    Number.isSafeInteger(raw.expires_in)&&Number(raw.expires_in)>30&&Number(raw.expires_in)<=3600,"read_only_token_unverified");
  requireConnection(scopes.length===READ_SCOPES.length&&READ_SCOPES.every(s=>scopes.includes(s)),"granted_scopes_unverified");
  const userId=Number(raw.access_token.split(".")[0]);
  requireConnection(Number.isSafeInteger(userId)&&userId>0&&String(userId)===raw.refresh_token.split(".")[0],"read_only_identity_mismatch");
  return {accessToken:raw.access_token,refreshToken:raw.refresh_token,userId,tokenExpiresAt:new Date(Date.now()+Number(raw.expires_in)*1000-30_000).toISOString(),scopes:[...READ_SCOPES]};
}
export async function verifyEtsyReadConnection(config: ReadApiConfig, tokens: ReadTokens, expectedShop: string, permit: PermitProvider, fetcher: typeof fetch=fetch): Promise<EtsyReadProof> {
  const owned={...tokens,scopes:[...tokens.scopes]},settings={...config};requireConnection(Date.parse(owned.tokenExpiresAt)>Date.now());
  const shop=record(await request(settings,`https://api.etsy.com/v3/application/users/${owned.userId}/shops`,"GET",1,permit,fetcher,owned.accessToken,undefined,{userId:owned.userId,scopes:owned.scopes,tokenExpiresAt:owned.tokenExpiresAt}));
  requireConnection(shop.user_id===owned.userId&&Number.isSafeInteger(shop.shop_id)&&Number(shop.shop_id)>0&&shop.shop_name===expectedShop&&typeof shop.currency_code==="string"&&/^[A-Z]{3}$/.test(shop.currency_code),"read_only_shop_mismatch");
  const shopId=Number(shop.shop_id),url=`https://api.etsy.com/v3/application/shops/${shopId}/listings?state=draft&limit=1&offset=0`;
  const page=record(await request(settings,url,"GET",2,permit,fetcher,owned.accessToken,undefined,{shopId,shopName:expectedShop,currency:shop.currency_code,userId:owned.userId}));
  requireConnection(Number.isSafeInteger(page.count)&&Number(page.count)>=0&&Array.isArray(page.results)&&page.results.length<=1&&Number(page.count)>=page.results.length,"read_only_listing_response_invalid");
  const facts=page.results.map(value=>{const row=record(value);requireConnection(Number.isSafeInteger(row.listing_id)&&Number(row.listing_id)>0&&row.shop_id===shopId&&row.user_id===owned.userId&&row.state==="draft","read_only_listing_identity_mismatch");return {listingId:row.listing_id,shopId,userId:owned.userId,state:"draft"};});
  requireConnection(Date.parse(owned.tokenExpiresAt)>Date.now(),"read_only_token_expired");
  return {userId:owned.userId,shopId,shopName:expectedShop,currency:shop.currency_code,listingCount:facts.length,totalDrafts:Number(page.count),factsHash:fingerprint(JSON.stringify(facts)),verifiedAt:new Date().toISOString()};
}
