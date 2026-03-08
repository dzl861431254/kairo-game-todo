/**
 * Smoke tests — S1-3 主线解锁执行
 *
 * Run: npx tsx tests/smoke_mainline_unlocks.test.ts
 */

import assert from 'node:assert/strict';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import { executeUnlocks } from '../src/runtime/systems/mainline/unlock_executor.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import type { UnlockItem } from '../src/runtime/turn_engine/types.js';

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

console.log('\n── smoke_mainline_unlocks ─────────────────────────────\n');

// ── §1: executeUnlocks 函数 ──

console.log('▶ §1 executeUnlocks');

test('无解锁项返回空数组', () => {
  const effects = executeUnlocks([]);
  assert.deepEqual(effects, []);
});

test('system 类型 → system_unlock effect', () => {
  const unlocks: UnlockItem[] = [{ type: 'system', id: 'mission_dispatch', name: '任务派遣', unlocked: false }];
  const effects = executeUnlocks(unlocks);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'system_unlock');
  if (effects[0].type === 'system_unlock') {
    assert.equal(effects[0].systemId, 'mission_dispatch');
  }
});

test('building 类型 → building_unlock effect', () => {
  const unlocks: UnlockItem[] = [{ type: 'building', id: 'advanced_hall', name: '高级讲武堂', unlocked: false }];
  const effects = executeUnlocks(unlocks);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'building_unlock');
});

test('martial 类型 → martial_unlock effect', () => {
  const unlocks: UnlockItem[] = [{ type: 'martial', id: 'basic_sword', name: '基础剑法', unlocked: false }];
  const effects = executeUnlocks(unlocks);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'martial_unlock');
});

test('feature 类型 → feature_unlock effect', () => {
  const unlocks: UnlockItem[] = [{ type: 'feature', id: 'tournament', name: '武林大会', unlocked: false }];
  const effects = executeUnlocks(unlocks);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'feature_unlock');
});

test('多个解锁项 → 多个 effect', () => {
  const unlocks: UnlockItem[] = [
    { type: 'building', id: 'advanced_hall', name: '高级讲武堂', unlocked: false },
    { type: 'martial',  id: 'basic_sword',   name: '基础剑法',   unlocked: false },
  ];
  const effects = executeUnlocks(unlocks);
  assert.equal(effects.length, 2);
});

// ── §2: EffectExecutor 应用解锁 Effect ──

console.log('\n▶ §2 EffectExecutor 解锁 Effect');

const executor = new EffectExecutor();
const CTX = { source: { kind: 'system' as const, id: 'mainline' } };

test('system_unlock 写入 state.unlocks.systems', () => {
  const state = makeInitialState();
  const result = executor.apply(state, [{ type: 'system_unlock', systemId: 'mission_dispatch' }], CTX);
  assert.ok(result.nextState.unlocks.systems.includes('mission_dispatch'));
});

test('building_unlock 写入 state.unlocks.buildings', () => {
  const state = makeInitialState();
  const result = executor.apply(state, [{ type: 'building_unlock', buildingId: 'advanced_hall' }], CTX);
  assert.ok(result.nextState.unlocks.buildings.includes('advanced_hall'));
});

test('martial_unlock 写入 state.unlocks.martials', () => {
  const state = makeInitialState();
  const result = executor.apply(state, [{ type: 'martial_unlock', martialId: 'basic_sword' }], CTX);
  assert.ok(result.nextState.unlocks.martials.includes('basic_sword'));
});

test('feature_unlock 写入 state.unlocks.features', () => {
  const state = makeInitialState();
  const result = executor.apply(state, [{ type: 'feature_unlock', featureId: 'tournament' }], CTX);
  assert.ok(result.nextState.unlocks.features.includes('tournament'));
});

test('重复解锁不重复写入', () => {
  const state = makeInitialState();
  const r1 = executor.apply(state, [{ type: 'system_unlock', systemId: 'mission_dispatch' }], CTX);
  const r2 = executor.apply(r1.nextState, [{ type: 'system_unlock', systemId: 'mission_dispatch' }], CTX);
  assert.equal(r2.nextState.unlocks.systems.filter(s => s === 'mission_dispatch').length, 1);
});

test('原始 state 不被突变', () => {
  const state = makeInitialState();
  executor.apply(state, [{ type: 'martial_unlock', martialId: 'basic_sword' }], CTX);
  assert.equal(state.unlocks.martials.length, 0, '原始 state 不应被修改');
});

// ── §3: 初始 unlocks 状态 ──

console.log('\n▶ §3 初始 unlocks 状态');

test('初始 state.unlocks 所有列表为空', () => {
  const state = makeInitialState();
  assert.deepEqual(state.unlocks, { systems: [], buildings: [], martials: [], features: [] });
});

test('makeEmptyContentDB + makeInitialState 组合不崩溃', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  assert.ok(Array.isArray(state.unlocks.systems));
  assert.ok(Array.isArray(db.buildings.buildings));
});

// ── §4: 解锁 Effect 与 executeUnlocks 联合使用 ──

console.log('\n▶ §4 executeUnlocks → executor 联合流程');

test('章节解锁全流程：unlocks → effects → state 更新', () => {
  const state = makeInitialState();
  const chapterUnlocks: UnlockItem[] = [
    { type: 'system',   id: 'mission_dispatch', name: '任务派遣',   unlocked: false },
    { type: 'building', id: 'advanced_hall',    name: '高级讲武堂', unlocked: false },
    { type: 'martial',  id: 'basic_sword',      name: '基础剑法',   unlocked: false },
  ];
  const effects = executeUnlocks(chapterUnlocks);
  const result = executor.apply(state, effects, CTX);
  const unlocks = result.nextState.unlocks;
  assert.ok(unlocks.systems.includes('mission_dispatch'));
  assert.ok(unlocks.buildings.includes('advanced_hall'));
  assert.ok(unlocks.martials.includes('basic_sword'));
  assert.equal(unlocks.features.length, 0, 'features 未解锁');
});

test('只解锁 feature：其他列表不变', () => {
  const state = makeInitialState();
  const effects = executeUnlocks([{ type: 'feature', id: 'tournament', name: '武林大会', unlocked: false }]);
  const result = executor.apply(state, effects, CTX);
  const unlocks = result.nextState.unlocks;
  assert.equal(unlocks.systems.length,   0);
  assert.equal(unlocks.buildings.length, 0);
  assert.equal(unlocks.martials.length,  0);
  assert.equal(unlocks.features.length,  1);
  assert.ok(unlocks.features.includes('tournament'));
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  smoke_mainline_unlocks: ${passed}/${passed + failed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  smoke_mainline_unlocks: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
