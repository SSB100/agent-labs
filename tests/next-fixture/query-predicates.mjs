// Reviewed transport grammar only. This is deliberately not a general PostgREST parser.
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
// One server page plus one exact selection per branch: at most 26 + 26 identities.
const list=`${uuid}(?:,${uuid}){0,25}`;
const creativeUnion=new RegExp(`^(?:approval_id\\.in\\.\\((${list})\\)(?:,id\\.in\\.\\((${list})\\))?|id\\.in\\.\\((${list})\\))$`,'i');
export function filterFixtureOr(rows,table,predicate,operations) {
  if(predicate==='status.in.(completed,failed,cancelled),completed_at.not.is.null')return rows.filter(r=>['completed','failed','cancelled'].includes(r.status)||r.completed_at!=null);
  const match=typeof predicate==='string'&&table==='creative_runs'?creativeUnion.exec(predicate):null;
  const limits=operations.filter(([op])=>op==='limit');
  // The loader counts independently and reads one overflow sentinel beyond 52.
  if(!match||limits.length!==1||!Number.isInteger(limits[0][1])||limits[0][1]<1||limits[0][1]>53||operations.some(([op])=>op==='range'))throw Error('Unreviewed OR predicate');
  const approvalIds=(match[1]??'').toLowerCase().split(',').filter(Boolean),runIds=(match[2]??match[3]??'').toLowerCase().split(',').filter(Boolean);
  return rows.filter(row=>approvalIds.includes(String(row.approval_id).toLowerCase())||runIds.includes(String(row.id).toLowerCase()));
}
