import { exactPublicKeys as exact, publicInteger as integer, publicMoney as money, publicResearchFail as fail, publicResearchHash } from "./discovery-r12-public-utils";
export type PublicResearchCapProposal = { version: "r12.public-cap-proposal.1"; business: { currentRevision: number; currentLimitMicrounits: string; proposedLimitMicrounits: string }; root: { currentRevision: number; currentLimitMicrounits: string; proposedLimitMicrounits: string } };
export type PublicResearchCapSnapshot = { capRevision: number; limitMicrounits: string; headroomMicrounits: string; conservativeExposureMicrounits: string };
export function validatePublicResearchCapProposal(raw: unknown): PublicResearchCapProposal {
  if (!exact(raw,"version,business,root") || raw.version !== "r12.public-cap-proposal.1") return fail();
  for (const x of [raw.business,raw.root]) if (!exact(x,"currentRevision,currentLimitMicrounits,proposedLimitMicrounits") || !integer(x.currentRevision) || money(x.currentLimitMicrounits) < 0n || money(x.proposedLimitMicrounits) <= 0n) return fail();
  return structuredClone(raw) as PublicResearchCapProposal;
}
export function projectPublicResearchCapProposal(raw: unknown, snapshot: { business: PublicResearchCapSnapshot; root: PublicResearchCapSnapshot }) {
  const p = validatePublicResearchCapProposal(raw);
  function project(k: "business" | "root") {
    const before = snapshot[k], proposed = p[k], exposure = money(before.conservativeExposureMicrounits), current = money(before.limitMicrounits), next = money(proposed.proposedLimitMicrounits);
    if (before.capRevision !== proposed.currentRevision || before.limitMicrounits !== proposed.currentLimitMicrounits || money(before.headroomMicrounits) !== (current > exposure ? current-exposure : 0n)) return fail("r12_public_cap_revision_or_exposure_mismatch");
    return { ...before, proposedLimitMicrounits: next.toString(), projectedHeadroomMicrounits: (next > exposure ? next-exposure : 0n).toString(), belowCurrentExposure: next < exposure };
  }
  return { proposal: p, capProposalHash: publicResearchHash(p), business: project("business"), root: project("root"), requiresCapConfirmation: p.business.currentLimitMicrounits !== p.business.proposedLimitMicrounits || p.root.currentLimitMicrounits !== p.root.proposedLimitMicrounits, authorityCreated: false as const };
}
