/**
 * Smoke tests — 完整游戏流程集成测试 (Phase 5.1 + 5.2)
 *
 * 覆盖：
 *   5.1 — 48个月端到端流程（武林大会触发/结算、势力变化）
 *   5.2 — 边界情况（存档读档序列化、势力极限±100、状态一致性）
 *
 * Run: npx tsx tests/smoke_integration.test.ts
 */

import assert from 'node:assert/strict';
import { fastForward, summarizeSimulation } from '../src/runtime/debug/fast_forward.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { GameState } from '../src/runtime/turn_engine/types.js';

function makeEngine() {
  return new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      }).catch((e: unknown) => {
        console.error(`  ✗ ${name}`);
        console.error(`    ${(e as Error).message}`);
        failed++;
      });
    } else {
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(e as Error).message}`);
    failed++;
  }
}

console.log('\n── smoke_integration ───────────────────────────────────\n');

// ─────────────────────────────────────────────────────────────────────────────
// §5.1 完整游戏流程 (48个月 = 4年)
// ─────────────────────────────────────────────────────────────────────────────

test('48个月无崩溃：0→48月完整流程', () => {
  const db  = makeEmptyContentDB();
  const s0  = makeInitialState();
  const { finalState, reports } = fastForward(s0, db, 48);
  assert.equal(finalState.monthIndex, 48, 'monthIndex 应等于48');
  assert.equal(reports.length, 48, '应有48份结算报告');
});

test('yearIndex 与 monthIndex 始终一致', () => {
  const db = makeEmptyContentDB();
  const { reports } = fastForward(makeInitialState(), db, 48);
  for (const r of reports) {
    const expected = Math.floor(r.monthIndex / 12);
    assert.equal(r.yearIndex, expected,
      `月份${r.monthIndex}: yearIndex应为${expected}，实际${r.yearIndex}`);
  }
});

test('每份报告都有 net / flagsChanged / annualChainLog 字段', () => {
  const db = makeEmptyContentDB();
  const { reports } = fastForward(makeInitialState(), db, 48);
  for (const r of reports) {
    assert.ok(r.net !== undefined, `月份${r.monthIndex}: 缺少 net`);
    assert.ok(Array.isArray(r.flagsChanged), `月份${r.monthIndex}: flagsChanged 不是数组`);
    assert.ok(Array.isArray(r.annualChainLog), `月份${r.monthIndex}: annualChainLog 不是数组`);
  }
});

test('武林大会在第41月触发（4年第6月）', () => {
  const db  = makeEmptyContentDB();
  // 快进40个月，此时 monthIndex=40（tournament还未触发）
  const { finalState: s40 } = fastForward(makeInitialState(), db, 40);
  assert.equal(s40.tournament?.active, false, '第40月不应有活跃大会');

  // 再走1步：monthIndex变为41，大会触发
  const engine = makeEngine();
  const { nextState: s41 } = engine.executeTurn(s40, db, {});
  assert.equal(s41.monthIndex, 41);
  assert.equal(s41.tournament?.active, true, '第41月应触发武林大会');
  assert.equal(s41.tournament?.phase, 'announcement', '应从 announcement 阶段开始');
});

test('武林大会阶段按序推进：announcement→gathering→martial→debate→politics→conclusion', () => {
  const db  = makeEmptyContentDB();
  const engine = makeEngine();

  // 到达触发月（monthIndex=40）
  const { finalState: s40 } = fastForward(makeInitialState(), db, 40);

  // 记录每月的阶段
  const phases: string[] = [];
  let state = s40;
  for (let i = 0; i < 7; i++) {
    const { nextState } = engine.executeTurn(state, db, {});
    state = nextState;
    if (state.tournament) {
      phases.push(state.tournament.phase);
    }
  }

  // 阶段序列应包含完整的推进路径
  // 第41月：announcement→gathering（0duration立即推进）
  // 第42月：gathering→martial（1duration，elapsed=0+1≥1）
  // 第43月：martial→debate
  // 第44月：debate→politics
  // 第45月：politics→conclusion → conclude() called → active=false
  assert.ok(phases.includes('gathering'),  '应经历 gathering 阶段');
  assert.ok(phases.includes('martial'),    '应经历 martial 阶段');
  assert.ok(phases.includes('debate'),     '应经历 debate 阶段');
  assert.ok(phases.includes('politics'),   '应经历 politics 阶段');
  assert.ok(phases.includes('conclusion'), '应出现 conclusion 阶段');
});

test('武林大会在第46月结算并关闭', () => {
  const db  = makeEmptyContentDB();
  // 快进46个月：0→46；大会触发于41，结算于46
  const { finalState } = fastForward(makeInitialState(), db, 46);
  assert.equal(finalState.monthIndex, 46);
  assert.equal(finalState.tournament?.active, false, '大会应已结算');
  assert.equal(finalState.tournament?.phase, 'conclusion', '最终阶段应为 conclusion');
});

test('大会结算后声望显著提升', () => {
  const db  = makeEmptyContentDB();
  const { finalState } = fastForward(makeInitialState(), db, 46);
  const initial = makeInitialState().resources.reputation;
  assert.ok(
    finalState.resources.reputation > initial,
    `声望应有提升：初始${initial}，当前${finalState.resources.reputation}`,
  );
});

test('4年周期内武林大会不重复触发', () => {
  const db  = makeEmptyContentDB();
  const { finalState } = fastForward(makeInitialState(), db, 48);
  // 第46月结算，第47-48月不应重新触发
  assert.equal(finalState.tournament?.active, false, '48月末大会不应再次活跃');
});

test('48月模拟摘要统计正常', () => {
  const db  = makeEmptyContentDB();
  const result = fastForward(makeInitialState(), db, 48);
  const summary = summarizeSimulation(result);
  assert.equal(summary.months, 48);
  assert.ok(typeof summary.finalResources.silver === 'number');
  assert.ok(typeof summary.finalResources.reputation === 'number');
  // 大会 set_flag 应在 flagsAtEnd 中出现（participant 不会设，但 topThree/champion 会设）
  // 无论如何不崩溃
  assert.ok(summary.netResourcesOverall !== undefined);
});

test('输入状态不被突变（immutability 保证）', () => {
  const db  = makeEmptyContentDB();
  const s0  = makeInitialState();
  const snap = s0.monthIndex;
  fastForward(s0, db, 10);
  assert.equal(s0.monthIndex, snap, '原始状态 monthIndex 不应被修改');
});

// ─────────────────────────────────────────────────────────────────────────────
// §5.2 边界情况
// ─────────────────────────────────────────────────────────────────────────────

// ── 5.2-A: 大会期间存档 / 读档 ──

test('大会进行中 JSON 序列化/反序列化后可继续运行', () => {
  const db  = makeEmptyContentDB();
  // 快进到大会触发后（monthIndex=43，处于 martial 阶段）
  const { finalState: s43 } = fastForward(makeInitialState(), db, 43);
  assert.equal(s43.tournament?.active, true, '此时大会应活跃');

  // 模拟存档：JSON 往返
  const serialized = JSON.stringify(s43);
  const deserialized = JSON.parse(serialized) as GameState;

  // 从读档状态继续运行剩余月份直到大会结束
  const { finalState } = fastForward(deserialized, db, 5); // 43+5=48
  assert.equal(finalState.monthIndex, 48, '读档后应能继续运行到48月');
  assert.equal(finalState.tournament?.active, false, '大会应在读档后正常结算');
});

test('大会期间存档再读档后声望变化与直接运行一致（确定性）', () => {
  const db   = makeEmptyContentDB();
  const seed = 100;
  const s0   = makeInitialState(seed);

  // 路径A：直接运行48月
  const { finalState: directResult } = fastForward(s0, db, 48, seed);

  // 路径B：运行43月后存档，再读档运行5月
  const { finalState: s43 } = fastForward(makeInitialState(seed), db, 43, seed);
  const loaded = JSON.parse(JSON.stringify(s43)) as GameState;
  const { finalState: loadedResult } = fastForward(loaded, db, 5);

  // 声望结果应一致（相同的 RNG seed，相同的决策路径）
  assert.equal(
    directResult.resources.reputation,
    loadedResult.resources.reputation,
    `声望应一致：直接路径=${directResult.resources.reputation}，存读档路径=${loadedResult.resources.reputation}`,
  );
});

test('旧存档（无 tournament 字段）读档后安全运行', () => {
  const db  = makeEmptyContentDB();
  const s0  = makeInitialState();
  // 模拟旧存档：去掉 tournament 字段
  const oldSave = { ...s0 } as Partial<GameState>;
  delete (oldSave as Record<string, unknown>)['tournament'];
  const restored = oldSave as GameState;

  // 引擎应能处理 tournament=undefined 并在合适月份触发
  const { finalState } = fastForward(restored, db, 48);
  assert.equal(finalState.monthIndex, 48, '旧存档应能完整运行48月');
});

// ── 5.2-B: 势力值极限 ±100 ──

test('势力值不超过上限 +100', () => {
  const db      = makeEmptyContentDB();
  const executor = new EffectExecutor();
  const s0      = makeInitialState();
  // 先把势力关系设为90
  s0.factions['faction.test'] = 90;
  // 施加 +50 → 应钳制在100
  const result = executor.apply(s0, [{
    type: 'faction_relation_delta',
    factionId: 'faction.test',
    delta: 50,
  }], { source: { kind: 'system', id: 'pre' } });
  assert.equal(result.nextState.factions['faction.test'], 100, '势力值应钳制在100');
});

test('势力值不低于下限 -100', () => {
  const db       = makeEmptyContentDB();
  const executor = new EffectExecutor();
  const s0       = makeInitialState();
  s0.factions['faction.evil'] = -90;
  // 施加 -50 → 应钳制在-100
  const result = executor.apply(s0, [{
    type: 'faction_relation_delta',
    factionId: 'faction.evil',
    delta: -50,
  }], { source: { kind: 'system', id: 'pre' } });
  assert.equal(result.nextState.factions['faction.evil'], -100, '势力值应钳制在-100');
});

test('势力值极限下多次施加仍保持边界', () => {
  const executor = new EffectExecutor();
  const s0       = makeInitialState();
  s0.factions['faction.x'] = 100;
  let state = s0;
  // 连续施加10次+100，始终保持100
  for (let i = 0; i < 10; i++) {
    const r = executor.apply(state, [{
      type: 'faction_relation_delta',
      factionId: 'faction.x',
      delta: 100,
    }], { source: { kind: 'system', id: 'pre' } });
    state = r.nextState;
    assert.equal(state.factions['faction.x'], 100, `第${i+1}次施加后应仍为100`);
  }
});

// ── 5.2-C: 状态一致性检查 ──

test('结算报告 monthIndex 与结果 state.monthIndex 一致', () => {
  const db = makeEmptyContentDB();
  const engine = makeEngine();
  let state = makeInitialState();
  for (let i = 0; i < 48; i++) {
    const { nextState, report } = engine.executeTurn(state, db, {});
    assert.equal(report.monthIndex, nextState.monthIndex,
      `月份${i+1}: 报告monthIndex(${report.monthIndex})应与state(${nextState.monthIndex})一致`);
    state = nextState;
  }
});

test('tournament.results 各分项始终非负', () => {
  const db = makeEmptyContentDB();
  const { finalState } = fastForward(makeInitialState(), db, 48);
  const t = finalState.tournament;
  if (t) {
    assert.ok(t.results.martialWins   >= 0, `martialWins不应为负: ${t.results.martialWins}`);
    assert.ok(t.results.debateScore   >= 0, `debateScore不应为负: ${t.results.debateScore}`);
    assert.ok(t.results.allianceScore >= 0, `allianceScore不应为负: ${t.results.allianceScore}`);
  }
});

test('大会结算 flag 出现在 flagsChanged 日志中（champion时）', () => {
  const db     = makeEmptyContentDB();
  const engine = makeEngine();

  // 手动构造处于 politics 阶段（下一月即会结算）的大会状态
  // 并预先设置 martial/debate 高分，使总分 ≥150 → champion
  const s0 = makeInitialState();
  s0.monthIndex = 45;
  s0.yearIndex  = 3;
  s0.resources.reputation = 500; // 确保 politics 得分 = min(10,floor(500/50))=10
  s0.tournament = {
    active: true, year: 1, phase: 'politics', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [], // politics 不需要代表
    results: {
      martialWins: 5,   // 5×20=100
      debateScore: 10,  // 10×10=100
      allianceScore: 0, // 由 advancePhase 填入
    },
  };

  // 执行一步：politics(elapsed=0+1≥1) → conclusion → conclude()
  // 总分 = 100 + 100 + 10×10 = 300 ≥ 150 → champion
  const { nextState, report } = engine.executeTurn(s0, db, {});
  assert.equal(nextState.tournament?.active, false, '大会应已结算');

  const championFlag = report.flagsChanged.find(f => f.key.startsWith('tournament_champion_'));
  assert.ok(
    championFlag !== undefined,
    `应有武林大会冠军 flag，实际 flagsChanged: [${report.flagsChanged.map(f => f.key).join(', ')}]`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────────────

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
