import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nestedMigrationSql} from './helpers/r12-nested-migration.mjs';

test('Historical migration replay preserves atomic DO patches and rejects ambiguous transaction boundaries',()=>{
 const body="do $patch$\nbegin\n perform 1;\nend $patch$;\n";
 assert.equal(nestedMigrationSql('-- atomic\n'+body,'atomic'),'-- atomic\n'+body);
 assert.equal(nestedMigrationSql('begin;\n'+body+'commit;\n','wrapped'),body);
 for(const sql of ['begin;\n'+body,body+'commit;\n','begin;\nbegin;\n'+body+'commit;\n',body+'select 2;\n',body+body,'select 1;']){
  assert.throws(()=>nestedMigrationSql(sql,'invalid'));
 }
 const migration=readFileSync('supabase/migrations/20261012110903_r12_pod_bounded_query_plan.sql','utf8');
 assert.equal(nestedMigrationSql(migration,'bounded-plan'),migration,'Apply the exact reviewed atomic migration without stripping its PL/pgSQL body');
});
