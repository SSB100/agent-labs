import { insightsHash } from './etsy-insights-policy';
export type EtsyObservedRendererReference={origin:string;path:string;method:'GET';resourceType:'image'|'script'};
const row=(origin:string,path:string,resourceType:'image'|'script'):EtsyObservedRendererReference=>Object.freeze({origin,path,method:'GET',resourceType});
const imagePaths=[
 '/ij/e1b3c0/8505434366/ij_fullxfull.8505434366_b9sshy9k.jpg',
 '/ij/5ffde3/8641456553/ij_400x400.8641456553_lyeh58yk.jpg',
 '/62554272/r/il/b5845e/8082037463/il_fullxfull.8082037463_ray8.jpg',
 '/60704290/r/il/72c8b8/7493065691/il_fullxfull.7493065691_e9w7.jpg',
 '/48688437/r/il/3e9faf/8107988409/il_fullxfull.8107988409_1kn5.jpg',
 '/64139495/r/il/45d7e7/8035450831/il_fullxfull.8035450831_j5ms.jpg',
 '/ij/5a0a72/8528399648/ij_300x300.8528399648_dia1s25a.jpg',
 '/ij/36ca24/8646947005/ij_300x300.8646947005_4tbd65ji.jpg',
 '/ij/ad5838/8443890311/ij_300x300.8443890311_h3ps4cra.jpg',
 '/ij/aa46dd/8646907761/ij_300x300.8646907761_m8lhald4.jpg',
 '/ij/e53757/8599334826/ij_300x300.8599334826_g910ojce.jpg',
];
/** Sanitized references observed on the public homepage through the existing
 * dot-cloud browser, not an Agent Labs Steel session. GET is a narrow admission
 * restriction based on script/img semantics; actual network methods were not
 * captured. No query values, cookies, headers, response bodies or account links.
 * These observations alone grant no authority: server review must pin a subset
 * in an immutable qualification before browser creation. */
export const ETSY_RENDERER_DOM_REFERENCE_MANIFEST=Object.freeze({
 version:'etsy.renderer-dom-reference-manifest.1',documentUrl:'https://www.etsy.com/',observedAt:'2026-10-10T12:53:26.000Z',
 observation:'read_only_dom_src_attributes',networkTrace:false,methodRule:'GET_only_no_non_GET_claim',
 images:Object.freeze(imagePaths.map(path=>row('https://i.etsystatic.com',path,'image'))),
 optionalTelemetry:Object.freeze([
  row('https://ct.pinterest.com','/static/ct/token_create.js','script'),
  row('https://bat.bing.com','/p/insights/s/0.8.72','script'),
  row('https://bat.bing.com','/p/insights/t/4020083','script'),
  row('https://bat.bing.com','/bat.js','script'),
  row('https://bat.bing.com','/p/action/4020083.js','script'),
  row('https://bat.bing.com','/action/0','image'),
  row('https://analytics.tiktok.com','/i18n/pixel/static/identify_0504602d.js','script'),
  row('https://analytics.tiktok.com','/i18n/pixel/static/main.MWU2MzIzODM0MQ.js','script'),
  row('https://analytics.tiktok.com','/i18n/pixel/events.js','script'),
  row('https://s.pinimg.com','/ct/lib/main.f1fea82a.js','script'),
  row('https://s.pinimg.com','/ct/core.js','script'),
  row('https://www.googletagmanager.com','/gtag/destination','script'),
  row('https://www.googletagmanager.com','/gtag/js','script'),
  row('https://googleads.g.doubleclick.net','/pagead/viewthroughconversion/995917074/','script'),
  row('https://www.facebook.com','/tr','image'),
  row('https://tr.snapchat.com','/p','image'),
  row('https://pt.ispot.tv','/v2/TC-3512-1.gif','image'),
 ]),
 // Consent and ambiguous third-party dependencies remain unqualified/fatal.
});
export const ETSY_RENDERER_DOM_REFERENCE_HASH=insightsHash(ETSY_RENDERER_DOM_REFERENCE_MANIFEST);
