import "server-only";
import {createHmac} from "node:crypto";
/** Existing root, distinct purpose, no release identity. Never serialized. */
export function podApplicationCapability() {
 const root=process.env.R05_ADMISSION_SERVER_KEY?.trim();
 if(process.env.VERCEL_ENV!=="production"||!root||root.length<32||root.length>200)throw Error("r12_pod_application_unavailable");
 return createHmac("sha256",root).update("r12.pod-owner-application.1").digest("base64url");
}
