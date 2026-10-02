import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {sealAccountSecret:seal,unsealAccountSecret:unseal}=require('../.core-tests/accounts/vault.js');
const key='a'.repeat(64), token='test-fixture-secret-never-a-real-token';
const context={businessId:'11111111-1111-4111-8111-111111111111',provider:'printful',connectionId:'22222222-2222-4222-8222-222222222222',revision:'33333333-3333-4333-8333-333333333333'};
const other='44444444-4444-4444-8444-444444444444';
test('account-v1 vault encrypts with fresh nonces and returns only authenticated JSON',()=>{
 const value={credential:token,expiresAt:'2026-10-02T00:00:00.000Z'};
 const one=seal(value,context,key),two=seal(value,context,key);
 assert.match(one,/^account-v1\./);assert.notEqual(one,two);assert.ok(!one.includes(token));
 assert.deepEqual(unseal(one,context,key),value);
});
test('account envelopes reject tenant/provider/connection/revision replay and wrong keys',()=>{
 const envelope=seal({credential:token},context,key);
 for(const changed of [{...context,businessId:other},{...context,provider:'etsy'},{...context,connectionId:other},{...context,revision:other}]){
  assert.throws(()=>unseal(envelope,changed,key),/^AccountVaultError: invalid_account_secret$/);
 }
 assert.throws(()=>unseal(envelope,context,'b'.repeat(64)),/^AccountVaultError: invalid_account_secret$/);
});
test('strict authenticated envelope rejects truncation, suffixes, alternate encoding and tampering',()=>{
 const envelope=seal({credential:token},context,key),parts=envelope.split('.');
 const ciphertext=Buffer.from(parts[3],'base64url'),tampered=Buffer.from(ciphertext);
 assert.ok(ciphertext.length>0);tampered[0]^=1;
 assert.notDeepEqual(tampered,ciphertext,'Tampering must change authenticated ciphertext bytes');
 for(const bad of [envelope+'.',envelope+'.extra',envelope.slice(0,-4),envelope.replace('account-v1','v1'),
  [parts[0],parts[1]+'=',parts[2],parts[3]].join('.'),[parts[0],parts[1],parts[2],tampered.toString('base64url')].join('.'),
  [parts[0],parts[1],parts[2].slice(0,8),parts[3]].join('.'),'x'.repeat(90001)]){
  assert.throws(()=>unseal(bad,context,key),/^AccountVaultError: invalid_account_secret$/);
 }
});
test('vault rejects unconfigured keys, ambiguous contexts and oversized secrets without leaking causes',()=>{
 for(const badKey of ['', 'passphrase', 'A'.repeat(64),'z'.repeat(64)])assert.throws(()=>seal({credential:token},context,badKey),/^AccountVaultError: account_vault_not_configured$/);
 for(const changed of [{...context,businessId:'bad'},{...context,provider:'printful:admin'},{...context,revision:''}])assert.throws(()=>seal({credential:token},changed,key));
 assert.throws(()=>seal({credential:'x'.repeat(65537)},context,key),/^AccountVaultError: invalid_account_secret$/);
 const circular={};circular.self=circular;assert.throws(()=>seal(circular,context,key),/^AccountVaultError: invalid_account_secret$/);
 assert.throws(()=>seal({toJSON(){throw new Error(token)}},context,key),error=>!String(error).includes(token)&&error.cause===undefined);
 assert.throws(()=>unseal(token,context,key),error=>!String(error).includes(token)&&error.cause===undefined);
});
