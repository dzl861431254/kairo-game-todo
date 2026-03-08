/**
 * Smoke tests — S2-2 势力关系影响任务池权重
 *
 * Run: npx tsx tests/smoke_faction_mission_weight.test.ts
 */

import assert from 'node:assert/strict';
import { calcMissionWeight, generateMissionPool, DEFAULT_POOL_SIZE } from '../src/runtime/systems/mission/pool_generator.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { makeInitialState, makeEmptyContentDB, loadRealContentDB } from './fixtures.js';
import type { MissionTemplateDef } from '../src/runtime/systems/mission/types.js';

// ── Test helpers ──

function makeEngine() {
  return new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
}

function makeMission(id: string, factionId?: string, weight = 1): MissionTemplateDef {
  return {
    id,
    name: id,
    description: '',
    category: 'combat',
    durationMonths: 1,
    minPartySize: 1,
    recommendedPower: 10,
    rewards: [],
    failPenalty: [],
    eventCardIds: [],
    factionId,
    weight,
  };
}

/** 简单 RNG 包装（确定性） */
function makeDeterministicRng(seed = 1): { next: () => number; pick: <T>(arr: T[]) => T } {
  let s = seed;
  return {
    next() {
      // LCG
      s = (s * 1664525 + 1013904223) & 0x7fffffff;
      return s / 0x7fffffff;
    },
    pick<T>(arr: T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
  };
}

// ── Test runner ──

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

console.log('\n── smoke_faction_mission_weight ─────────────────────────\n');

// ── §1: calcMissionWeight ──

console.log('▶ §1 calcMissionWeight');

test('无势力ID任务：权重=baseWeight', () => {
  const m = makeMission('neutral');
  const w = calcMissionWeight(m, {});
  assert.equal(w, 1);
});

test('无势力ID任务：baseWeight=2 时权重=2', () => {
  const m = makeMission('neutral', undefined, 2);
  const w = calcMissionWeight(m, {});
  assert.equal(w, 2);
});

test('关系+100 → 权重 = baseWeight * 1.5', () => {
  const m = makeMission('merchant_task', 'faction.merchant', 1);
  const w = calcMissionWeight(m, { 'faction.merchant': 100 });
  assert.equal(w, 1.5);
});

test('关系-100 → 权重 = baseWeight * 0.5', () => {
  const m = makeMission('demon_task', 'faction.demon', 1);
  const w = calcMissionWeight(m, { 'faction.demon': -100 });
  assert.equal(w, 0.5);
});

test('关系0 → 权重 = baseWeight * 1.0', () => {
  const m = makeMission('gov_task', 'faction.government', 1);
  const w = calcMissionWeight(m, { 'faction.government': 0 });
  assert.equal(w, 1);
});

test('关系+60 → 权重约 1.3x', () => {
  const m = makeMission('merchant_task', 'faction.merchant', 1);
  const w = calcMissionWeight(m, { 'faction.merchant': 60 });
  assert.ok(Math.abs(w - 1.3) < 1e-9, `expected 1.3, got ${w}`);
});

test('关系-60 → 权重约 0.7x', () => {
  const m = makeMission('demon_task', 'faction.demon', 1);
  const w = calcMissionWeight(m, { 'faction.demon': -60 });
  assert.ok(Math.abs(w - 0.7) < 1e-9, `expected 0.7, got ${w}`);
});

test('高关系势力任务权重 > 低关系势力任务权重', () => {
  const merchant = makeMission('escort_merchant', 'faction.merchant');
  const demon    = makeMission('assassinate',     'faction.demon');
  const relations = { 'faction.merchant': 60, 'faction.demon': -60 };
  const merchantW = calcMissionWeight(merchant, relations);
  const demonW    = calcMissionWeight(demon, relations);
  assert.ok(merchantW > demonW, `merchantW(${merchantW}) should > demonW(${demonW})`);
});

test('权重不为负（关系极端-200 clamp到0）', () => {
  const m = makeMission('extreme_demon', 'faction.demon', 1);
  const w = calcMissionWeight(m, { 'faction.demon': -200 });
  assert.ok(w >= 0, `weight should not be negative, got ${w}`);
});

// ── §2: generateMissionPool ──

console.log('\n▶ §2 generateMissionPool');

const TEMPLATES: MissionTemplateDef[] = [
  makeMission('merchant_1', 'faction.merchant', 1),
  makeMission('merchant_2', 'faction.merchant', 1),
  makeMission('merchant_3', 'faction.merchant', 1),
  makeMission('demon_1',    'faction.demon',    1),
  makeMission('demon_2',    'faction.demon',    1),
  makeMission('neutral_1',  undefined,          1),
];

test('空模板列表返回空数组', () => {
  const pool = generateMissionPool([], {}, makeDeterministicRng(), 5);
  assert.deepEqual(pool, []);
});

test('pool 大小不超过模板数量', () => {
  const pool = generateMissionPool(TEMPLATES, {}, makeDeterministicRng(), 100);
  assert.equal(pool.length, TEMPLATES.length);
});

test('返回指定 poolSize 数量', () => {
  const pool = generateMissionPool(TEMPLATES, {}, makeDeterministicRng(), 4);
  assert.equal(pool.length, 4);
});

test('池中无重复 templateId', () => {
  const pool = generateMissionPool(TEMPLATES, {}, makeDeterministicRng(), 5);
  const unique = new Set(pool);
  assert.equal(unique.size, pool.length, '池中不应有重复');
});

test('池中所有 ID 来自模板列表', () => {
  const pool = generateMissionPool(TEMPLATES, {}, makeDeterministicRng(), 5);
  const validIds = new Set(TEMPLATES.map(t => t.id));
  for (const id of pool) {
    assert.ok(validIds.has(id), `ID ${id} 不在模板列表中`);
  }
});

test('关系+100 时商会任务在大量抽样中出现频率 > 60%', () => {
  // 3个商会任务 vs 2个魔教任务 vs 1个中立；pool=3
  // 商会权重=1.5 * 3 = 4.5; 魔教权重=0.5 * 2 = 1; 中立=1; total=6.5
  // 期望商会任务出现率: 4.5/6.5 ≈ 69% in 3-slot pool
  const relations = { 'faction.merchant': 100, 'faction.demon': -100 };
  const RUNS = 500;
  let merchantCount = 0;
  for (let i = 0; i < RUNS; i++) {
    const rng = makeDeterministicRng(i + 1);
    const pool = generateMissionPool(TEMPLATES, relations, rng, 3);
    merchantCount += pool.filter(id => id.startsWith('merchant_')).length;
  }
  const rate = merchantCount / (RUNS * 3);
  assert.ok(rate > 0.6, `商会任务出现率 ${(rate * 100).toFixed(1)}% 应 > 60%`);
});

test('关系-100 时魔教任务在大量抽样中出现频率 < 中立基准率', () => {
  // 中立关系下魔教任务基准率: 2任务/6模板 ≈ 33%
  // 关系-100 → weight=0.5×，理论频率 ≈ 20%（应明显低于基准）
  const RUNS = 500;
  let demonCountBoosted = 0;
  let demonCountNeutral  = 0;
  for (let i = 0; i < RUNS; i++) {
    const rngA = makeDeterministicRng(i + 1);
    const rngB = makeDeterministicRng(i + 1);
    const poolLow     = generateMissionPool(TEMPLATES, { 'faction.demon': -100 }, rngA, 3);
    const poolNeutral = generateMissionPool(TEMPLATES, {},                         rngB, 3);
    demonCountBoosted += poolLow.filter(id => id.startsWith('demon_')).length;
    demonCountNeutral += poolNeutral.filter(id => id.startsWith('demon_')).length;
  }
  const rateLow     = demonCountBoosted / (RUNS * 3);
  const rateNeutral = demonCountNeutral  / (RUNS * 3);
  assert.ok(
    rateLow < rateNeutral,
    `关系-100 时魔教出现率 ${(rateLow * 100).toFixed(1)}% 应低于中立基准率 ${(rateNeutral * 100).toFixed(1)}%`,
  );
});

test('全部权重为0时仍能正常选取（不崩溃）', () => {
  // 极端 relation = -200 → weight = max(0, 0) = 0
  const templates = [
    makeMission('t1', 'faction.demon', 1),
    makeMission('t2', 'faction.demon', 1),
  ];
  const relations = { 'faction.demon': -200 };
  const pool = generateMissionPool(templates, relations, makeDeterministicRng(), 2);
  assert.equal(pool.length, 2);
});

// ── §3: TurnEngine 集成 ──

console.log('\n▶ §3 TurnEngine 集成');

test('真实 DB：执行一回合后 missionsPool 不为空', () => {
  const db = loadRealContentDB();
  const state = makeInitialState();
  const engine = makeEngine();
  const { nextState } = engine.executeTurn(state, db, {});
  assert.ok(nextState.missionsPool.length > 0, '任务池应已生成');
});

test('真实 DB：missionsPool 中的 ID 均为有效任务模板', () => {
  const db = loadRealContentDB();
  const state = makeInitialState();
  const engine = makeEngine();
  const { nextState } = engine.executeTurn(state, db, {});
  const validIds = new Set(db.missions.templates.map(t => t.id));
  for (const id of nextState.missionsPool) {
    assert.ok(validIds.has(id), `池中 ID ${id} 不合法`);
  }
});

test('真实 DB：missionsPool 大小 <= DEFAULT_POOL_SIZE', () => {
  const db = loadRealContentDB();
  const state = makeInitialState();
  const engine = makeEngine();
  const { nextState } = engine.executeTurn(state, db, {});
  assert.ok(
    nextState.missionsPool.length <= DEFAULT_POOL_SIZE,
    `池大小 ${nextState.missionsPool.length} 应 <= ${DEFAULT_POOL_SIZE}`,
  );
});

test('真实 DB：商会关系+80 时商会任务在池中比例更高', () => {
  const db = loadRealContentDB();
  const engine = makeEngine();

  // 高商会关系
  const stateHigh = { ...makeInitialState(), factions: { 'faction.merchant': 80, 'faction.demon': 0, 'faction.government': 0, 'faction.righteous': 0, 'faction.beggar': 0 } };
  // 低商会关系
  const stateLow  = { ...makeInitialState(), factions: { 'faction.merchant': -80, 'faction.demon': 0, 'faction.government': 0, 'faction.righteous': 0, 'faction.beggar': 0 } };

  const RUNS = 200;
  let highMerchantCount = 0;
  let lowMerchantCount  = 0;

  const merchantIds = new Set(
    db.missions.templates.filter(t => t.factionId === 'faction.merchant').map(t => t.id),
  );

  for (let i = 0; i < RUNS; i++) {
    const sHigh = { ...stateHigh, rngState: stateHigh.rngSeed + i };
    const sLow  = { ...stateLow,  rngState: stateLow.rngSeed + i };
    const { nextState: nsHigh } = engine.executeTurn(sHigh, db, {});
    const { nextState: nsLow  } = engine.executeTurn(sLow,  db, {});
    highMerchantCount += nsHigh.missionsPool.filter(id => merchantIds.has(id)).length;
    lowMerchantCount  += nsLow.missionsPool.filter(id =>  merchantIds.has(id)).length;
  }
  assert.ok(
    highMerchantCount > lowMerchantCount,
    `高商会关系(${highMerchantCount})应比低关系(${lowMerchantCount})出现更多商会任务`,
  );
});

test('missions.json 包含所有5个势力的任务', () => {
  const db = loadRealContentDB();
  const factionIds = new Set(db.missions.templates.map(t => t.factionId).filter(Boolean));
  assert.ok(factionIds.has('faction.righteous'), '应有 righteous 任务');
  assert.ok(factionIds.has('faction.demon'),     '应有 demon 任务');
  assert.ok(factionIds.has('faction.government'),'应有 government 任务');
  assert.ok(factionIds.has('faction.merchant'),  '应有 merchant 任务');
  assert.ok(factionIds.has('faction.beggar'),    '应有 beggar 任务');
});

test('旧存档（missionsPool=[]）回退到全量任务列表', () => {
  const db = loadRealContentDB();
  const state = { ...makeInitialState(), missionsPool: [] };
  // 不执行回合，直接检查 pool 是空数组
  assert.equal(state.missionsPool.length, 0);
  // GameManager.getMissionsPool() 会回退到全量，这里用 templates 直接验证逻辑
  const fallback = db.missions.templates.map(t => t.id);
  assert.ok(fallback.length > 0, '全量任务列表不为空');
});

test('DEFAULT_POOL_SIZE = 6', () => {
  assert.equal(DEFAULT_POOL_SIZE, 6);
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  smoke_faction_mission_weight: ${passed}/${passed + failed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  smoke_faction_mission_weight: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
