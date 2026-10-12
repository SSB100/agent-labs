import assert from 'node:assert/strict';

/** Keep the historical replay's transaction intact, including atomic DO patches. */
export function nestedMigrationSql(original,label){
 const begins=(original.match(/^begin;[ \t]*$/gim)||[]).length;
 const commits=(original.match(/^commit;[ \t]*$/gim)||[]).length;
 if(begins===0&&commits===0){
  const atomic=original.match(/^(?:\s|--[^\n]*(?:\n|$))*do\s+(\$[a-z_][a-z_0-9]*\$)([\s\S]*?)\1;\s*$/i);
  assert.ok(atomic&&!atomic[2].includes(atomic[1]),label+': one atomic DO statement required without an outer transaction');
  return original;
 }
 assert.equal(begins,1,label);assert.equal(commits,1,label);
 return original.replace(/^begin;[ \t]*\r?\n/im,'').replace(/^commit;[ \t]*\r?\n?$/im,'');
}
