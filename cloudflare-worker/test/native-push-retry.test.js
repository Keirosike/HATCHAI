import test from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterMs, retryDeadline } from '../src/native-push-retry.js';
const now=Date.UTC(2026,10,10,0,0,0);
for(const [value,expected] of [['0',1000],['1',1000],['300',300000],['301',301000],['3600',3600000],['100000',100000000],['00003600',3600000]])
  test('numeric Retry-After '+value+' is never capped early',()=>assert.equal(retryAfterMs(value,now),expected));
for(const minutes of [1,6,60,1440])test('HTTP-date Retry-After '+minutes+' minutes is preserved',()=>{
  assert.equal(retryAfterMs(new Date(now+minutes*60000).toUTCString(),now),minutes*60000);
});
test('HTTP-date historical formats and 50-year interpretation are validated',()=>{
  const future=new Date(now+3600000);
  assert.equal(retryAfterMs('Tuesday, 10-Nov-26 01:00:00 GMT',now),3600000);
  assert.equal(retryAfterMs('Tue Nov 10 01:00:00 2026',now),3600000);
  assert.equal(retryAfterMs('Sunday, 06-Nov-94 08:49:37 GMT',now),1000);
  assert.equal(retryAfterMs(future.toUTCString(),now),3600000);
});
test('past dates, OWS, absent and invalid values have bounded fallback',()=>{
  assert.equal(retryAfterMs(new Date(now-1000).toUTCString(),now),1000);
  assert.equal(retryAfterMs(' 3600 ',now),3600000);
  for(const invalid of [null,'','invalid','-1','1.5','1, 2','Tue, 31 Feb 2026 00:00:00 GMT','Wed, 10 Nov 2026 01:00:00 GMT','2026-11-10T01:00:00Z'])assert.equal(retryAfterMs(invalid,now),30000);
});
test('huge integer and oversized headers fail closed, not a shortened retry',()=>{
  assert.equal(retryAfterMs('9007199254740991',now),null);
  assert.equal(retryAfterMs('9'.repeat(200),now),null);
  assert.equal(retryAfterMs('3600',Number.MAX_SAFE_INTEGER-1),null);
  assert.equal(retryAfterMs('1',NaN),null);
});
test('scheduler honors long numeric wait, absolute provider deadline and local backoff',()=>{
  const item={attempt:1,expiresAt:now+7200000};
  assert.equal(retryDeadline({outcome:'retryable',retryAfterMs:3600000},item,now),now+3600000);
  assert.equal(retryDeadline({outcome:'retryable',retryAfterMs:3600000,retryNotBefore:now+3600000},item,now+1000),now+3600000);
  assert.equal(retryDeadline({outcome:'retryable',retryAfterMs:1000},item,now),now+15000);
  assert.equal(retryDeadline({outcome:'retryable',retryAfterMs:1000},{...item,attempt:2},now),now+30000);
});
test('event expiry and three-attempt limit end retries without sending early',()=>{
  const result={outcome:'retryable',retryAfterMs:3600000};
  assert.equal(retryDeadline(result,{attempt:1,expiresAt:now+3600000},now),null);
  assert.equal(retryDeadline(result,{attempt:1,expiresAt:now+300000},now),null);
  assert.equal(retryDeadline(result,{attempt:3,expiresAt:now+7200000},now),null);
  assert.equal(retryDeadline({...result,retryAfterMs:Infinity},{attempt:1,expiresAt:now+7200000},now),null);
  for(const outcome of ['unknown','failed','accepted','disabled','unconfigured'])assert.equal(retryDeadline({...result,outcome},{attempt:1,expiresAt:now+7200000},now),null);
});
