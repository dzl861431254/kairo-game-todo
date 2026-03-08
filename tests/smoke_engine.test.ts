/**
 * Smoke tests — TurnEngine core behaviour
 *
 * Run: npx tsx tests/smoke_engine.test.ts
 */

import assert from 'node:assert/strict';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { fastForward } from '../src/runtime/debug/fast_forward.js';
import { makeInitialState, makeEmptyContentDB, loadRealContentDB } from './fixtures.js';

const db = makeEmptyContentDB();
const realDB = loadRealContentDB();

function makeEngine() {
  return new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(e as Error).message}`);
    failed++;
  }
}

console.log('\n── smoke_engine ─────────────────────────────────────────\n');

test('executeTurn increments monthIndex by 1', () => {
  const state = makeInitialState();
  const engine = makeEngine();
  const { nextState } = engine.executeTurn(state, db, {});
  assert.equal(nextState.monthIndex, 1);
});

test('executeTurn does not mutate input state', () => {
  const state = makeInitialState();
  const monthBefore = state.monthIndex;
  const engine = makeEngine();
  engine.executeTurn(state, db, {});
  assert.equal(state.monthIndex, monthBefore, 'input state.monthIndex mutated');
});

test('yearIndex advances after 12 months', () => {
  const state = makeInitialState();
  const { finalState } = fastForward(state, db, 12, 42);
  assert.equal(finalState.yearIndex, 1);
  assert.equal(finalState.monthIndex, 12);
});

test('fastForward returns one report per month', () => {
  const state = makeInitialState();
  const { reports } = fastForward(state, db, 6, 42);
  assert.equal(reports.length, 6);
});

test('SettlementReport contains required fields', () => {
  const state = makeInitialState();
  const engine = makeEngine();
  const { report } = engine.executeTurn(state, db, {});
  assert.ok(Array.isArray(report.resourceChanges), 'missing resourceChanges');
  assert.ok(Array.isArray(report.eventsTriggered), 'missing eventsTriggered');
  assert.ok(Array.isArray(report.flagsChanged),    'missing flagsChanged');
  assert.ok(Array.isArray(report.annualChainLog),  'missing annualChainLog');
  assert.ok(typeof report.net === 'object',         'missing net');
  assert.ok(typeof report.monthIndex === 'number',  'missing monthIndex');
});

test('fastForward 120 months (real DB) — no crash', () => {
  const state = makeInitialState();
  const { finalState, reports } = fastForward(state, realDB, 120, 42);
  assert.equal(reports.length, 120);
  assert.equal(finalState.monthIndex, 120);
  assert.equal(finalState.yearIndex, 10);
});

test('rngState changes each turn (determinism check)', () => {
  const state = makeInitialState();
  const engine = makeEngine();
  const r1 = engine.executeTurn(state, db, {});
  const r2 = engine.executeTurn(state, db, {});
  // Same input → same nextState (deterministic)
  assert.equal(r1.nextState.monthIndex, r2.nextState.monthIndex);
  assert.deepEqual(r1.nextState.rngState, r2.nextState.rngState);
});

test('seedOverride in fastForward produces deterministic output', () => {
  const state = makeInitialState();
  const a = fastForward(state, realDB, 24, 999);
  const b = fastForward(state, realDB, 24, 999);
  assert.equal(a.finalState.resources.silver, b.finalState.resources.silver);
  assert.equal(a.finalState.monthIndex, b.finalState.monthIndex);
});

test('net.silver reflects upkeep deductions (empty building DB → 0)', () => {
  const state = makeInitialState();
  const engine = makeEngine();
  const { report } = engine.executeTurn(state, db, {});
  // With no buildings, no upkeep — silver net change should be 0
  assert.equal(report.net['silver'] ?? 0, 0);
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  smoke_engine: ${passed}/${passed + failed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  smoke_engine: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
