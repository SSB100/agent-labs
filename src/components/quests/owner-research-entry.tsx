import Link from "next/link";
import "./owner-research.css";

/** Navigation only: a real saved Quest is selected before research preparation. */
export function OwnerResearchEntry({ businesses, businessesUnavailable, selectedBusinessId }: {
  businesses: Array<{ id: string; name: string }>;
  businessesUnavailable?: boolean;
  selectedBusinessId?: string;
}) {
  return <section className="ownerResearchEntry" aria-label="Research a saved Quest">
    <h2>Research a saved Quest</h2>
    <p>Choose your Business, then select or create your actual objective. Review a supported research profile and its complete price and permission packet before continuing.</p>
    {businessesUnavailable ? <p role="alert">Business records are unavailable. Reload before choosing a Business.</p> : businesses.length ? <form action="/dashboard/quests/research" method="get">
      <label>Business<select name="business" required defaultValue={businesses.some(business => business.id === selectedBusinessId) ? selectedBusinessId : ""}>
        <option value="" disabled>Choose a Business</option>
        {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
      </select></label>
      <button type="submit" className="coreButton">Choose a saved Quest</button>
    </form> : <p>Create a Business in <Link href="/dashboard/settings?panel=businesses">Business settings</Link> first.</p>}
    <p>Saving or selecting a Quest does not authorize spending. Research can return TEST, REJECT or NEEDS_MORE_EVIDENCE.</p>
  </section>;
}
