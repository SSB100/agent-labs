/** Explicit opt-in only; requires a fresh disposable loopback r12_test source.
 * R12_RECONCILIATION_RACES=1 R12_RPC_HTTP_ONLY=1 R12_SQL_FULL_SHAPE=1
 * R12_REQUIRE_POSTGRES=1 R12_POSTGRES_URL=... R12_SQL_TEST_HOST=...
 * node --test tests/r12-recovery-reconciliation-races.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {R12_RACE_DATABASES,r12RaceDatabaseUrl,r12RaceExpectedServerAddress,validateR12RaceReportPath,exerciseR12ReconciliationRaces} from './helpers/r12-recovery-reconciliation-races.mjs';

test('Reconciliation race harness only derives two named copies from loopback r12_test',()=>{
 const local='postgresql://r12_test:inert@127.0.0.1:55417/r12_test';
 for(const name of R12_RACE_DATABASES){const url=new URL(r12RaceDatabaseUrl(local,name));assert.equal(url.hostname,'127.0.0.1');assert.equal(url.username,'r12_test');assert.equal(url.pathname,'/'+name);}
 for(const source of ['postgresql://r12_test@production.example/r12_test','postgresql://postgres@127.0.0.1/r12_test',
  'postgresql://r12_test@127.0.0.1/production','postgresql://r12_test@127.0.0.1/r12_test?options=bad']){
  assert.throws(()=>r12RaceDatabaseUrl(source,R12_RACE_DATABASES[0]));
 }
 for(const name of ['postgres','r12_test','production','r12_race_send_first;drop database r12_test'])assert.throws(()=>r12RaceDatabaseUrl(local,name));
 const env={R12_POSTGRES_URL:local};assert.equal(r12RaceExpectedServerAddress(env),'127.0.0.1');
 assert.throws(()=>r12RaceExpectedServerAddress({...env,R12_CI_POSTGRES_ADDRESS:'172.18.0.2'}));
 const ci={CI:'true',GITHUB_ACTIONS:'true',R12_REQUIRE_POSTGRES:'1',R12_POSTGRES_URL:'postgresql://r12_test:r12-isolated-fixture@127.0.0.1:5432/r12_test',R12_CI_POSTGRES_ADDRESS:'172.18.0.2'};
 assert.equal(r12RaceExpectedServerAddress(ci),'172.18.0.2');
 for(const change of [{CI:'false'},{GITHUB_ACTIONS:'false'},{R12_CI_POSTGRES_ADDRESS:'172.999.0.2'},{PGOPTIONS:'options'}])assert.throws(()=>r12RaceExpectedServerAddress({...ci,...change}));
 assert.equal(validateR12RaceReportPath('/tmp/r12-races-report.json'),'/tmp/r12-races-report.json');
 for(const value of ['/tmp/other.json','/tmp/r12-../secret.json','/workspace/r12-races.json'])assert.throws(()=>validateR12RaceReportPath(value));
});
test('Committed send and reviewed marked-pretransport reconciliation serialize safely in both orders',{
 skip:process.env.R12_RECONCILIATION_RACES!=='1',timeout:240000,
},async()=>{
 const reportPath=process.env.R12_RECONCILIATION_REPORT?validateR12RaceReportPath(process.env.R12_RECONCILIATION_REPORT):null;
 const report=await exerciseR12ReconciliationRaces();assert.equal(report.passed,true);
 assert.equal(report.races.length,2);assert.ok(report.races.every(race=>race.observedLockWait));
 if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log('R12 offline reconciliation lock races:',JSON.stringify(report));
});
