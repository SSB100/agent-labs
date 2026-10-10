/** Explicit complete enrollment prerequisite chain, then the new quote successor. */
import {readFileSync} from 'node:fs';
import {enrollmentDatabase} from './r12-direct-enrollment-sql-fixture.mjs';
export async function applyDirectSonnet(db){try{await db.exec(readFileSync('supabase/migrations/20261010121200_r12_direct_sonnet_quote.sql','utf8'));}catch(error){error.message+=' '+JSON.stringify({position:error.position,where:error.where,internalPosition:error.internalPosition,internalQuery:error.internalQuery});throw error;}}
export async function directSonnetDatabase({apply=true}={}){const db=await enrollmentDatabase();try{if(apply)await applyDirectSonnet(db);return db;}catch(error){await db.close();throw error;}}
