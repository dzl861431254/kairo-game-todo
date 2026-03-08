/**
 * smoke_mastership.test.ts
 *
 * v1.5 师徒 + 武学学习系统回归测试
 *
 * 覆盖：
 *   §1  武学学习 Effect 执行器
 *   §2  canStartLearning 检查
 *   §3  学习时长计算
 *   §4  月度成长：武学学习进度推进
 *   §5  师徒系统：canEstablishMastership
 *   §6  师徒 Effect 执行器
 *   §7  突破成功率加成（masterBonus）
 *   §8  突破传承效果
 *   §9  TurnEngine 集成
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import type { EffectContext } from '../src/runtime/effect/types.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import { canStartLearning, calcLearnDuration } from '../src/runtime/systems/cultivation/martial_learning.js';
import { canEstablishMastership, calcMasterBreakthroughBonus, buildInheritanceEffects } from '../src/runtime/systems/cultivation/mastership.js';
import { calcBreakthroughChance } from '../src/runtime/systems/cultivation/breakthrough.js';
import { processDiscipleMonthlyGrowth } from '../src/runtime/systems/cultivation/monthly_growth.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import type { Disciple, GameState } from '../src/runtime/turn_engine/types.js';

// ── 辅助 ──

const executor = new EffectExecutor();
const ctx: EffectContext = { source: { kind: 'system', id: 'test' } };

function makeTestState(): GameState {
  const s = makeInitialState();
  // 添加两名弟子用于师徒测试
  s.disciples = [
    {
      id: 'd1', name: '大师兄',
      stats: { physique: 70, comprehension: 65, willpower: 55, agility: 50, charisma: 40 },
      statuses: [], trainingProgress: {},
      realm: 'foundation' as const, realmProgress: 50, breakthroughAttempts: 0, talentGrade: 'B' as const,
    },
    {
      id: 'd2', name: '小师弟',
      stats: { physique: 30, comprehension: 25, willpower: 20, agility: 20, charisma: 15 },
      statuses: [], trainingProgress: {},
      realm: 'mortal' as const, realmProgress: 40, breakthroughAttempts: 0, talentGrade: 'C' as const,
    },
  ];
  // 解锁 test_basic 武学
  s.martialArts = { unlocked: ['test_basic'], research: {} };
  return s;
}

const db = makeEmptyContentDB();
const realmDefs = db.realms!.realms;

// ── §1 武学学习 Effect 执行器 ──

describe('§1 武学学习 Effect 执行器', () => {
  it('disciple_martial_learn_start: 设置 martialLearning 状态', () => {
    const state = makeTestState();
    const { nextState } = executor.apply(state, [{
      type: 'disciple_martial_learn_start',
      discipleId: 'd2',
      martialId: 'test_basic',
      durationMonths: 2,
      startMonth: 5,
      progressMonths: 0,
      source: 'self',
    }], ctx);
    const d = nextState.disciples.find(x => x.id === 'd2')!;
    assert.equal(d.martialLearning?.martialId, 'test_basic');
    assert.equal(d.martialLearning?.targetMonths, 2);
    assert.equal(d.martialLearning?.progressMonths, 0);
    assert.equal(d.martialLearning?.source, 'self');
  });

  it('disciple_martial_learn_start (progress_tick): 推进 progressMonths', () => {
    const state = makeTestState();
    // 先设置初始学习状态
    const s1 = executor.apply(state, [{
      type: 'disciple_martial_learn_start',
      discipleId: 'd2', martialId: 'test_basic',
      durationMonths: 2, startMonth: 0, progressMonths: 0, source: 'self',
    }], ctx).nextState;
    // 推进 progressMonths=1
    const { nextState } = executor.apply(s1, [{
      type: 'disciple_martial_learn_start',
      discipleId: 'd2', martialId: 'test_basic',
      durationMonths: 2, startMonth: 0, progressMonths: 1, source: 'self',
    }], ctx);
    const d = nextState.disciples.find(x => x.id === 'd2')!;
    assert.equal(d.martialLearning?.progressMonths, 1);
  });

  it('disciple_martial_learn_cancel: 清除 martialLearning', () => {
    const state = makeTestState();
    const s1 = executor.apply(state, [{
      type: 'disciple_martial_learn_start',
      discipleId: 'd2', martialId: 'test_basic',
      durationMonths: 2, startMonth: 0, progressMonths: 0, source: 'self',
    }], ctx).nextState;
    const { nextState } = executor.apply(s1, [{
      type: 'disciple_martial_learn_cancel',
      discipleId: 'd2',
    }], ctx);
    const d = nextState.disciples.find(x => x.id === 'd2')!;
    assert.equal(d.martialLearning, undefined);
  });

  it('disciple_martial_learn_complete: 加入 knownArts，清除 martialLearning', () => {
    const state = makeTestState();
    const s1 = executor.apply(state, [{
      type: 'disciple_martial_learn_start',
      discipleId: 'd2', martialId: 'test_basic',
      durationMonths: 2, startMonth: 0, progressMonths: 1, source: 'self',
    }], ctx).nextState;
    const { nextState } = executor.apply(s1, [{
      type: 'disciple_martial_learn_complete',
      discipleId: 'd2', martialId: 'test_basic',
    }], ctx);
    const d = nextState.disciples.find(x => x.id === 'd2')!;
    assert.equal(d.martialLearning, undefined);
    assert.ok(d.knownArts?.includes('test_basic'));
  });

  it('disciple_martial_learn_complete: 不重复加入 knownArts', () => {
    const state = makeTestState();
    state.disciples[1].knownArts = ['test_basic'];
    const { nextState } = executor.apply(state, [{
      type: 'disciple_martial_learn_complete',
      discipleId: 'd2', martialId: 'test_basic',
    }], ctx);
    const d = nextState.disciples.find(x => x.id === 'd2')!;
    assert.equal(d.knownArts?.filter(a => a === 'test_basic').length, 1);
  });
});

// ── §2 canStartLearning 检查 ──

describe('§2 canStartLearning 检查', () => {
  it('条件满足时 canStart=true', () => {
    const state = makeTestState();
    const disc = state.disciples.find(d => d.id === 'd2')!;
    const artDef = db.martialArts.martialArts.find(a => a.id === 'test_basic')!;
    const check = canStartLearning(disc, artDef, state, realmDefs);
    assert.equal(check.canStart, true);
    assert.equal(check.blockers.length, 0);
  });

  it('门派未解锁：not_unlocked blocker', () => {
    const state = makeTestState();
    state.martialArts.unlocked = []; // 清空
    const disc = state.disciples.find(d => d.id === 'd2')!;
    const artDef = db.martialArts.martialArts.find(a => a.id === 'test_basic')!;
    const check = canStartLearning(disc, artDef, state, realmDefs);
    assert.equal(check.canStart, false);
    assert.ok(check.blockers.some(b => b.type === 'not_unlocked'));
  });

  it('前置武学未掌握：prereq blocker', () => {
    const state = makeTestState();
    state.martialArts.unlocked = ['test_basic', 'test_advanced'];
    const disc = state.disciples.find(d => d.id === 'd2')!;
    // test_advanced 需要 test_basic，disc.knownArts 为空
    const artDef = db.martialArts.martialArts.find(a => a.id === 'test_advanced')!;
    const check = canStartLearning(disc, artDef, state, realmDefs);
    assert.equal(check.canStart, false);
    assert.ok(check.blockers.some(b => b.type === 'prereq'));
  });

  it('境界不足：realm blocker', () => {
    const state = makeTestState();
    state.martialArts.unlocked = ['test_basic', 'test_advanced'];
    const disc = state.disciples.find(d => d.id === 'd2')!;
    // d2 在 mortal 境界，test_advanced 需要 qi_gather
    disc.knownArts = ['test_basic']; // prereq 满足，但境界不足
    const artDef = db.martialArts.martialArts.find(a => a.id === 'test_advanced')!;
    const check = canStartLearning(disc, artDef, state, realmDefs);
    assert.equal(check.canStart, false);
    assert.ok(check.blockers.some(b => b.type === 'realm'));
  });

  it('已在学习：already_learning blocker', () => {
    const state = makeTestState();
    const disc = state.disciples.find(d => d.id === 'd2')!;
    disc.martialLearning = {
      martialId: 'test_basic', startMonth: 0,
      progressMonths: 0, targetMonths: 2, source: 'self',
    };
    const artDef = db.martialArts.martialArts.find(a => a.id === 'test_basic')!;
    const check = canStartLearning(disc, artDef, state, realmDefs);
    assert.equal(check.canStart, false);
    assert.ok(check.blockers.some(b => b.type === 'already_learning'));
  });

  it('已掌握：already_known blocker', () => {
    const state = makeTestState();
    const disc = state.disciples.find(d => d.id === 'd2')!;
    disc.knownArts = ['test_basic'];
    const artDef = db.martialArts.martialArts.find(a => a.id === 'test_basic')!;
    const check = canStartLearning(disc, artDef, state, realmDefs);
    assert.equal(check.canStart, false);
    assert.ok(check.blockers.some(b => b.type === 'already_known'));
  });
});

// ── §3 学习时长计算 ──

describe('§3 学习时长计算', () => {
  const artDef = makeEmptyContentDB().martialArts.martialArts.find(a => a.id === 'test_basic')!;

  it('自学：返回 learnCost.months', () => {
    const dur = calcLearnDuration(artDef, 'self');
    assert.equal(dur, 2); // test_basic learnCost.months = 2
  });

  it('师授：时长缩短 25%', () => {
    const dur = calcLearnDuration(artDef, 'master_teach');
    // floor(2 * 0.75) = 1
    assert.equal(dur, 1);
  });

  it('师授：最少1月', () => {
    // 如果 months=1，floor(1*0.75)=0 → clamp to 1
    const minArt = { ...artDef, learnCost: { months: 1, comprehensionReq: 10 } };
    const dur = calcLearnDuration(minArt, 'master_teach');
    assert.equal(dur, 1);
  });

  it('无 learnCost：默认3月', () => {
    const noLCDef = { ...artDef, learnCost: undefined };
    const dur = calcLearnDuration(noLCDef, 'self');
    assert.equal(dur, 3);
  });
});

// ── §4 月度成长：武学学习进度推进 ──

describe('§4 月度成长：武学学习进度推进', () => {
  it('学习中：progress+1（生成 progress_tick effect）', () => {
    const state = makeTestState();
    state.disciples[1].martialLearning = {
      martialId: 'test_basic', startMonth: 0,
      progressMonths: 0, targetMonths: 2, source: 'self',
    };
    const effects = processDiscipleMonthlyGrowth(state, db.talents!.talents);
    const tick = effects.find(e =>
      e.type === 'disciple_martial_learn_start' && e.discipleId === 'd2',
    );
    assert.ok(tick, '应生成 learn_start tick effect');
    if (tick?.type === 'disciple_martial_learn_start') {
      assert.equal(tick.progressMonths, 1);
    }
  });

  it('学习完成（progress+1 >= targetMonths）：生成 complete effect', () => {
    const state = makeTestState();
    state.disciples[1].martialLearning = {
      martialId: 'test_basic', startMonth: 0,
      progressMonths: 1, targetMonths: 2, source: 'self', // nextProgress = 2 >= 2
    };
    const effects = processDiscipleMonthlyGrowth(state, db.talents!.talents);
    const complete = effects.find(e =>
      e.type === 'disciple_martial_learn_complete' && e.discipleId === 'd2',
    );
    assert.ok(complete, '应生成 learn_complete effect');
    if (complete?.type === 'disciple_martial_learn_complete') {
      assert.equal(complete.martialId, 'test_basic');
    }
  });

  it('未在学习：无武学学习相关 effect', () => {
    const state = makeTestState();
    const effects = processDiscipleMonthlyGrowth(state, db.talents!.talents);
    const learningEffects = effects.filter(e =>
      e.type === 'disciple_martial_learn_start' ||
      e.type === 'disciple_martial_learn_complete',
    );
    assert.equal(learningEffects.length, 0);
  });
});

// ── §5 师徒系统：canEstablishMastership ──

describe('§5 师徒系统：canEstablishMastership', () => {
  it('条件满足时 canEstablish=true', () => {
    const state = makeTestState();
    const master = state.disciples.find(d => d.id === 'd1')!; // foundation
    const apprentice = state.disciples.find(d => d.id === 'd2')!; // mortal
    const check = canEstablishMastership(master, apprentice, realmDefs);
    assert.equal(check.canEstablish, true);
  });

  it('师父境界不足（低于 foundation）：master_realm blocker', () => {
    const state = makeTestState();
    // 把 d1 降到 qi_sense
    const master = { ...state.disciples.find(d => d.id === 'd1')!, realm: 'qi_sense' as const };
    const apprentice = state.disciples.find(d => d.id === 'd2')!;
    const check = canEstablishMastership(master, apprentice, realmDefs);
    assert.equal(check.canEstablish, false);
    assert.ok(check.blockers.some(b => b.type === 'master_realm'));
  });

  it('师徒境界差不足（<2级）：realm_gap blocker', () => {
    const state = makeTestState();
    const master = state.disciples.find(d => d.id === 'd1')!; // foundation=3
    // 把 d2 改成 qi_gather=2，差只有 1 级
    const apprentice = { ...state.disciples.find(d => d.id === 'd2')!, realm: 'qi_gather' as const };
    const check = canEstablishMastership(master, apprentice, realmDefs);
    assert.equal(check.canEstablish, false);
    assert.ok(check.blockers.some(b => b.type === 'realm_gap'));
  });

  it('徒弟已有师父：already_has_master blocker', () => {
    const state = makeTestState();
    const master = state.disciples.find(d => d.id === 'd1')!;
    const apprentice = { ...state.disciples.find(d => d.id === 'd2')!, masterId: 'other_master' };
    const check = canEstablishMastership(master, apprentice, realmDefs);
    assert.equal(check.canEstablish, false);
    assert.ok(check.blockers.some(b => b.type === 'already_has_master'));
  });

  it('师父收徒数已满（3）：max_apprentices blocker', () => {
    const state = makeTestState();
    const master = { ...state.disciples.find(d => d.id === 'd1')!, apprenticeIds: ['x', 'y', 'z'] };
    const apprentice = state.disciples.find(d => d.id === 'd2')!;
    const check = canEstablishMastership(master, apprentice, realmDefs);
    assert.equal(check.canEstablish, false);
    assert.ok(check.blockers.some(b => b.type === 'max_apprentices'));
  });

  it('不能与自己建立师徒关系：self blocker', () => {
    const state = makeTestState();
    const disc = state.disciples.find(d => d.id === 'd1')!;
    const check = canEstablishMastership(disc, disc, realmDefs);
    assert.equal(check.canEstablish, false);
    assert.ok(check.blockers.some(b => b.type === 'self'));
  });
});

// ── §6 师徒 Effect 执行器 ──

describe('§6 师徒 Effect 执行器', () => {
  it('mastership_establish: 设置 masterId 和 apprenticeIds', () => {
    const state = makeTestState();
    const { nextState } = executor.apply(state, [{
      type: 'mastership_establish',
      masterId: 'd1',
      apprenticeId: 'd2',
    }], ctx);
    const master = nextState.disciples.find(d => d.id === 'd1')!;
    const apprentice = nextState.disciples.find(d => d.id === 'd2')!;
    assert.equal(apprentice.masterId, 'd1');
    assert.ok(master.apprenticeIds?.includes('d2'));
  });

  it('mastership_establish: 不重复添加 apprenticeIds', () => {
    const state = makeTestState();
    const s1 = executor.apply(state, [{
      type: 'mastership_establish', masterId: 'd1', apprenticeId: 'd2',
    }], ctx).nextState;
    // 再次建立
    const { nextState } = executor.apply(s1, [{
      type: 'mastership_establish', masterId: 'd1', apprenticeId: 'd2',
    }], ctx);
    const master = nextState.disciples.find(d => d.id === 'd1')!;
    assert.equal(master.apprenticeIds?.filter(id => id === 'd2').length, 1);
  });

  it('mastership_dissolve: 清除师徒关系', () => {
    const state = makeTestState();
    // 先建立
    const s1 = executor.apply(state, [{
      type: 'mastership_establish', masterId: 'd1', apprenticeId: 'd2',
    }], ctx).nextState;
    // 再解除
    const { nextState } = executor.apply(s1, [{
      type: 'mastership_dissolve', masterId: 'd1', apprenticeId: 'd2',
    }], ctx);
    const master = nextState.disciples.find(d => d.id === 'd1')!;
    const apprentice = nextState.disciples.find(d => d.id === 'd2')!;
    assert.equal(apprentice.masterId, undefined);
    assert.ok(!master.apprenticeIds?.includes('d2'));
  });
});

// ── §7 突破成功率加成（masterBonus） ──

describe('§7 突破成功率加成（masterBonus）', () => {
  it('calcMasterBreakthroughBonus: 境界差 3 级 → +9%', () => {
    const state = makeTestState();
    const master = state.disciples.find(d => d.id === 'd1')!; // foundation=3
    const apprentice = state.disciples.find(d => d.id === 'd2')!; // mortal=0
    const bonus = calcMasterBreakthroughBonus(master, apprentice, realmDefs);
    // gap = 3, 3*3 = 9, clamp(0,12,9) = 9
    assert.equal(bonus, 9);
  });

  it('calcMasterBreakthroughBonus: 境界差 5 级 → 上限 +12%', () => {
    // 师父 golden_core=5，徒弟 mortal=0，gap=5，5*3=15 → clamp to 12
    const master: Disciple = {
      id: 'm', name: '宗师', stats: {}, statuses: [], trainingProgress: {},
      realm: 'golden_core' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'S' as const,
    };
    const apprentice: Disciple = {
      id: 'a', name: '新人', stats: {}, statuses: [], trainingProgress: {},
      realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'C' as const,
    };
    const bonus = calcMasterBreakthroughBonus(master, apprentice, realmDefs);
    assert.equal(bonus, 12);
  });

  it('calcBreakthroughChance: masterBonus 被纳入 total', () => {
    const state = makeTestState();
    const disc = state.disciples.find(d => d.id === 'd2')!;
    disc.masterId = 'd1'; // 设置师父

    const talent = db.talents!.talents.find(t => t.grade === 'C')!;
    const chance = calcBreakthroughChance(disc, talent, state, realmDefs);
    // base=50, talent=0, comp=floor(25/10)*3=6, will=floor(20/15)*2=2, attempt=0, master=9
    assert.equal(chance.masterBonus, 9);
    assert.equal(chance.total, 67); // 50+0+6+2-0+9 = 67
  });

  it('calcBreakthroughChance: 无师父时 masterBonus=0', () => {
    const state = makeTestState();
    const disc = state.disciples.find(d => d.id === 'd2')!;
    const talent = db.talents!.talents.find(t => t.grade === 'C')!;
    const chance = calcBreakthroughChance(disc, talent, state, realmDefs);
    assert.equal(chance.masterBonus, 0);
    assert.equal(chance.total, 58); // 50+0+6+2-0+0 = 58
  });
});

// ── §8 突破传承效果 ──

describe('§8 突破传承效果', () => {
  it('buildInheritanceEffects: 3% of master physique（下限 0，上限 3）', () => {
    const master: Disciple = {
      id: 'm', name: '宗师',
      stats: { physique: 100, comprehension: 90, willpower: 80, agility: 50, charisma: 40 },
      statuses: [], trainingProgress: [],
      realm: 'foundation' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'S' as const,
    };
    const apprentice: Disciple = {
      id: 'a', name: '新人',
      stats: { physique: 30, comprehension: 20, willpower: 15 },
      statuses: [], trainingProgress: {},
      realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'C' as const,
    };
    const effects = buildInheritanceEffects(master, apprentice);
    // physique: floor(100*0.03)=3, clamp(0,3,3)=3
    // comprehension: floor(90*0.03)=2, clamp(0,3,2)=2
    // willpower: floor(80*0.03)=2, clamp(0,3,2)=2
    const phyEffect = effects.find(e => e.type === 'disciple_stat_delta' && e.discipleId === 'a' && e.statId === 'physique');
    assert.ok(phyEffect?.type === 'disciple_stat_delta');
    assert.equal(phyEffect?.delta, 3);
    assert.equal(effects.length, 3); // 3 stats with bonus > 0
  });

  it('buildInheritanceEffects: master 属性很低时不生成 effect', () => {
    const master: Disciple = {
      id: 'm', name: '宗师',
      stats: { physique: 20, comprehension: 20, willpower: 20 }, // floor(20*0.03)=0 → skip
      statuses: [], trainingProgress: {},
      realm: 'foundation' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'C' as const,
    };
    const apprentice: Disciple = {
      id: 'a', name: '新人', stats: {},
      statuses: [], trainingProgress: {},
      realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'C' as const,
    };
    const effects = buildInheritanceEffects(master, apprentice);
    assert.equal(effects.length, 0);
  });
});

// ── §9 TurnEngine 集成 ──

describe('§9 TurnEngine 集成', () => {
  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());

  it('startMartialLearning PlayerOp: 弟子开始学习', () => {
    const state = makeTestState();
    const { nextState } = engine.executeTurn(state, db, {
      startMartialLearning: [{ discipleId: 'd2', artId: 'test_basic', source: 'self' }],
    });
    const d = nextState.disciples.find(x => x.id === 'd2')!;
    assert.ok(d.martialLearning, '应有 martialLearning 状态');
    assert.equal(d.martialLearning?.martialId, 'test_basic');
  });

  it('cancelMartialLearning PlayerOp: 取消学习', () => {
    const state = makeTestState();
    // 先开始学习
    const s1 = engine.executeTurn(state, db, {
      startMartialLearning: [{ discipleId: 'd2', artId: 'test_basic', source: 'self' }],
    }).nextState;
    assert.ok(s1.disciples.find(d => d.id === 'd2')?.martialLearning, '第1回合应开始学习');
    // 取消学习
    const { nextState } = engine.executeTurn(s1, db, {
      cancelMartialLearning: [{ discipleId: 'd2' }],
    });
    const d = nextState.disciples.find(x => x.id === 'd2')!;
    assert.equal(d.martialLearning, undefined);
  });

  it('2月内完成 test_basic 学习（learnCost.months=2）', () => {
    const state = makeTestState();
    // 第1月：开始学习
    const s1 = engine.executeTurn(state, db, {
      startMartialLearning: [{ discipleId: 'd2', artId: 'test_basic', source: 'self' }],
    }).nextState;
    // 第2月：月度成长推进到 progressMonths=1，targetMonths=2 → 完成
    const { nextState: s2 } = engine.executeTurn(s1, db, {});
    const d2 = s2.disciples.find(x => x.id === 'd2')!;
    assert.equal(d2.martialLearning, undefined, '学习应在第2月完成');
    assert.ok(d2.knownArts?.includes('test_basic'), '应加入 knownArts');
  });

  it('establishMastership PlayerOp: 建立师徒关系', () => {
    const state = makeTestState();
    const { nextState } = engine.executeTurn(state, db, {
      establishMastership: [{ masterId: 'd1', apprenticeId: 'd2' }],
    });
    const master = nextState.disciples.find(d => d.id === 'd1')!;
    const apprentice = nextState.disciples.find(d => d.id === 'd2')!;
    assert.equal(apprentice.masterId, 'd1');
    assert.ok(master.apprenticeIds?.includes('d2'));
  });

  it('dissolveMastership PlayerOp: 解除师徒关系', () => {
    const state = makeTestState();
    const s1 = engine.executeTurn(state, db, {
      establishMastership: [{ masterId: 'd1', apprenticeId: 'd2' }],
    }).nextState;
    const { nextState } = engine.executeTurn(s1, db, {
      dissolveMastership: [{ masterId: 'd1', apprenticeId: 'd2' }],
    });
    const apprentice = nextState.disciples.find(d => d.id === 'd2')!;
    assert.equal(apprentice.masterId, undefined);
  });

  it('师徒关系不合法时 establish 被忽略（境界差不足）', () => {
    const state = makeTestState();
    // d2(mortal=0) 试图收 d1(foundation=3) 为徒 → 应被拒（d2 是师父，d1 是徒弟，但 d2 境界太低）
    const { nextState } = engine.executeTurn(state, db, {
      establishMastership: [{ masterId: 'd2', apprenticeId: 'd1' }],
    });
    const d1 = nextState.disciples.find(d => d.id === 'd1')!;
    assert.equal(d1.masterId, undefined, '不合法的师徒关系应被忽略');
  });

  it('旧存档弟子（无 martialLearning/knownArts/masterId）运行12月安全', () => {
    const state = makeTestState();
    // 确保没有任何 v1.5 字段
    for (const d of state.disciples) {
      delete (d as Record<string, unknown>)['martialLearning'];
      delete (d as Record<string, unknown>)['knownArts'];
      delete (d as Record<string, unknown>)['masterId'];
      delete (d as Record<string, unknown>)['apprenticeIds'];
    }
    let current = state;
    for (let i = 0; i < 12; i++) {
      current = engine.executeTurn(current, db, {}).nextState;
    }
    assert.equal(current.monthIndex, 12);
  });
});
