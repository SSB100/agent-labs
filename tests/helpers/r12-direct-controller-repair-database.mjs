import {readFileSync,readdirSync} from 'node:fs';
import {directControllerDatabase} from './r12-direct-controller-database.mjs';
export async function directRepairDatabase(){const db=await directControllerDatabase();try{for(const name of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')&&x.slice(0,14)>'20261010120600'&&x.slice(0,14)<='20261010120700').sort())await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));return db;}catch(e){await db.close();throw e;}}
