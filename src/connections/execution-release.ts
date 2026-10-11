export type OwnShopExecutionRelease = {
  version:'r11.execution-release.1'; repository:'SSB100/agent-labs';
  environment:'production'; commitSha:string; deploymentId:string;
};
/** Trusted server capture only. Owner forms never choose deployment identity.
 * Qualification is enforced by the existing exact-tree release gate.
 * Provenance does not grant account access or claim semantic compatibility. */
export function ownShopExecutionRelease(env:NodeJS.ProcessEnv=process.env):Readonly<OwnShopExecutionRelease>{
  const commitSha=env.VERCEL_GIT_COMMIT_SHA,deploymentId=env.VERCEL_DEPLOYMENT_ID;
  if(env.VERCEL_ENV!=='production'||typeof commitSha!=='string'||!/^[a-f0-9]{40}$/.test(commitSha)||
    typeof deploymentId!=='string'||!/^dpl_[A-Za-z0-9_-]{1,124}$/.test(deploymentId))throw Error('own_shop_release_unverified');
  return Object.freeze({version:'r11.execution-release.1',repository:'SSB100/agent-labs',environment:'production',commitSha,deploymentId});
}
