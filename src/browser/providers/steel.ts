import type {
  BrowserProviderAdapter,
  BrowserProviderSession,
  BrowserSessionCreateRequest,
} from "../types";
import { BrowserProviderError } from "../types";
import { requireTransportAdmission, type TransportAdmission } from "../../core/transport-admission";

import { awaitRequestDeadline, requestDeadline } from "../../core/request-deadline";
import {captureSteelCreateGuard,steelCreateConfigurationAdmission,validateSteelCreateConfigurationPermit,type SteelCreateConfigurationGuard} from "../etsy-steel-create-binding";

const DEFAULT_BASE_URL = "https://api.steel.dev";
const DEFAULT_TIMEOUT_MS = 15_000;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? (record[key] as string) : null;
}

function statusCategory(status: number) {
  if (status === 401 || status === 403) return "authentication_required" as const;
  if (status === 404) return "session_not_found" as const;
  if (status === 429) return "rate_limited" as const;
  if (status >= 500) return "provider_unavailable" as const;
  return "provider_rejected" as const;
}

export function isSteelConfigured() {
  return Boolean(process.env.STEEL_API_KEY?.trim());
}

export type SteelConfig = {
  apiKey: string;
  baseUrl: string;
  region?: string | null;
};

export function getSteelConfig(): SteelConfig {
  const apiKey = process.env.STEEL_API_KEY?.trim();
  if (!apiKey) {
    throw new BrowserProviderError(
      "configuration_required",
      "STEEL_API_KEY is not configured.",
      false,
    );
  }

  return {
    apiKey,
    baseUrl: trimTrailingSlash(
      process.env.STEEL_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    ),
    region: process.env.STEEL_REGION?.trim() || null,
  };
}

export class SteelBrowserAdapter implements BrowserProviderAdapter {
  readonly providerKey = "steel" as const;
  readonly configured = isSteelConfigured();
  private readonly config: SteelConfig;
  private readonly fetcher: typeof fetch;
  private readonly admitDispatch?: TransportAdmission;
  private readonly createConfigurationGuard?: Readonly<SteelCreateConfigurationGuard>;

  constructor(options?: {
    config?: SteelConfig;
    fetcher?: typeof fetch;
    admitDispatch?: TransportAdmission;
    createConfigurationGuard?: SteelCreateConfigurationGuard;
  }) {
    // Capture once: the binding, authenticated HTTP and CDP must use exactly
    // the same credential/configuration even if an injected object is mutated.
    this.config = Object.freeze({...(options?.config ?? getSteelConfig())});
    this.fetcher = options?.fetcher ?? fetch;
    this.admitDispatch = options?.admitDispatch;
    this.createConfigurationGuard = options?.createConfigurationGuard ? captureSteelCreateGuard(options.createConfigurationGuard) : undefined;
  }

  private async request(
    pathOrUrl: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    releaseExistingSession = false,
    beforeDispatch?: () => void,
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const address = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.config.baseUrl}${pathOrUrl}`;
    const target = new URL(address);
    const providerOrigin = new URL(this.config.baseUrl).origin;
    const providerAuthenticated = target.origin === providerOrigin;

    try {
      // Release remains possible after pause, to stop an already-incurred lease.
      if (!releaseExistingSession) {
        try { await requireTransportAdmission(this.admitDispatch, { provider: "steel", operation: "browser.session", method: init.method ?? "GET", endpoint: target.origin + target.pathname }); }
        catch { throw new BrowserProviderError("configuration_required", "Operating policy admission is required for this browser operation.", false); }
      }
      if (controller.signal.aborted) throw new BrowserProviderError("provider_timeout", "Browser admission expired before dispatch.", false);
      beforeDispatch?.();
      const response = await this.fetcher(target, {
        ...init,
        cache: "no-store",
        headers: {
          ...(providerAuthenticated
            ? { "steel-api-key": this.config.apiKey }
            : {}),
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const category = statusCategory(response.status);
        throw new BrowserProviderError(
          category,
          `Steel request failed with HTTP ${response.status}.`,
          category === "rate_limited" || category === "provider_unavailable",
          { response: text.slice(0, 500), status: response.status },
        );
      }

      return response;
    } catch (error) {
      if (error instanceof BrowserProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BrowserProviderError(
          "provider_timeout",
          `Steel did not respond within ${timeoutMs}ms.`,
          true,
        );
      }
      throw new BrowserProviderError(
        "provider_unavailable",
        error instanceof Error ? error.message : "Steel request failed.",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private toSession(record: Record<string, unknown>): BrowserProviderSession {
    const providerSessionId = stringValue(record, "id");
    const debugUrl = stringValue(record, "debugUrl");
    const websocketUrl = stringValue(record, "websocketUrl");
    if (!providerSessionId || !debugUrl || !websocketUrl) {
      throw new BrowserProviderError(
        "provider_rejected",
        "Steel returned an incomplete session response.",
        false,
        { keys: Object.keys(record) },
      );
    }

    const status = stringValue(record, "status");
    const normalizedStatus =
      status === "released" || status === "failed" ? status : "live";
    const separator = websocketUrl.includes("?") ? "&" : "?";

    return {
      providerKey: "steel",
      providerSessionId,
      debugUrl,
      sessionViewerUrl: stringValue(record, "sessionViewerUrl"),
      automationEndpoint: `${websocketUrl}${separator}apiKey=${encodeURIComponent(this.config.apiKey)}`,
      profileId: stringValue(record, "profileId"),
      status: normalizedStatus,
      releaseReason: stringValue(record, "releaseReason"),
      region: stringValue(record, "region") ?? this.config.region ?? null,
      browserMode: stringValue(record, "browserMode"),
    };
  }

  async createSession(
    request: BrowserSessionCreateRequest,
  ): Promise<BrowserProviderSession> {
    const profileId = request.profileId?.startsWith("pending:")
      ? undefined
      : request.profileId ?? undefined;
    const response = await this.request(
      "/v1/sessions",
      {
        method: "POST",
        body: JSON.stringify({
          debugConfig: {
            interactive: true,
            systemCursor: true,
          },
          persistProfile: true,
          profileId,
          ...(this.config.region ? { region: this.config.region } : {}),
          timeout: request.timeoutMs,
        }),
      },
      45_000,
    );

    return this.toSession(parseJsonRecord(await response.text()));
  }

  async retrieveSession(providerSessionId: string) {
    const response = await this.request(
      `/v1/sessions/${encodeURIComponent(providerSessionId)}`,
    );
    return this.toSession(parseJsonRecord(await response.text()));
  }

  /** R10 has a separate one-shot authority and never uses an existing profile.
   * Native viewer controls are not the security boundary: only our confined
   * fresh context's screenshots are delivered to the owner. */
  async createViewerSession(timeoutMs: number, beforeDispatch: () => void): Promise<BrowserProviderSession> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 15_000 || timeoutMs > 120_000) {
      throw new BrowserProviderError("provider_rejected", "Invalid bounded viewer lifetime.", false);
    }
    const response = await this.request("/v1/sessions", {
      method: "POST",
      redirect: "error",
      body: JSON.stringify({
        debugConfig: { interactive: false, systemCursor: false },
        persistProfile: false,
        useProxy: false,
        solveCaptcha: false,
        timeout: timeoutMs,
        ...(this.config.region ? { region: this.config.region } : {}),
      }),
    }, 45_000, false, beforeDispatch);
    const record = parseJsonRecord(await response.text()), id = stringValue(record, "id");
    if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {
      throw new BrowserProviderError("provider_rejected", "Invalid viewer session identity.", false);
    }
    // The official exact-session CDP origin is fixed. Never append credentials
    // to a provider-returned URL or omit sessionId (which could create a session).
    const endpoint = new URL("wss://connect.steel.dev/");
    endpoint.searchParams.set("apiKey", this.config.apiKey); endpoint.searchParams.set("sessionId", id);
    return { providerKey: "steel", providerSessionId: id, automationEndpoint: endpoint.href,
      debugUrl: "", sessionViewerUrl: null, profileId: null, status: "live", releaseReason: null, region: null, browserMode: null };
  }

  async releaseViewerSession(providerSessionId: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(providerSessionId)) throw new Error("invalid_viewer_session");
    const response = await this.request(`/v1/sessions/${providerSessionId}/release`, { method: "POST", redirect: "error" }, 30_000, true);
    const result = parseJsonRecord(await response.text());
    if (result.success !== true) throw new Error("viewer_release_unconfirmed");
  }

  /** Separately admitted direct Etsy research. Every request, including cleanup,
   * is checked against its exact durable operation; cleanup may outlive Stop. */
  private async scopedResearchRequest(path:string,operation:string,init:RequestInit,beforeDispatch?:()=>void,externalSignal?:AbortSignal) {
    if(this.config.baseUrl!==DEFAULT_BASE_URL||!/^\/v1\/(sessions|profiles)(\/[a-f0-9-]+(?:\/release)?)?$/.test(path))throw new BrowserProviderError('configuration_required','Hosted research route is not qualified.',false);
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,requestDeadline(init.method==='POST'?45_000:15_000),...(externalSignal?[externalSignal]:[])]),endpoint=DEFAULT_BASE_URL+path;
    try {
      signal.throwIfAborted();
      await awaitRequestDeadline(requireTransportAdmission(this.admitDispatch,{provider:'steel',operation,method:init.method??'GET',endpoint}),signal);
      signal.throwIfAborted();const guarded:unknown=beforeDispatch?.();
      if(guarded&&typeof(guarded as PromiseLike<unknown>).then==='function'){void Promise.resolve(guarded).catch(()=>undefined);throw new Error('async_dispatch_guard_rejected');}
      signal.throwIfAborted();
      const response=await awaitRequestDeadline(this.fetcher(endpoint,{...init,redirect:'error',cache:'no-store',signal,headers:{'steel-api-key':this.config.apiKey,...(init.body?{'Content-Type':'application/json'}:{})}}),signal);
      if(!response.ok){void response.body?.cancel().catch(()=>undefined);throw new BrowserProviderError(statusCategory(response.status),'Scoped Steel operation was rejected.',false);}
      if(!response.body||Number(response.headers.get('content-length')??0)>65_536)throw new Error('invalid_body');
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
      try {for(;;){const part=await awaitRequestDeadline(reader.read(),signal);if(part.done)break;length+=part.value.byteLength;if(length>65_536)throw new Error('invalid_body');chunks.push(part.value);}}
      finally{void reader.cancel().catch(()=>undefined);}
      signal.throwIfAborted();const record=parseJsonRecord(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      if(!Object.keys(record).length)throw new Error('invalid_body');return record;
    }catch(error){throw new BrowserProviderError(error instanceof BrowserProviderError?error.category:'provider_unavailable','Scoped Steel operation could not be verified.',false);}
    finally{controller.abort();}
  }
  private scopedResearchSession(record:Record<string,unknown>,expectedId:string,expectedProjectId:string):BrowserProviderSession {
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    const profileId=stringValue(record,'profileId'),status=stringValue(record,'status'),debugUrl=`https://api.steel.dev/v1/sessions/${expectedId}/player`;
    if(record.id!==expectedId||record.projectId!==expectedProjectId||!uuid.test(expectedProjectId)||!uuid.test(expectedId)||!profileId||!uuid.test(profileId)||!['live','released','failed'].includes(status??'')||record.debugUrl!==debugUrl||record.solveCaptcha===true||record.useProxy===true||Number(record.proxyBytesUsed??0)!==0)throw new BrowserProviderError('provider_rejected','Scoped Steel identity or settings were not verified.',false);
    const stealth=record.stealthConfig;
    if(stealth&&(typeof stealth!=='object'||Array.isArray(stealth)||(stealth as Record<string,unknown>).autoCaptchaSolving===true||(stealth as Record<string,unknown>).humanizeInteractions===true||(stealth as Record<string,unknown>).skipFingerprintInjection===false))throw new BrowserProviderError('provider_rejected','Scoped Steel settings were not verified.',false);
    const endpoint=new URL('wss://connect.steel.dev/');endpoint.searchParams.set('apiKey',this.config.apiKey);endpoint.searchParams.set('sessionId',expectedId);
    return{providerKey:'steel',providerSessionId:expectedId,profileId,debugUrl,sessionViewerUrl:null,automationEndpoint:endpoint.href,status:status as BrowserProviderSession['status'],releaseReason:null,region:null,browserMode:null};
  }
  private async createScopedResearchSession(sessionId:string,projectId:string,timeoutMs:number,profileId:string|null,beforeDispatch:()=>void,signal?:AbortSignal):Promise<BrowserProviderSession> {
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    if(!uuid.test(sessionId)||!uuid.test(projectId)||profileId!==null&&!uuid.test(profileId)||typeof beforeDispatch!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<15_000||timeoutMs>(profileId===null?900_000:120_000))throw new BrowserProviderError('provider_rejected','Scoped Steel lifetime or identity is invalid.',false);
    const body=JSON.stringify({sessionId,projectId,timeout:timeoutMs,persistProfile:profileId===null,...(profileId===null?{}:{profileId}),debugConfig:{interactive:profileId===null,systemCursor:profileId===null},useProxy:false,solveCaptcha:false,stealthConfig:{autoCaptchaSolving:false,humanizeInteractions:false,skipFingerprintInjection:true}});
    const guard=this.createConfigurationGuard;
    if(!guard)throw new BrowserProviderError('configuration_required','Scoped Steel configuration admission is required.',false);
    let request:ReturnType<typeof steelCreateConfigurationAdmission>,permit:ReturnType<typeof validateSteelCreateConfigurationPermit>;
    try{
      const admissionSignal=AbortSignal.any([requestDeadline(10000),...(signal?[signal]:[])]);admissionSignal.throwIfAborted();
      request=steelCreateConfigurationAdmission(this.config,guard,sessionId,projectId,body);
      const raw=await awaitRequestDeadline(guard.admit(request,admissionSignal),admissionSignal);
      permit=validateSteelCreateConfigurationPermit(raw,request,(guard.now??Date.now)());
    }catch{throw new BrowserProviderError('configuration_required','Scoped Steel configuration admission was not verified.',false);}
    const record=await this.scopedResearchRequest('/v1/sessions',profileId===null?'browser.etsy.owner_handoff.create':'browser.etsy.insights.create',{method:'POST',body},()=>{
      validateSteelCreateConfigurationPermit(permit,request,(guard.now??Date.now)());
      return beforeDispatch();
    },signal);
    const session=this.scopedResearchSession(record,sessionId,projectId);
    if(session.status!=='live'||profileId!==null&&session.profileId!==profileId)throw new BrowserProviderError('provider_rejected','Scoped Steel session is not ready.',false);return session;
  }
  createOwnerHandoffSession(sessionId:string,projectId:string,timeoutMs:number,beforeDispatch:()=>void,signal?:AbortSignal){return this.createScopedResearchSession(sessionId,projectId,timeoutMs,null,beforeDispatch,signal);}
  createInsightsSession(sessionId:string,projectId:string,profileId:string,timeoutMs:number,beforeDispatch:()=>void,signal?:AbortSignal){return this.createScopedResearchSession(sessionId,projectId,timeoutMs,profileId,beforeDispatch,signal);}
  async retrieveOwnerHandoffSession(sessionId:string,projectId:string,signal?:AbortSignal){
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;if(!uuid.test(sessionId)||!uuid.test(projectId))throw new Error('invalid_scoped_session');
    return this.scopedResearchSession(await this.scopedResearchRequest(`/v1/sessions/${sessionId}`,'browser.etsy.owner_handoff.status',{},undefined,signal),sessionId,projectId);
  }
  async retrieveOwnerHandoffProfile(profileId:string,projectId:string,signal?:AbortSignal){
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;if(!uuid.test(profileId)||!uuid.test(projectId))throw new Error('invalid_scoped_profile');
    const r=await this.scopedResearchRequest(`/v1/profiles/${profileId}`,'browser.etsy.profile.readback',{},undefined,signal);
    if(r.id!==profileId||r.projectId!==projectId||typeof r.sourceSessionId!=='string'||!uuid.test(r.sourceSessionId)||!['UPLOADING','READY','FAILED'].includes(String(r.status)))throw new Error('invalid_scoped_profile');
    return{id:profileId,sourceSessionId:r.sourceSessionId,status:r.status as 'UPLOADING'|'READY'|'FAILED'};
  }
  /** Authenticated, whitelisted terminal metadata only. No viewer, CDP URL,
   * profile/auth state, headers or provider credit balance is returned. Missing
   * usage dimensions are unknown and cannot qualify bounded accounting. */
  async retrieveScopedTerminalUsage(sessionId:string,projectId:string,signal?:AbortSignal){
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
    if(!uuid.test(sessionId)||!uuid.test(projectId))throw new Error('invalid_scoped_session');
    const r=await this.scopedResearchRequest(`/v1/sessions/${sessionId}`,'browser.etsy.session.release_readback',{},undefined,signal);
    if(r.id!==sessionId||r.projectId!==projectId||!['released','failed'].includes(String(r.status)))throw new Error('scoped_terminal_usage_unconfirmed');
    const nonnegative=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
    return{version:'etsy.steel-terminal-usage.1' as const,sessionId,providerProjectId:projectId,
      providerStatus:r.status as 'released'|'failed',providerTimeoutMs:nonnegative(r.timeout),durationMs:nonnegative(r.duration),
      proxyBytesUsed:nonnegative(r.proxyBytesUsed),proxySource:r.proxySource===null?null:r.proxySource==='steel'||r.proxySource==='external'?r.proxySource:'unknown',
      solveCaptcha:typeof r.solveCaptcha==='boolean'?r.solveCaptcha:null};
  }
  async releaseOwnerHandoffSession(sessionId:string,projectId:string){
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;if(!uuid.test(sessionId)||!uuid.test(projectId))throw new Error('invalid_scoped_session');
    const r=await this.scopedResearchRequest(`/v1/sessions/${sessionId}/release`,'browser.etsy.session.release',{method:'POST'});if(r.success!==true)throw new Error('scoped_release_unconfirmed');
    const status=await this.scopedResearchRequest(`/v1/sessions/${sessionId}`,'browser.etsy.session.release_readback',{});
    return{sessionId,released:true,terminalReadback:status.id===sessionId&&status.projectId===projectId&&['released','failed'].includes(String(status.status))};
  }

  async releaseSession(providerSessionId: string) {
    try {
      await this.request(
        `/v1/sessions/${encodeURIComponent(providerSessionId)}/release`,
        { method: "POST" },
        30_000,
        true,
      );
    } catch (error) {
      if (
        error instanceof BrowserProviderError &&
        [404, 409].includes(Number(error.details.status ?? 0))
      ) {
        return;
      }
      throw error;
    }
  }

  async fetchReplay(
    providerSessionId: string,
    resourceUrl?: string,
    requestHeaders?: HeadersInit,
  ) {
    return this.request(
      resourceUrl ??
        `${this.config.baseUrl}/v1/sessions/${encodeURIComponent(providerSessionId)}/hls`,
      { headers: requestHeaders },
      30_000,
    );
  }
}
