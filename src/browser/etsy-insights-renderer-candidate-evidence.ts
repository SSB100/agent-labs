import {insightsHash} from './etsy-insights-policy';
export type EtsyInsightsCandidateReference={origin:string;pathnameHash:string;hasQuery:boolean;method:'GET';resourceType:'image'|'script'};
/** Sanitized ordinary landing DOM observations. Path hashes deliberately omit
 * owner-specific public CDN paths and support account identifiers. Hashes are
 * canonical JSON-string hashes of URL.pathname, never URLs or query values.
 * GET/type are restrictive tag-based admission rules, not a network trace.
 * Blocking a candidate dependency does not prove it optional or establish
 * page readiness; that requires the separate real no-query verification. */
export const ETSY_INSIGHTS_CANDIDATE_MANIFEST=Object.freeze({
 version:'etsy.insights-renderer-candidate-manifest.3',
 documentUrl:'https://www.etsy.com/your/shops/me/marketplace-insights',
 observedAt:'2026-10-10T14:16:46.000Z',observation:'read_only_dom_src_attributes',
 networkTrace:false,methodRule:'GET_only_no_non_GET_claim',necessity:'unestablished',
 purpose:'etsy_insights_verify_only',pathnameHashAlgorithm:'canonical_json_string_sha256',
 allowedImages:Object.freeze([
  {
    "origin": "https://i.etsystatic.com",
    "pathnameHash": "1f86bdc3c7a4732b37809d6b263e2498872bf13418ab5e056b8119f3e0b3fc93",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://i.etsystatic.com",
    "pathnameHash": "512d02ff511c568bb2564e23315c351cf145bdce47fb1c85dee8c44ed3f17293",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://i.etsystatic.com",
    "pathnameHash": "b161c101e74b3ce29eabdb74afdc3f49e4d8e3a083ce46882568d1161d1ff35a",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://i.etsystatic.com",
    "pathnameHash": "b5230bec2419c083a4441f5d40806744e9bc8b2b5000af7c57c7a2550164c04d",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "image"
  }
].map(r=>Object.freeze(r))) as readonly Readonly<EtsyInsightsCandidateReference>[],
 blockedCandidates:Object.freeze([
  {
    "origin": "https://analytics.tiktok.com",
    "pathnameHash": "1acf9f1a6a2fbc3ea8fe4c22e68a82e16c8b357bb48d3de46c8bd0deae2cfc68",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://analytics.tiktok.com",
    "pathnameHash": "437773a266ef535a87d3feb8b6874c0166747f24547816ce0938e3464bff23b3",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://analytics.tiktok.com",
    "pathnameHash": "d58e2aaee7edc958ce7b82cf9f8b76aed45bdeeb47d19a8ffe08cab3bdd18fe0",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://bat.bing.com",
    "pathnameHash": "06639cd87af7d163d8087c4192e2b924bbccd584d05d407a613c0d47a2c22b93",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://bat.bing.com",
    "pathnameHash": "29435e9ceae58e202246aba89e66c4d92416c455a50faca9bc6e89b709f6361b",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://bat.bing.com",
    "pathnameHash": "7eaffe48a564a81f58f22b312e150f415a09a55e0e43bc496994fe6cc66006e8",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://bat.bing.com",
    "pathnameHash": "adc25a5595151ef065d6c8ba52f0a99349f888f512e0d0f51ce0228c45c1f751",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://bat.bing.com",
    "pathnameHash": "af2e5b14bf0d25f1f459be576daa1fbef86e9366e7fd1ca1e56127fd44c3f99d",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://ct.pinterest.com",
    "pathnameHash": "6ddf53fbe5bf4b8b46a2d2e1822074b136334f829b8a2a7f54da52374f97ead3",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://googleads.g.doubleclick.net",
    "pathnameHash": "bffd482f876a96b98b86aa8a3c95d40db747b90f397e5f781ac964affd736ebc",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://i.etsystatic.com",
    "pathnameHash": "933e89b27e04b26fa002db9ad1a027817071d289c3e773bed4529eb13fb7d34f",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://js.adsrvr.org",
    "pathnameHash": "c202281b629cf7667e6f72ddcf10fb07cedb3779ed468101595656a95d47e9fa",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://pt.ispot.tv",
    "pathnameHash": "3f16679dbe7d48c5a8c05d35b8dc0aac495b463617bbbe87548705fe88ddefba",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://res4.applovin.com",
    "pathnameHash": "01c6551d66b4449affd8653772e4289b5aec6b18e19372ed507e587827c9df80",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://res4.applovin.com",
    "pathnameHash": "2bf4ce6b5837f8d213bd4ca6c076032be5c9304fcc2f57a476d88931c66ede83",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://res4.applovin.com",
    "pathnameHash": "3d41e2079c01e8f7771f400d9043d1f013edcd507fde50020e2ef14b53e0e9cb",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://s.axon.ai",
    "pathnameHash": "c0ab38910d5751850f170d1eb653b414ac6497ed14583763100101a92288c11d",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://s.pinimg.com",
    "pathnameHash": "78cb606e22059f7c4822569b8de5a1ae639d4ae3bc44dff30435dac5b4118d96",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://s.pinimg.com",
    "pathnameHash": "84b6b3a4f81048a23e7fd5cabbce80121ba7c929ffc3671689f4453e9124b819",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://sierra.chat",
    "pathnameHash": "c66e52b17d06cdd39f799f8b96edab20a7dc836a1b4ed095ea7d32ed4ac4e3f1",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://tr.snapchat.com",
    "pathnameHash": "c7ac0c9fafd683ccc23298d969c8b44d195986005cd9a884f90f6c0c5d522b27",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://web.btncdn.com",
    "pathnameHash": "716f98a03b439b43244533cb8a2e9f003c7ab63ff38cacdaf9e386df4b504066",
    "hasQuery": false,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://www.facebook.com",
    "pathnameHash": "6e5a047b111e0ba381c9e1cc34187dea1daa6bc9f6642b44a173febacbf8c698",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "image"
  },
  {
    "origin": "https://www.googletagmanager.com",
    "pathnameHash": "44175c8c26dd92b745294ead1e46dce3eff132d7f00ada5a7e28f6d3e80e1a8f",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://www.googletagmanager.com",
    "pathnameHash": "51d356b3c50108af4259c7b486633073deb9e89f32f2827407bd9c973a3b9a84",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "script"
  },
  {
    "origin": "https://www.googletagmanager.com",
    "pathnameHash": "f205bd21081d28e445916c2f3a53076b9d3c8ad78a9b16866f624f19b09fef11",
    "hasQuery": true,
    "method": "GET",
    "resourceType": "script"
  }
].map(r=>Object.freeze(r))) as readonly Readonly<EtsyInsightsCandidateReference>[],
});
export const ETSY_INSIGHTS_CANDIDATE_MANIFEST_HASH=insightsHash(ETSY_INSIGHTS_CANDIDATE_MANIFEST);
