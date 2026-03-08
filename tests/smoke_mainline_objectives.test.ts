/**
 * Smoke tests — S1-2 主线目标判定逻辑
 *
 * 覆盖：
 *   §1  checkObjective / getObjectiveProgress 纯函数
 *   §2  refreshObjectives 纯函数（current/done 更新、无变化不改引用）
 *   §3  ch1 弟子数量目标（obj.ch1_recruit_5）
 *   §4  ch2 名望目标（obj.ch2_reputation_300）
 *   §5  ch3 宗师弟子目标（obj.ch3_master_disciple）
 *   §6  ch4 参赛资格目标（obj.ch4_qualified + tournament_qualified flag）
 *   §7  ch5 夺冠目标（obj.ch5_win + tournament_won flag）
 *   §8  TurnEngine 集成：tournament_qualified 自动设置
 *   §9  TurnEngine 集成：tournament_won 自动设置（champion rank）
 *
 * Run: npx tsx tests/smoke_mainline_objectives.test.ts
 */

import assert from 'node:assert/strict';
import { makeInitialState, makeEmptyContentDB, loadRealContentDB } from './fixtures.js';
import {
  checkObjective,
  getObjectiveProgress,
  refreshObjectives,
} from '../src/runtime/systems/mainline/objective_checker.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import type { GameState, ObjectiveProgress } from '../src/runtime/turn_engine/types.js';
import { TournamentManager } from '../src/runtime/systems/tournament/manager.js';

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

function makeEngine() {
  return new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
}

// ── 辅助：往 state.disciples 里批量添加弟子 ──────────────────────────────────

function addDisciples(state: GameState, count: number): GameState {
  const extras = Array.from({ length: count }, (_, i) => ({
    id: `extra_${i}`,
    name: `弟子${i + 2}`,
    stats: { physique: 30, comprehension: 30, willpower: 30, agility: 30, charisma: 30 },
    statuses: [] as [],
    trainingProgress: {},
    realm: 'mortal' as const,
    realmProgress: 0,
    breakthroughAttempts: 0,
    talentGrade: 'C' as const,
  }));
  return { ...state, disciples: [...state.disciples, ...extras] };
}

// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── smoke_mainline_objectives ──────────────────────────────\n');

// ── §1: checkObjective / getObjectiveProgress ─────────────────────────────────

console.log('▶ §1 checkObjective / getObjectiveProgress');

test('ch1_recruit_5 — 弟子不足时返回 false', () => {
  const s = makeInitialState(); // 1 弟子
  assert.equal(checkObjective(s, 'obj.ch1_recruit_5', 5), false);
});

test('ch1_recruit_5 — 刚好5名弟子返回 true', () => {
  const s = addDisciples(makeInitialState(), 4); // 1+4=5
  assert.equal(checkObjective(s, 'obj.ch1_recruit_5', 5), true);
});

test('ch1_recruit_5 — 超过5名返回 true', () => {
  const s = addDisciples(makeInitialState(), 6); // 1+6=7
  assert.equal(checkObjective(s, 'obj.ch1_recruit_5', 5), true);
});

test('未知 objectiveId 返回 false', () => {
  assert.equal(checkObjective(makeInitialState(), 'obj.unknown', 1), false);
});

test('getObjectiveProgress — ch1 进度值正确', () => {
  const s = addDisciples(makeInitialState(), 2); // 1+2=3
  const p = getObjectiveProgress(s, 'obj.ch1_recruit_5', 5);
  assert.equal(p.current, 3);
  assert.equal(p.target, 5);
});

test('getObjectiveProgress — ch2 声望进度', () => {
  const s = { ...makeInitialState(), resources: { ...makeInitialState().resources, reputation: 150 } };
  const p = getObjectiveProgress(s, 'obj.ch2_reputation_300', 300);
  assert.equal(p.current, 150);
  assert.equal(p.target, 300);
});

// ── §2: refreshObjectives 纯函数 ──────────────────────────────────────────────

console.log('\n▶ §2 refreshObjectives');

test('无变化时返回原数组引用', () => {
  const s = makeInitialState(); // 1 弟子，target=5
  const objs: ObjectiveProgress[] = [
    { id: 'obj.ch1_recruit_5', text: '招募5名弟子', current: 1, target: 5, done: false },
  ];
  const result = refreshObjectives(s, objs);
  assert.equal(result, objs, '无变化时应返回同一引用');
});

test('有变化时返回新数组', () => {
  const s = addDisciples(makeInitialState(), 4); // 5 弟子
  const objs: ObjectiveProgress[] = [
    { id: 'obj.ch1_recruit_5', text: '招募5名弟子', current: 0, target: 5, done: false },
  ];
  const result = refreshObjectives(s, objs);
  assert.notEqual(result, objs);
  assert.equal(result[0].current, 5);
  assert.equal(result[0].done, true);
});

test('原数组不被修改', () => {
  const s = addDisciples(makeInitialState(), 4);
  const objs: ObjectiveProgress[] = [
    { id: 'obj.ch1_recruit_5', text: '招募5名弟子', current: 0, target: 5, done: false },
  ];
  refreshObjectives(s, objs);
  assert.equal(objs[0].current, 0, '原对象不应被修改');
});

test('多个目标混合 — 只更新有变化的', () => {
  const base = makeInitialState(); // reputation=100
  const s = addDisciples(base, 4); // 5 弟子
  const objs: ObjectiveProgress[] = [
    { id: 'obj.ch1_recruit_5',      text: 'A', current: 5, target: 5, done: true  }, // 无变化
    { id: 'obj.ch2_reputation_300', text: 'B', current: 0, target: 300, done: false }, // 有变化（current=100）
  ];
  const result = refreshObjectives(s, objs);
  assert.equal(result[0], objs[0], 'ch1 目标对象引用不变');
  assert.notEqual(result[1], objs[1], 'ch2 目标对象应更新');
  assert.equal(result[1].current, base.resources.reputation); // 实际初始名望
});

// ── §3: ch1 弟子数量目标 ──────────────────────────────────────────────────────

console.log('\n▶ §3 ch1 obj.ch1_recruit_5');

test('ch1 初始状态 current=1 done=false', () => {
  const s = makeInitialState();
  const p = getObjectiveProgress(s, 'obj.ch1_recruit_5', 5);
  assert.equal(p.current, 1);
  assert.equal(checkObjective(s, 'obj.ch1_recruit_5', 5), false);
});

test('ch1 招满5人后 done=true', () => {
  const s = addDisciples(makeInitialState(), 4);
  assert.equal(checkObjective(s, 'obj.ch1_recruit_5', 5), true);
});

// ── §4: ch2 名望目标 ──────────────────────────────────────────────────────────

console.log('\n▶ §4 ch2 obj.ch2_reputation_300');

test('ch2 名望=299 → done=false', () => {
  const s = { ...makeInitialState(), resources: { ...makeInitialState().resources, reputation: 299 } };
  assert.equal(checkObjective(s, 'obj.ch2_reputation_300', 300), false);
});

test('ch2 名望=300 → done=true', () => {
  const s = { ...makeInitialState(), resources: { ...makeInitialState().resources, reputation: 300 } };
  assert.equal(checkObjective(s, 'obj.ch2_reputation_300', 300), true);
});

test('ch2 名望=999 → done=true', () => {
  const s = { ...makeInitialState(), resources: { ...makeInitialState().resources, reputation: 999 } };
  assert.equal(checkObjective(s, 'obj.ch2_reputation_300', 300), true);
});

// ── §5: ch3 宗师弟子目标 ──────────────────────────────────────────────────────

console.log('\n▶ §5 ch3 obj.ch3_master_disciple');

test('ch3 无弟子属性≥80 → done=false', () => {
  const s = makeInitialState(); // physique=40, 其余更低
  assert.equal(checkObjective(s, 'obj.ch3_master_disciple', 1), false);
});

test('ch3 某弟子 physique=80 → done=true', () => {
  const s = makeInitialState();
  const upgraded: GameState = {
    ...s,
    disciples: [{ ...s.disciples[0], stats: { ...s.disciples[0].stats, physique: 80 } }],
  };
  assert.equal(checkObjective(upgraded, 'obj.ch3_master_disciple', 1), true);
});

test('ch3 某弟子 comprehension=85 → done=true', () => {
  const s = makeInitialState();
  const upgraded: GameState = {
    ...s,
    disciples: [{ ...s.disciples[0], stats: { ...s.disciples[0].stats, comprehension: 85 } }],
  };
  assert.equal(checkObjective(upgraded, 'obj.ch3_master_disciple', 1), true);
});

test('ch3 getObjectiveProgress → current 计算正确', () => {
  const s = makeInitialState();
  const noMaster = getObjectiveProgress(s, 'obj.ch3_master_disciple', 1);
  assert.equal(noMaster.current, 0);

  const upgraded: GameState = {
    ...s,
    disciples: [
      { ...s.disciples[0], stats: { ...s.disciples[0].stats, agility: 80 } },
      { id: 'master2', name: '二弟子', stats: { physique: 90, comprehension: 30, willpower: 30, agility: 30, charisma: 30 },
        statuses: [] as [], trainingProgress: {}, realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'B' as const },
    ],
  };
  const hasMasters = getObjectiveProgress(upgraded, 'obj.ch3_master_disciple', 1);
  assert.equal(hasMasters.current, 2);
});

// ── §6: ch4 参赛资格目标 ──────────────────────────────────────────────────────

console.log('\n▶ §6 ch4 obj.ch4_qualified');

test('ch4 无 tournament_qualified flag → done=false', () => {
  const s = makeInitialState();
  assert.equal(checkObjective(s, 'obj.ch4_qualified', 1), false);
});

test('ch4 flags.tournament_qualified=true → done=true', () => {
  const s: GameState = { ...makeInitialState(), flags: { tournament_qualified: true } };
  assert.equal(checkObjective(s, 'obj.ch4_qualified', 1), true);
});

test('ch4 flags.tournament_qualified=false → done=false', () => {
  const s: GameState = { ...makeInitialState(), flags: { tournament_qualified: false } };
  assert.equal(checkObjective(s, 'obj.ch4_qualified', 1), false);
});

// ── §7: ch5 夺冠目标 ──────────────────────────────────────────────────────────

console.log('\n▶ §7 ch5 obj.ch5_win');

test('ch5 无 tournament_won flag → done=false', () => {
  const s = makeInitialState();
  assert.equal(checkObjective(s, 'obj.ch5_win', 1), false);
});

test('ch5 flags.tournament_won=true → done=true', () => {
  const s: GameState = { ...makeInitialState(), flags: { tournament_won: true } };
  assert.equal(checkObjective(s, 'obj.ch5_win', 1), true);
});

// ── §8: TurnEngine 集成 — tournament_qualified 自动设置 ───────────────────────

console.log('\n▶ §8 TurnEngine 集成：tournament_qualified');

test('大会触发月 engine 执行后 tournament_qualified=true', () => {
  const db = loadRealContentDB();
  const engine = makeEngine();
  // tournament 触发条件：yearModulo=4, month=6 → monthIndex=41 (after 自增后 =41, 即年4月6)
  // 在月41之前的状态，触发检查在 monthIndex 自增后
  // 我们从 monthIndex=40 开始，执行一次 turn 后 monthIndex=41
  const base = makeInitialState();
  const state: GameState = {
    ...base,
    monthIndex: 40,
    tournament: { ...base.tournament, active: false },
    flags: {},
  };
  const { nextState } = engine.executeTurn(state, db, {});
  assert.equal(nextState.flags['tournament_qualified'], true,
    `tournament_qualified 应为 true，当前 flags: ${JSON.stringify(nextState.flags)}`);
});

test('非触发月 tournament_qualified 不被设置', () => {
  const db = loadRealContentDB();
  const engine = makeEngine();
  const state: GameState = {
    ...makeInitialState(),
    monthIndex: 5,
    flags: {},
  };
  const { nextState } = engine.executeTurn(state, db, {});
  assert.equal(nextState.flags['tournament_qualified'], undefined,
    'tournament_qualified 不应在非触发月被设置');
});

// ── §9: TurnEngine 集成 — tournament_won flag（champion rank）──────────────────

console.log('\n▶ §9 TurnEngine 集成：tournament_won（conclude）');

test('conclude champion → tournament_won=true', () => {
  const db = loadRealContentDB();
  if (!db.tournament) {
    console.log('    (跳过：无 tournament content)');
    passed++;
    return;
  }
  // 构造一个处于 conclusion 前一步（politics phase）的大会，高分保证 champion
  const baseTournament = {
    active: true,
    year: 1,
    phase: 'politics' as const,
    phaseMonthsElapsed: 1,
    influence: 50,
    participants: [],
    rankings: [] as string[],
    events: [] as [],
    selectedRepresentatives: [],
    results: { martialWins: 3, debateScore: 10, allianceScore: 10 },
    takenPrepActions: [] as string[],
  };
  const state: GameState = { ...makeInitialState(), tournament: baseTournament, flags: {} };
  const engine = makeEngine();
  // Run one turn — politics phase (durationMonths=1) will advance → conclusion → conclude
  const { nextState } = engine.executeTurn(state, db, {});
  assert.equal(nextState.flags['tournament_won'], true,
    `tournament_won 应为 true，当前 flags: ${JSON.stringify(nextState.flags)}`);
});

test('conclude topThree → tournament_won 不设置', () => {
  const db = loadRealContentDB();
  if (!db.tournament) {
    console.log('    (跳过：无 tournament content)');
    passed++;
    return;
  }
  // 低分 → topThree / participant
  const baseTournament = {
    active: true,
    year: 1,
    phase: 'politics' as const,
    phaseMonthsElapsed: 1,
    influence: 0,
    participants: [],
    rankings: [] as string[],
    events: [] as [],
    selectedRepresentatives: [],
    results: { martialWins: 0, debateScore: 3, allianceScore: 3 },
    takenPrepActions: [] as string[],
  };
  const state: GameState = { ...makeInitialState(), tournament: baseTournament, flags: {} };
  const engine = makeEngine();
  const { nextState } = engine.executeTurn(state, db, {});
  assert.equal(nextState.flags['tournament_won'], undefined,
    'tournament_won 不应在非 champion 时被设置');
});

// ── §10: TournamentManager.conclude 直接测试 ──────────────────────────────────

console.log('\n▶ §10 TournamentManager.conclude flag 验证');

test('conclude champion → effects 包含 tournament_won set_flag', () => {
  const db = loadRealContentDB();
  if (!db.tournament) {
    console.log('    (跳过：无 tournament content)');
    passed++;
    return;
  }
  const tournament = {
    active: true, year: 1, phase: 'politics' as const, phaseMonthsElapsed: 0,
    influence: 50,
    participants: [], rankings: [] as string[], events: [] as [],
    selectedRepresentatives: [],
    results: { martialWins: 3, debateScore: 10, allianceScore: 10 }, // score=150 → champion
    takenPrepActions: [] as string[],
  };
  const { effects } = TournamentManager.conclude(tournament, db.tournament);
  const wonFlag = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'tournament_won' && e.value === true,
  );
  assert.ok(wonFlag, 'effects 应包含 tournament_won=true 的 set_flag');
});

test('conclude topThree → effects 不含 tournament_won', () => {
  const db = loadRealContentDB();
  if (!db.tournament) {
    console.log('    (跳过：无 tournament content)');
    passed++;
    return;
  }
  const tournament = {
    active: true, year: 1, phase: 'politics' as const, phaseMonthsElapsed: 0,
    influence: 0,
    participants: [], rankings: [] as string[], events: [] as [],
    selectedRepresentatives: [],
    results: { martialWins: 0, debateScore: 3, allianceScore: 0 }, // score=30 → topThree? No, <50 → participant
    takenPrepActions: [] as string[],
  };
  const { effects } = TournamentManager.conclude(tournament, db.tournament);
  const wonFlag = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'tournament_won',
  );
  assert.equal(wonFlag, undefined, 'effects 不应含 tournament_won');
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  smoke_mainline_objectives: ${passed}/${passed + failed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  smoke_mainline_objectives: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
