import {readFileSync} from 'node:fs';
export const R07_KEY='inert-r07-controller-qualification-only-123456';
export const R05_KEY='inert-'.repeat(8);
export const R07_LEASE='inert-r07-process-lease-qualification-123456';
export const R07_OWNER='95050000-0000-4000-8000-000000000001';
export function r07FixtureSetup(root){
 const fixture=readFileSync(`${root}/supabase/tests/r05_operating_envelope.sql`,'utf8');
 const marker="select set_config('r05.a',pg_temp.r05_seed()::text,true);";
 if(fixture.split(marker).length!==2)throw new Error('R05 fixture prefix changed');
 return fixture.split(marker)[0].replace('\nbegin;','').replaceAll('pg_temp.','public.').replace('create temporary table r05_fixture','create table public.r05_fixture')+`
 insert into private.r07_server_keys values(encode(extensions.digest(convert_to('${R07_KEY}','UTF8'),'sha256'),'hex'),clock_timestamp()+interval '1 day');
 insert into public.worker_definitions(id,pack_id,worker_key,version,name,role,charter,status) values
 ('97070000-0000-4000-8000-000000000001','95050000-0000-4000-8000-000000000011','r07.planner','1.0.0','Inert planner','planner','Finite fixture','qualified'),
 ('97070000-0000-4000-8000-000000000002','95050000-0000-4000-8000-000000000011','r07.research','1.0.0','Inert research','researcher','Finite fixture','qualified'),
 ('97070000-0000-4000-8000-000000000003','95050000-0000-4000-8000-000000000011','r07.challenge','1.0.0','Inert challenge','reviewer','Finite fixture','qualified'),
 ('97070000-0000-4000-8000-000000000004','95050000-0000-4000-8000-000000000011','r07.work','1.0.0','Inert work','worker','Finite fixture','qualified');
 insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until)
 select 'fixture.'||key,repeat('a',64),'95050000-0000-4000-8000-000000000012',worker::uuid,(select private.r04_hash(to_jsonb(fd)) from public.workflow_definitions fd where id='95050000-0000-4000-8000-000000000012'),(select private.r04_hash(to_jsonb(wd)) from public.worker_definitions wd where id=worker::uuid),'research.model',role,'Research planning','r07.'||key,'simulation',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day'
 from(values('research','97070000-0000-4000-8000-000000000002','researcher'),('challenge','97070000-0000-4000-8000-000000000003','reviewer'),('work','97070000-0000-4000-8000-000000000004','worker')) v(key,worker,role);
 `;
}
export async function r07Seed(db,ceiling=1000){
 const businessId=(await db.query('select public.r05_seed($1) b',[ceiling])).rows[0].b;
 const row=(await db.query(`select f.*,g.content_hash gh,b.content_hash bh,private.r04_hash(i.snapshot) sh from public.r05_fixture f join private.r04_goal_versions g on g.goal_id=f.g and g.revision=2 join private.r04_business_versions b on b.business_id=f.b and b.revision=1 join public.installed_packs i on i.id=f.installation where f.b=$1`,[businessId])).rows[0];
 const expiry=new Date(row.payload.expiresAt).toISOString(),start=new Date(Date.now()-60000).toISOString();
 const plan={format:'r07.1',businessId,goalId:row.g,goalRevision:2,goalHash:row.gh,businessRevision:1,businessHash:row.bh,policyId:row.policy,policyHash:row.hash,authorityRootId:businessId,plannerWorkerDefinitionId:'97070000-0000-4000-8000-000000000001',currency:'USD',maximumMicrounits:'540',deadline:expiry,expiresAt:expiry,maximumRepairs:3,maximumPivots:2,maximumChildren:12,maximumDispatches:10,requiredChecks:['challenge'],finishCondition:'all_required_outputs_verified',stopConditions:['no_permitted_work','deadline','repair_exhausted','owner_stopped'],steps:[]};
 for(const [index,key,role] of [[2,'research','researcher'],[3,'challenge','reviewer'],[4,'work','worker']])plan.steps.push({key,kind:key==='work'?'work':key,objective:`Complete bounded ${key}`,reason:'Finite permitted progress',adapter:`fixture.${key}`,qualificationHash:'a'.repeat(64),installationId:row.installation,packSnapshotHash:row.sh,workflowDefinitionId:'95050000-0000-4000-8000-000000000012',workerDefinitionId:`97070000-0000-4000-8000-00000000000${index}`,role,operationKey:'research.model',purpose:'Research planning',dependsOn:key==='research'?[]:key==='challenge'?['research']:['challenge','research'],expectedArtifactType:`r07.${key}`,maximumMicrounits:'180',expiresAt:expiry,notBefore:start,measurement:null,maximumRepairs:2});
 return {businessId,goalId:row.g,plan};
}
