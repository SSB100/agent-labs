import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
export async function directControllerDatabase(){
 const host=process.env.R12_SQL_TEST_HOST;if(!host)throw Error('R12_SQL_TEST_HOST required');
 const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL){
  if(!process.env.R12_POSTGRES_URL)throw Error('R12_POSTGRES_URL required for explicit native direct qualification');
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:target.url});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  try{assert.deepEqual((await db.query('select current_user actor,current_database() db,host(inet_server_addr()) address')).rows[0],{actor:'r12_test',db:'r12_test',address:target.address});assert.equal(Number((await db.query("select count(*) n from pg_tables where schemaname in ('public','private')")).rows[0].n),0,'Direct native qualification requires a fresh isolated database');}catch(error){await db.close();throw error;}
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 await db.exec(r04SqlBootstrap+sessionBootstrap);
 for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')&&x.slice(0,14)<='20261010120600').sort()){
  try{await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));}catch(error){error.message=file+': '+error.message+' '+JSON.stringify({position:error.position,where:error.where,internalPosition:error.internalPosition,internalQuery:error.internalQuery});await db.close();throw error;}
 }
 const query=db.query.bind(db);db.query=async (...args)=>{try{return await query(...args);}catch(error){error.message+=' '+JSON.stringify({where:error.where,detail:error.detail,position:error.position});throw error;}};return db;
}
