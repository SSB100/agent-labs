/** Fresh isolated database; the complete frozen migration chain precedes .4. */
import {readFileSync,readdirSync} from 'node:fs';
import {directControllerDatabase} from './r12-direct-controller-database.mjs';
export async function proofBoundResearchDatabase({beforeResearchMigration=null}={}){
 const db=await directControllerDatabase();try{
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f.slice(0,14)>'20261010120600'&&f.slice(0,14)<='20261010120950').sort()){
   if(file.startsWith('20261010120950')&&beforeResearchMigration)await beforeResearchMigration(db);
   await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  }return db;
 }catch(error){error.message+=' '+JSON.stringify({where:error.where,position:error.position,internalPosition:error.internalPosition,internalQuery:error.internalQuery});await db.close();throw error;}
}
