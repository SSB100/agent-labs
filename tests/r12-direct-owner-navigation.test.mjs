import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('ordinary Quest research navigation exposes exact Goal-scoped Etsy test only when available',()=>{
 const source=readFileSync('src/app/dashboard/quests/research/page.tsx','utf8');
 assert.match(source,/exactGoal\s*&&\s*!unavailable\s*\?\s*<Link href=\{`\/dashboard\/products\/etsy-research\?\$\{new URLSearchParams\(\{business:businessId,goal:exactGoal\.id\}\)\}`\}>Review an Etsy research test<\/Link>\s*:\s*null/);
});
