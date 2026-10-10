/** No database or provider: pin the native counter-race rejection contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAdaptiveCounterTamperRejected} from './helpers/r12-adaptive-postgres-races.mjs';
test('adaptive counter race expects the exact reconstructed lifetime-bound denial',()=>{
 assert.doesNotThrow(()=>assertAdaptiveCounterTamperRejected({message:'r12_episode_lifetime_bound'}));
 for(const error of [undefined,{message:'r12_adaptive_setup_stopped'},{message:'r12_episode_exact_closed_predecessor_required'},{message:'unrelated transport failure'}])
  assert.throws(()=>assertAdaptiveCounterTamperRejected(error));
});
