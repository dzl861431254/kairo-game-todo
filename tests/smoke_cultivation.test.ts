/**
 * Smoke tests — 弟子培养系统 v1（境界+突破+天赋）
 *
 * 覆盖：
 *   境界系统 — realm/progress Effect 执行、clamp 边界
 *   突破系统 — 条件检查、成功率计算、结果 Effect、资源消耗
 *   天赋系统 — 月度成长差异、突破加成
 *   月度成长 — processDiscipleMonthlyGrowth 集成
 *   旧存档迁移 — 无 realm 字段弟子安全运行
 *
 * Run: npx tsx tests/smoke_cultivation.test.ts
 */

import assert from 'node:assert/strict';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import {
  checkBreakthroughRequirements,
  calcBreakthroughChance,
  rollBreakthroughResult,
  buildBreakthroughEffects,
} from '../src/runtime/systems/cultivation/breakthrough.js';
import { processDiscipleMonthlyGrowth } from '../src/runtime/systems/cultivation/monthly_growth.js';
import { fastForward } from '../src/runtime/debug/fast_forward.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { GameState, Disciple } from '../src/runtime/turn_engine/types.js';
import type { RealmDef } from '../src/runtime/systems/cultivation/types.js';
import { createRNG } from '../src/runtime/rng.js';

// ─────────────────────────────────────────────────────────────────────────────
// test harness
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeEngine() {
  return new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
}

function makeExecutor() { return new EffectExecutor(); }

/** 构造一名最简弟子（带 realm 字段） */
function makeDisciple(overrides: Partial<Disciple> = {}): Disciple {
  return {
    id: 'd_test',
    name: '测试弟子',
    stats: { physique: 30, comprehension: 30, willpower: 30, agility: 30, charisma: 30 },
    statuses: [],
    trainingProgress: {},
    realm: 'mortal',
    realmProgress: 0,
    breakthroughAttempts: 0,
    talentGrade: 'C',
    ...overrides,
  };
}

/** qi_sense 境界的 RealmDef（与 realms.json 一致） */
const QI_SENSE_REALM: RealmDef = {
  id: 'qi_sense',
  name: '感气',
  order: 1,
  attrMultiplier: 1.15,
  maxMartialSlots: 2,
  requirements: {
    stats: { physique: 30, comprehension: 25 },
    realmProgressMin: 80,
    resources: { silver: 100 },
  },
};

console.log('\n── smoke_cultivation ────────────────────────────────────\n');

// ─────────────────────────────────────────────────────────────────────────────
// §1 境界 Effect 执行器
// ─────────────────────────────────────────────────────────────────────────────

test('disciple_realm_set: 提升境界并重置进度/次数', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();
  s0.disciples[0]!.realm = 'mortal';
  s0.disciples[0]!.realmProgress = 75;
  s0.disciples[0]!.breakthroughAttempts = 2;

  const result = executor.apply(s0, [{
    type: 'disciple_realm_set',
    discipleId: 'd1',
    realmId: 'qi_sense',
  }], { source: { kind: 'system', id: 'test' } });

  const d = result.nextState.disciples[0]!;
  assert.equal(d.realm, 'qi_sense', '境界应提升');
  assert.equal(d.realmProgress, 0, '进度应重置');
  assert.equal(d.breakthroughAttempts, 0, '尝试次数应重置');
});

test('disciple_realm_progress_delta: 进度增加并 clamp 上限', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();
  s0.disciples[0]!.realmProgress = 95;

  const result = executor.apply(s0, [{
    type: 'disciple_realm_progress_delta',
    discipleId: 'd1',
    delta: 20,
  }], { source: { kind: 'system', id: 'test' } });

  assert.equal(result.nextState.disciples[0]!.realmProgress, 100, '进度不超过100');
});

test('disciple_realm_progress_delta: 进度减少并 clamp 下限', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();
  s0.disciples[0]!.realmProgress = 10;

  const result = executor.apply(s0, [{
    type: 'disciple_realm_progress_delta',
    discipleId: 'd1',
    delta: -50,
  }], { source: { kind: 'system', id: 'test' } });

  assert.equal(result.nextState.disciples[0]!.realmProgress, 0, '进度不低于0');
});

test('disciple_breakthrough_attempt: 失败增加尝试次数并扣进度', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();
  s0.disciples[0]!.realmProgress = 50;
  s0.disciples[0]!.breakthroughAttempts = 1;

  const result = executor.apply(s0, [{
    type: 'disciple_breakthrough_attempt',
    discipleId: 'd1',
    result: 'failure',
  }], { source: { kind: 'system', id: 'test' } });

  const d = result.nextState.disciples[0]!;
  assert.equal(d.breakthroughAttempts, 2, '失败后尝试次数+1');
  assert.equal(d.realmProgress, 40, '失败后进度-10');
});

test('disciple_breakthrough_attempt: 走火入魔扣进度40且添加状态', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();
  s0.disciples[0]!.realmProgress = 60;
  s0.disciples[0]!.breakthroughAttempts = 0;

  const result = executor.apply(s0, [{
    type: 'disciple_breakthrough_attempt',
    discipleId: 'd1',
    result: 'qi_deviation',
  }], { source: { kind: 'system', id: 'test' } });

  const d = result.nextState.disciples[0]!;
  assert.equal(d.realmProgress, 20, '走火入魔进度-40');
  assert.equal(d.breakthroughAttempts, 1, '尝试次数+1');
  assert.ok(d.statuses.some(s => s.statusId === 'qi_deviation'), '应添加 qi_deviation 状态');
  assert.equal(d.statuses.find(s => s.statusId === 'qi_deviation')?.remainingMonths, 3, '状态持续3月');
});

test('disciple_breakthrough_attempt: 成功/大成功不改变 attempts 或 progress（由 realm_set 处理）', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();
  s0.disciples[0]!.realmProgress = 80;
  s0.disciples[0]!.breakthroughAttempts = 2;

  for (const successResult of ['success', 'great_success'] as const) {
    const result = executor.apply(s0, [{
      type: 'disciple_breakthrough_attempt',
      discipleId: 'd1',
      result: successResult,
    }], { source: { kind: 'system', id: 'test' } });
    assert.equal(result.nextState.disciples[0]!.realmProgress, 80, `${successResult}: 进度不变（由 realm_set 重置）`);
    assert.equal(result.nextState.disciples[0]!.breakthroughAttempts, 2, `${successResult}: 次数不变`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 突破前置条件检查
// ─────────────────────────────────────────────────────────────────────────────

test('checkBreakthroughRequirements: 满足所有条件', () => {
  const s0 = makeInitialState();
  s0.resources.silver = 200;
  const disc = makeDisciple({ realmProgress: 90, stats: { physique: 35, comprehension: 30, willpower: 30, agility: 30, charisma: 30 } });
  const check = checkBreakthroughRequirements(disc, QI_SENSE_REALM, s0);
  assert.ok(check.canAttempt, `应可突破，blockers: ${JSON.stringify(check.blockers)}`);
  assert.equal(check.blockers.length, 0);
});

test('checkBreakthroughRequirements: 进度不足被阻止', () => {
  const s0 = makeInitialState();
  s0.resources.silver = 200;
  const disc = makeDisciple({ realmProgress: 70, stats: { physique: 35, comprehension: 30, willpower: 30, agility: 30, charisma: 30 } });
  const check = checkBreakthroughRequirements(disc, QI_SENSE_REALM, s0);
  assert.ok(!check.canAttempt);
  assert.ok(check.blockers.some(b => b.type === 'progress'), '应有 progress 类型 blocker');
});

test('checkBreakthroughRequirements: 属性不足被阻止', () => {
  const s0 = makeInitialState();
  s0.resources.silver = 200;
  // physique=10 < required 30
  const disc = makeDisciple({ realmProgress: 90, stats: { physique: 10, comprehension: 30, willpower: 30, agility: 30, charisma: 30 } });
  const check = checkBreakthroughRequirements(disc, QI_SENSE_REALM, s0);
  assert.ok(!check.canAttempt);
  assert.ok(check.blockers.some(b => b.type === 'stat' && b.key === 'physique'), '应有 physique stat blocker');
});

test('checkBreakthroughRequirements: 银两不足被阻止', () => {
  const s0 = makeInitialState();
  s0.resources.silver = 50; // 需要 100
  const disc = makeDisciple({ realmProgress: 90, stats: { physique: 35, comprehension: 30, willpower: 30, agility: 30, charisma: 30 } });
  const check = checkBreakthroughRequirements(disc, QI_SENSE_REALM, s0);
  assert.ok(!check.canAttempt);
  assert.ok(check.blockers.some(b => b.type === 'resource' && b.key === 'silver'), '应有 silver resource blocker');
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 突破成功率计算
// ─────────────────────────────────────────────────────────────────────────────

test('calcBreakthroughChance: C天赋基础 50%', () => {
  const disc = makeDisciple({ talentGrade: 'C' });
  const bd = makeEmptyContentDB().talents!;
  const talent = bd.talents.find(t => t.grade === 'C')!;
  const breakdown = calcBreakthroughChance(disc, talent);
  assert.equal(breakdown.base, 50);
  assert.equal(breakdown.talentBonus, 0);
});

test('calcBreakthroughChance: S天赋总分更高', () => {
  const db = makeEmptyContentDB().talents!;
  const talentS = db.talents.find(t => t.grade === 'S')!;
  const talentC = db.talents.find(t => t.grade === 'C')!;
  const discS = makeDisciple({ talentGrade: 'S' });
  const discC = makeDisciple({ talentGrade: 'C' });
  const chanceS = calcBreakthroughChance(discS, talentS);
  const chanceC = calcBreakthroughChance(discC, talentC);
  assert.ok(chanceS.total > chanceC.total, `S天赋(${chanceS.total})应高于C天赋(${chanceC.total})`);
});

test('calcBreakthroughChance: D天赋应受到负加成', () => {
  const db = makeEmptyContentDB().talents!;
  const talentD = db.talents.find(t => t.grade === 'D')!;
  const disc = makeDisciple({ talentGrade: 'D' });
  const breakdown = calcBreakthroughChance(disc, talentD);
  assert.equal(breakdown.talentBonus, -8, 'D天赋突破加成 -8');
});

test('calcBreakthroughChance: 高悟性提升成功率（每10点+3，上限15）', () => {
  const db = makeEmptyContentDB().talents!;
  const talent = db.talents.find(t => t.grade === 'C')!;
  const disc50 = makeDisciple({ stats: { physique: 30, comprehension: 50, willpower: 30, agility: 30, charisma: 30 } });
  const disc0  = makeDisciple({ stats: { physique: 30, comprehension: 0,  willpower: 30, agility: 30, charisma: 30 } });
  const chance50 = calcBreakthroughChance(disc50, talent);
  const chance0  = calcBreakthroughChance(disc0,  talent);
  // 50悟性 → floor(50/10)*3 = 15; 0悟性 → 0
  assert.equal(chance50.comprehensionBonus - chance0.comprehensionBonus, 15, '悟性加成差值应为15');
});

test('calcBreakthroughChance: 失败次数增加惩罚（每次-4，上限-20）', () => {
  const db = makeEmptyContentDB().talents!;
  const talent = db.talents.find(t => t.grade === 'C')!;
  const disc = makeDisciple({ breakthroughAttempts: 5 });
  const breakdown = calcBreakthroughChance(disc, talent);
  // 5次×4 = 20，但上限20
  assert.equal(breakdown.attemptPenalty, 20, '惩罚上限20');
});

test('calcBreakthroughChance: 总成功率在 5-95 之间 clamp', () => {
  const db = makeEmptyContentDB().talents!;
  // D天赋 + 多次失败 → total 应不低于 5
  const talentD = db.talents.find(t => t.grade === 'D')!;
  const discLow = makeDisciple({ talentGrade: 'D', breakthroughAttempts: 10, stats: { physique: 0, comprehension: 0, willpower: 0, agility: 0, charisma: 0 } });
  const low = calcBreakthroughChance(discLow, talentD);
  assert.ok(low.total >= 5, `最低成功率不应低于5: ${low.total}`);

  // S天赋 + 高属性 → total 应不超过 95
  const talentS = db.talents.find(t => t.grade === 'S')!;
  const discHigh = makeDisciple({ talentGrade: 'S', stats: { physique: 100, comprehension: 100, willpower: 100, agility: 100, charisma: 100 } });
  const high = calcBreakthroughChance(discHigh, talentS);
  assert.ok(high.total <= 95, `最高成功率不应超过95: ${high.total}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 突破结果及 Effect 构造
// ─────────────────────────────────────────────────────────────────────────────

test('rollBreakthroughResult: 成功率100时总是成功（确定性边界）', () => {
  const rng = createRNG(42);
  // 若 roll < 100 → success/great_success
  for (let i = 0; i < 20; i++) {
    const result = rollBreakthroughResult(100, createRNG(i));
    assert.ok(result === 'success' || result === 'great_success', `应成功，实际: ${result}`);
  }
  void rng;
});

test('rollBreakthroughResult: 成功率5时几乎总是失败', () => {
  let failCount = 0;
  for (let seed = 0; seed < 100; seed++) {
    const result = rollBreakthroughResult(5, createRNG(seed));
    if (result === 'failure' || result === 'qi_deviation') failCount++;
  }
  // 成功率5%时，100次应有至少80次失败
  assert.ok(failCount >= 80, `低成功率应高频失败: ${failCount}/100`);
});

test('buildBreakthroughEffects: 成功时生成 realm_set + 资源消耗', () => {
  const s0 = makeInitialState();
  s0.resources.silver = 500;
  const disc = makeDisciple({ realmProgress: 90, stats: { physique: 35, comprehension: 30, willpower: 30, agility: 30, charisma: 30 } });
  s0.disciples[0] = disc;

  const effects = buildBreakthroughEffects(disc, 'success', QI_SENSE_REALM, s0);

  assert.ok(effects.some(e => e.type === 'disciple_realm_set'), '成功应有 realm_set');
  assert.ok(effects.some(e => e.type === 'disciple_breakthrough_attempt' && (e as { result: string }).result === 'success'), '应有 breakthrough_attempt effect');
  assert.ok(effects.some(e => e.type === 'currency_delta' && (e as { delta: number }).delta < 0), '应有银两消耗');
});

test('buildBreakthroughEffects: 大成功有额外属性加成', () => {
  const s0 = makeInitialState();
  s0.resources.silver = 500;
  const disc = makeDisciple({ realmProgress: 90, stats: { physique: 35, comprehension: 30, willpower: 30, agility: 30, charisma: 30 } });
  s0.disciples[0] = disc;

  const effects = buildBreakthroughEffects(disc, 'great_success', QI_SENSE_REALM, s0);
  assert.ok(effects.some(e => e.type === 'disciple_stat_delta'), '大成功应有属性加成');
});

test('buildBreakthroughEffects: 失败时无资源消耗无 realm_set', () => {
  const s0 = makeInitialState();
  s0.resources.silver = 500;
  const disc = makeDisciple({ realmProgress: 90 });
  s0.disciples[0] = disc;

  const effects = buildBreakthroughEffects(disc, 'failure', QI_SENSE_REALM, s0);
  assert.ok(!effects.some(e => e.type === 'disciple_realm_set'), '失败不应提升境界');
  assert.ok(!effects.some(e => e.type === 'currency_delta'), '失败不扣资源');
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 月度成长（processDiscipleMonthlyGrowth）
// ─────────────────────────────────────────────────────────────────────────────

test('月度成长: C天赋每月 physique+1', () => {
  const db   = makeEmptyContentDB();
  const s0   = makeInitialState();
  const disc = s0.disciples[0]!;
  disc.talentGrade = 'C';
  disc.realm = 'mortal';
  disc.realmProgress = 0;

  const effects = processDiscipleMonthlyGrowth(s0, db.talents!.talents);
  const physEffect = effects.find(e =>
    e.type === 'disciple_stat_delta' &&
    (e as { discipleId: string; statId: string }).discipleId === disc.id &&
    (e as { statId: string }).statId === 'physique',
  );
  assert.ok(physEffect, '应有 physique 成长 effect');
  assert.equal((physEffect as { delta: number }).delta, 1, 'C天赋每月+1');
});

test('月度成长: S天赋每月 physique+4（基础1+天赋3）', () => {
  const db   = makeEmptyContentDB();
  const s0   = makeInitialState();
  s0.disciples[0]!.talentGrade = 'S';

  const effects = processDiscipleMonthlyGrowth(s0, db.talents!.talents);
  const physEffect = effects.find(e =>
    e.type === 'disciple_stat_delta' &&
    (e as { statId: string }).statId === 'physique' &&
    (e as { discipleId: string }).discipleId === s0.disciples[0]!.id,
  );
  assert.equal((physEffect as { delta: number }).delta, 4, 'S天赋每月+4');
});

test('月度成长: D天赋（基础1+天赋-1=0）无成长 effect', () => {
  const db   = makeEmptyContentDB();
  const s0   = makeInitialState();
  s0.disciples[0]!.talentGrade = 'D';

  const effects = processDiscipleMonthlyGrowth(s0, db.talents!.talents);
  const physEffect = effects.find(e =>
    e.type === 'disciple_stat_delta' &&
    (e as { statId: string }).statId === 'physique' &&
    (e as { discipleId: string }).discipleId === s0.disciples[0]!.id,
  );
  // D天赋 totalGrowth = 1 + (-1) = 0，不生成 effect
  assert.ok(!physEffect, 'D天赋（0成长）不应有成长 effect');
});

test('月度成长: C天赋境界进度每月+2', () => {
  const db   = makeEmptyContentDB();
  const s0   = makeInitialState();
  s0.disciples[0]!.talentGrade = 'C';

  const effects = processDiscipleMonthlyGrowth(s0, db.talents!.talents);
  const progEffect = effects.find(e =>
    e.type === 'disciple_realm_progress_delta' &&
    (e as { discipleId: string }).discipleId === s0.disciples[0]!.id,
  );
  assert.ok(progEffect, '应有境界进度成长 effect');
  assert.equal((progEffect as { delta: number }).delta, 2, 'C天赋每月进度+2');
});

test('月度成长: S天赋境界进度每月+5（基础2+天赋3）', () => {
  const db   = makeEmptyContentDB();
  const s0   = makeInitialState();
  s0.disciples[0]!.talentGrade = 'S';

  const effects = processDiscipleMonthlyGrowth(s0, db.talents!.talents);
  const progEffect = effects.find(e =>
    e.type === 'disciple_realm_progress_delta' &&
    (e as { discipleId: string }).discipleId === s0.disciples[0]!.id,
  );
  assert.equal((progEffect as { delta: number }).delta, 5, 'S天赋每月进度+5');
});

test('月度成长: 空 talents 列表时无 effect', () => {
  const s0     = makeInitialState();
  const effects = processDiscipleMonthlyGrowth(s0, []);
  assert.equal(effects.length, 0, '空天赋库不应产生任何 effect');
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 引擎集成 — 月度成长端到端
// ─────────────────────────────────────────────────────────────────────────────

test('TurnEngine 集成: C天赋弟子12月后 physique+12', () => {
  const db  = makeEmptyContentDB();
  const s0  = makeInitialState();
  s0.disciples[0]!.talentGrade = 'C';
  const initialPhy = s0.disciples[0]!.stats['physique'] ?? 0;

  const { finalState } = fastForward(s0, db, 12);
  const finalPhy = finalState.disciples[0]!.stats['physique'] ?? 0;
  // C天赋每月+1，12月后+12
  assert.equal(finalPhy - initialPhy, 12, `physique 应增加12：${initialPhy}→${finalPhy}`);
});

test('TurnEngine 集成: S天赋弟子12月后 physique+48（基础+天赋=4/月）', () => {
  const db  = makeEmptyContentDB();
  const s0  = makeInitialState();
  s0.disciples[0]!.talentGrade = 'S';
  const initialPhy = s0.disciples[0]!.stats['physique'] ?? 0;

  const { finalState } = fastForward(s0, db, 12);
  const finalPhy = finalState.disciples[0]!.stats['physique'] ?? 0;
  assert.equal(finalPhy - initialPhy, 48, `S天赋physique应增加48：${initialPhy}→${finalPhy}`);
});

test('TurnEngine 集成: C天赋境界进度12月内从0增长至24', () => {
  const db  = makeEmptyContentDB();
  const s0  = makeInitialState();
  s0.disciples[0]!.talentGrade = 'C';
  s0.disciples[0]!.realmProgress = 0;

  const { finalState } = fastForward(s0, db, 12);
  const progress = finalState.disciples[0]!.realmProgress;
  // C天赋每月+2，12月后=24；但进度 clamp 在 100，24未超限
  assert.equal(progress, 24, `境界进度应为24，实际${progress}`);
});

test('TurnEngine 集成: 突破 PlayerOp 在 pre 阶段执行', () => {
  const db  = makeEmptyContentDB();
  const engine = makeEngine();
  const s0  = makeInitialState();

  // 手动设置满足感气境界的条件
  const disc = s0.disciples[0]!;
  disc.stats['physique']      = 35;
  disc.stats['comprehension'] = 30;
  disc.realmProgress = 85;
  s0.resources.silver = 500;

  // 使用足够高的 seed 确保成功（理论上50%以上成功率）
  // 这里通过多次尝试找到一个成功的 seed
  let succeeded = false;
  for (let seed = 0; seed < 50; seed++) {
    const testState = structuredClone(s0) as GameState;
    testState.rngState = seed;
    const { nextState } = engine.executeTurn(testState, db, {
      attemptBreakthrough: [{ discipleId: disc.id }],
    });
    if (nextState.disciples[0]!.realm === 'qi_sense') {
      succeeded = true;
      break;
    }
  }
  assert.ok(succeeded, '至少有一个 seed 能让突破成功（条件满足，成功率>50%）');
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 旧存档迁移
// ─────────────────────────────────────────────────────────────────────────────

test('旧存档弟子（无 realm 字段）48月安全运行', () => {
  const db  = makeEmptyContentDB();
  const s0  = makeInitialState() as GameState;
  // 模拟旧存档：删除 realm 相关字段
  for (const d of s0.disciples) {
    const oldD = d as Record<string, unknown>;
    delete oldD['realm'];
    delete oldD['realmProgress'];
    delete oldD['breakthroughAttempts'];
    delete oldD['talentGrade'];
  }
  // 引擎应当能处理缺少 realm 字段的弟子（通过 undefined 容错）
  // fastForward 应不崩溃
  const { finalState } = fastForward(s0, db, 48);
  assert.equal(finalState.monthIndex, 48, '旧存档应能完整运行48月');
});

test('招募新弟子默认境界为 mortal / 天赋为 C', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();
  s0.recruitPool = [{ id: 'new1', name: '新人', stats: { physique: 20, comprehension: 20, willpower: 20, agility: 20, charisma: 20 } }];

  const result = executor.apply(s0, [{
    type: 'disciple_recruit',
    candidateId: 'new1',
    name: '新人',
    stats: { physique: 20, comprehension: 20, willpower: 20, agility: 20, charisma: 20 },
  }], { source: { kind: 'system', id: 'test' } });

  const newD = result.nextState.disciples.find(d => d.id === 'new1');
  assert.ok(newD, '新弟子应存在');
  assert.equal(newD!.realm, 'mortal', '新招募弟子默认 mortal 境界');
  assert.equal(newD!.talentGrade, 'C', '无 talentGrade 时默认 C');
  assert.equal(newD!.realmProgress, 0, '新弟子进度为0');
});

test('招募时指定天赋等级 S 可保留', () => {
  const executor = makeExecutor();
  const s0 = makeInitialState();

  const result = executor.apply(s0, [{
    type: 'disciple_recruit',
    candidateId: 's_talent',
    name: '天才',
    stats: { physique: 30, comprehension: 30, willpower: 30, agility: 30, charisma: 30 },
    talentGrade: 'S',
  }], { source: { kind: 'system', id: 'test' } });

  const newD = result.nextState.disciples.find(d => d.id === 's_talent');
  assert.equal(newD!.talentGrade, 'S', '招募时天赋等级应保留');
});

// ─────────────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────────────

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
