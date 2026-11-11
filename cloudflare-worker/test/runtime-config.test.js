import test from 'node:test';
import assert from 'node:assert/strict';
import {productionCompatibility} from './runtime-config.mjs';
test('runtime verification requires the configured production date and flags',()=>{
  assert.deepEqual(productionCompatibility({}),{compatibilityDate:'2026-11-07',compatibilityFlags:[]});
  assert.throws(()=>productionCompatibility({HATCHAI_RUNTIME_COMPAT_DATE:'2026-08-06'}),/refused/);
});
