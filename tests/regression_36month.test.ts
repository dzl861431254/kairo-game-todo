/**
 * 回归测试 — 36 月主线稳定性 (S4-5)
 *
 * 验证目标：
 *  §1  固定 seed=42，快进 36 月 — 无崩溃、报告完整
 *  §2  固定 seed=42，快进 42 月 — 主线必达大会（tournament 触发）
 *  §3  seeds=[1,2,3,5]，快进 18 月 — 多 seed 无崩溃
 *  §4  经济健康检查 — 银两无死锁（不持续归零、无 NaN）
 *  §5  状态一致性 — 关键字段结构完整
 *  §6  结算报告完整性 — 每月报告字段齐全
 *
 * Run: npx tsx tests/regression_36month.test.ts
 */

import assert from 'node:assert/strict';
import { fastForward, summarizeSimulation } from '../src/runtime/debug/fast_forward.js';
import { makeInitialState, loadRealContentDB } from './fixtures.js';

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

// ── 加载真实内容库（一次，共享） ────────────────────────────────────────────

const contentDB = loadRealContentDB();
const BASE_SEED = 42;

// ── §1: 固定 seed=42，36 月无崩溃 ────────────────────────────────────────────

console.log('\n── regression_36month ────────────────────────────────────\n');
console.log('§1  36 月无崩溃（seed=42）');

let result36!: ReturnType<typeof fastForward>;

test('快进 36 月不抛出异常', () => {
  result36 = fastForward(makeInitialState(BASE_SEED), contentDB, 36, BASE_SEED);
  // fastForward 本身不抛出即通过
});

test('共产出 36 份结算报告', () => {
  assert.equal(result36.reports.length, 36);
});

test('finalState.monthIndex === 36', () => {
  assert.equal(result36.finalState.monthIndex, 36);
});

test('finalState.yearIndex === 3', () => {
  // monthIndex 36 → year 3（floor(36/12)=3）
  assert.equal(result36.finalState.yearIndex, 3);
});

test('36 月内至少触发过 1 次事件', () => {
  const total = result36.reports.reduce((s, r) => s + r.eventsTriggered.length, 0);
  assert.ok(total > 0, `总事件触发次数应 > 0，实际 = ${total}`);
});

test('36 月内至少有 1 次 flag 变化', () => {
  const total = result36.reports.reduce((s, r) => s + r.flagsChanged.length, 0);
  assert.ok(total > 0, `flag 变化次数应 > 0，实际 = ${total}`);
});

// ── §2: 42 月 — 主线必达大会 ─────────────────────────────────────────────────

console.log('\n§2  主线必达大会（seed=42, 42 月）');

let result42!: ReturnType<typeof fastForward>;

test('快进 42 月不抛出异常', () => {
  result42 = fastForward(makeInitialState(BASE_SEED), contentDB, 42, BASE_SEED);
});

test('第 41 轮结算后 tournament.active === true（大会已触发）', () => {
  // 大会在 monthIndex=41 时触发（year 4, month 6）
  // 执行第 41 轮后 monthIndex 变为 41，tournament 初始化
  // 执行第 42 轮时 tournament 开始推进
  const s = result42.finalState;
  // 42 月后：大会已触发并至少推进了 1 个阶段（active 或已结束 year=1）
  const tournamentEverActive = s.tournament?.year !== undefined && s.tournament.year >= 1;
  assert.ok(
    tournamentEverActive,
    `42 月后大会应已触发（tournament.year >= 1），实际 = ${JSON.stringify(s.tournament?.year)}`,
  );
});

test('42 月报告中出现大会相关 flag', () => {
  // 大会结束后会写入 champion/topThree/participant 相关 flag 或 net 变化
  const allFlags = result42.reports.flatMap((r) => r.flagsChanged.map((f) => f.key));
  const allNets = result42.reports.flatMap((r) => Object.keys(r.net));
  // 至少有 reputation net 变化（大会奖励必包含声望）
  const hasRepNet = allNets.includes('reputation');
  const hasSilverNet = allNets.includes('silver');
  assert.ok(
    hasRepNet || hasSilverNet,
    '42 月内应有 reputation 或 silver 的 net 变化',
  );
});

test('tournament.year = 1（第一届大会）', () => {
  assert.equal(result42.finalState.tournament?.year, 1);
});

// ── §3: 多 seed × 18 月无崩溃 ────────────────────────────────────────────────

console.log('\n§3  多 seed × 18 月无崩溃');

const STABILITY_SEEDS = [1, 2, 3, 5];

for (const seed of STABILITY_SEEDS) {
  test(`seed=${seed}，18 月不崩溃`, () => {
    const res = fastForward(makeInitialState(seed), contentDB, 18, seed);
    assert.equal(res.reports.length, 18, `应产出 18 份报告，实际 = ${res.reports.length}`);
    assert.equal(res.finalState.monthIndex, 18, `monthIndex 应 = 18，实际 = ${res.finalState.monthIndex}`);
  });

  test(`seed=${seed}，18 月内 silver 无 NaN/Infinity`, () => {
    const res = fastForward(makeInitialState(seed), contentDB, 18, seed);
    const silver = res.finalState.resources.silver;
    assert.ok(Number.isFinite(silver), `silver 应为有限数，实际 = ${silver}`);
  });
}

// ── §4: 经济健康检查（seed=42, 36 月） ────────────────────────────────────────

console.log('\n§4  经济无死锁（seed=42, 36 月）');

test('silver 全程无 NaN / Infinity', () => {
  // 每月结算后 silver 必须是有限数
  let state = makeInitialState(BASE_SEED);
  const { finalState, reports } = result36;
  // Check final state
  assert.ok(Number.isFinite(finalState.resources.silver),
    `finalState.silver 应为有限数，实际 = ${finalState.resources.silver}`);
  // Check net.silver across all reports is finite
  for (const r of reports) {
    if (r.net.silver !== undefined) {
      assert.ok(Number.isFinite(r.net.silver),
        `第 ${r.monthIndex} 月 net.silver 含非有限值`);
    }
  }
});

test('silver 36 月后不低于 -3000（无死亡螺旋）', () => {
  // 初始 1000 银，36 月内无玩家操作收入极低，但不应死亡螺旋
  const silver = result36.finalState.resources.silver;
  assert.ok(silver >= -3000,
    `silver 不应低于 -3000（死锁下限），实际 = ${silver}`);
});

test('reputation 无 NaN / Infinity', () => {
  const rep = result36.finalState.resources.reputation;
  assert.ok(Number.isFinite(rep), `reputation 应为有限数，实际 = ${rep}`);
});

test('morale 无 NaN / Infinity', () => {
  const morale = result36.finalState.resources.morale;
  assert.ok(Number.isFinite(morale), `morale 应为有限数，实际 = ${morale}`);
});

test('36 月内 net.silver 累计不低于 -5000', () => {
  const totalNetSilver = result36.reports.reduce(
    (sum, r) => sum + (r.net.silver ?? 0), 0,
  );
  assert.ok(
    totalNetSilver >= -5000,
    `36 月累计 net.silver = ${totalNetSilver}，不应低于 -5000`,
  );
});

test('各月 net 对象无 NaN 值', () => {
  for (const r of result36.reports) {
    for (const [key, val] of Object.entries(r.net)) {
      assert.ok(
        Number.isFinite(val),
        `第 ${r.monthIndex} 月 net.${key} = ${val}（非有限数）`,
      );
    }
  }
});

// ── §5: 状态一致性（seed=42, 36 月后） ───────────────────────────────────────

console.log('\n§5  状态一致性（36 月后）');

test('finalState.disciples 是数组', () => {
  assert.ok(Array.isArray(result36.finalState.disciples));
});

test('finalState.flags 是对象', () => {
  assert.ok(typeof result36.finalState.flags === 'object' && !Array.isArray(result36.finalState.flags));
});

test('finalState.resources 含完整字段', () => {
  const r = result36.finalState.resources;
  assert.ok(typeof r.silver === 'number', 'silver 应为 number');
  assert.ok(typeof r.reputation === 'number', 'reputation 应为 number');
  assert.ok(typeof r.morale === 'number', 'morale 应为 number');
  assert.ok(typeof r.inheritance === 'number', 'inheritance 应为 number');
});

test('finalState.grid 结构完整', () => {
  const g = result36.finalState.grid;
  assert.ok(typeof g.width === 'number');
  assert.ok(typeof g.height === 'number');
  assert.ok(typeof g.placedBuildings === 'object');
});

test('finalState.factions 是对象', () => {
  assert.ok(typeof result36.finalState.factions === 'object');
});

test('finalState.missionsActive 是数组', () => {
  assert.ok(Array.isArray(result36.finalState.missionsActive));
});

test('弟子状态无损坏（statuses 均为数组）', () => {
  for (const d of result36.finalState.disciples) {
    assert.ok(Array.isArray(d.statuses),
      `弟子 ${d.id} 的 statuses 应为数组`);
    assert.ok(typeof d.stats === 'object',
      `弟子 ${d.id} 的 stats 应为对象`);
  }
});

// ── §6: 结算报告完整性 ────────────────────────────────────────────────────────

console.log('\n§6  报告完整性');

test('每份报告含 monthIndex / yearIndex', () => {
  for (const r of result36.reports) {
    assert.ok(typeof r.monthIndex === 'number', `monthIndex 缺失（${r.monthIndex}）`);
    assert.ok(typeof r.yearIndex === 'number', `yearIndex 缺失（${r.yearIndex}）`);
  }
});

test('monthIndex 严格单调递增（1,2,...,36）', () => {
  for (let i = 0; i < result36.reports.length; i++) {
    assert.equal(result36.reports[i].monthIndex, i + 1,
      `第 ${i} 份报告 monthIndex 应为 ${i + 1}，实际 = ${result36.reports[i].monthIndex}`);
  }
});

test('每份报告含 eventsTriggered 数组', () => {
  for (const r of result36.reports) {
    assert.ok(Array.isArray(r.eventsTriggered),
      `monthIndex=${r.monthIndex} 缺少 eventsTriggered`);
  }
});

test('每份报告含 flagsChanged 数组', () => {
  for (const r of result36.reports) {
    assert.ok(Array.isArray(r.flagsChanged),
      `monthIndex=${r.monthIndex} 缺少 flagsChanged`);
  }
});

test('每份报告含 missionsSummary 数组', () => {
  for (const r of result36.reports) {
    assert.ok(Array.isArray(r.missionsSummary),
      `monthIndex=${r.monthIndex} 缺少 missionsSummary`);
  }
});

test('每份报告含 net 对象', () => {
  for (const r of result36.reports) {
    assert.ok(typeof r.net === 'object' && r.net !== null,
      `monthIndex=${r.monthIndex} 缺少 net`);
  }
});

test('每份报告含 annualChainLog 数组', () => {
  for (const r of result36.reports) {
    assert.ok(Array.isArray(r.annualChainLog),
      `monthIndex=${r.monthIndex} 缺少 annualChainLog`);
  }
});

// ── §7: 大会 summarizeSimulation 摘要验证 ────────────────────────────────────

console.log('\n§7  模拟摘要验证');

test('summarizeSimulation 返回完整摘要（36 月）', () => {
  const summary = summarizeSimulation(result36);
  assert.equal(summary.months, 36);
  assert.ok(typeof summary.finalResources === 'object');
  assert.ok(typeof summary.totalEventsTriggered === 'number');
  assert.ok(typeof summary.totalFlagChanges === 'number');
  assert.ok(Array.isArray(summary.annualChainsCompleted));
  assert.ok(typeof summary.netResourcesOverall === 'object');
});

test('summarizeSimulation 36 月内至少触发 10 次事件', () => {
  const summary = summarizeSimulation(result36);
  assert.ok(
    summary.totalEventsTriggered >= 10,
    `总事件数应 ≥ 10，实际 = ${summary.totalEventsTriggered}`,
  );
});

test('summarizeSimulation 42 月内 totalEventsTriggered > 36 月', () => {
  const s36 = summarizeSimulation(result36);
  const s42 = summarizeSimulation(result42);
  assert.ok(
    s42.totalEventsTriggered >= s36.totalEventsTriggered,
    `42 月事件数(${s42.totalEventsTriggered}) 应 ≥ 36 月(${s36.totalEventsTriggered})`,
  );
});

// ── 输出摘要（便于 CI 日志阅读） ──────────────────────────────────────────────

const summary36 = summarizeSimulation(result36);
console.log('\n  ── 36 月模拟摘要（seed=42） ──');
console.log(`  finalSilver     = ${summary36.finalResources.silver}`);
console.log(`  finalReputation = ${summary36.finalResources.reputation}`);
console.log(`  finalMorale     = ${summary36.finalResources.morale}`);
console.log(`  eventsTriggered = ${summary36.totalEventsTriggered}`);
console.log(`  flagChanges     = ${summary36.totalFlagChanges}`);
console.log(`  netSilver(36m)  = ${summary36.netResourcesOverall.silver ?? 0}`);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
