/**
 * Smoke tests — S3-3 结局系统
 *
 * Run: npx tsx tests/smoke_endings.test.ts
 */

import assert from 'node:assert/strict';
import {
  resolveEnding,
  calcScoreBreakdown,
  calcShadowScore,
  calcTournamentScore,
} from '../src/runtime/systems/tournament/ending_resolver.js';
import { makeInitialState } from './fixtures.js';
import type { TournamentState } from '../src/runtime/turn_engine/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTournament(overrides: Partial<TournamentState['results']> & { influence?: number } = {}): TournamentState {
  return {
    active: false,
    year: 1,
    phase: 'conclusion',
    phaseMonthsElapsed: 0,
    influence: overrides.influence ?? 0,
    participants: [],
    rankings: [],
    events: [],
    selectedRepresentatives: [],
    results: {
      martialWins:  overrides.martialWins  ?? 0,
      debateScore:  overrides.debateScore  ?? 0,
      allianceScore: overrides.allianceScore ?? 0,
    },
  };
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

console.log('\n── smoke_endings ────────────────────────────────────\n');

// ── calcShadowScore ───────────────────────────────────────────────────────────

test('calcShadowScore: 空势力 → 0', () => {
  assert.equal(calcShadowScore({}), 0);
});

test('calcShadowScore: 负关系也计入绝对值', () => {
  const score = calcShadowScore({ 'faction.righteous': -60, 'faction.demon': 60 });
  // |−60| + |60| = 120, floor(120/3) = 40
  assert.equal(score, 40);
});

test('calcShadowScore: 上限 100', () => {
  const score = calcShadowScore({
    a: 100, b: 100, c: 100, d: 100, e: 100,
  });
  assert.equal(score, 100);
});

test('calcShadowScore: 达到80的阈值', () => {
  // 需要 totalAbs ≥ 240; 3×80=240 → floor(240/3)=80
  const score = calcShadowScore({ a: 80, b: 80, c: 80 });
  assert.equal(score, 80);
});

// ── calcTournamentScore ───────────────────────────────────────────────────────

test('calcTournamentScore: 全胜满分', () => {
  const t = makeTournament({ martialWins: 3, debateScore: 10, allianceScore: 10, influence: 50 });
  // 3×20 + 10×10 + 10×10 + 50 = 60+100+100+50 = 310
  assert.equal(calcTournamentScore(t), 310);
});

test('calcTournamentScore: 参与无成绩', () => {
  const t = makeTournament();
  assert.equal(calcTournamentScore(t), 0);
});

// ── calcScoreBreakdown ────────────────────────────────────────────────────────

test('calcScoreBreakdown: 初始状态结构正确', () => {
  const state = makeInitialState();
  const bp = calcScoreBreakdown(state);
  assert.ok(bp.total >= 0 && bp.total <= 100, `total=${bp.total} out of range`);
  assert.ok(bp.reputation >= 0 && bp.reputation <= 25);
  assert.ok(bp.buildings >= 0 && bp.buildings <= 20);
  assert.ok(bp.legacy >= 0 && bp.legacy <= 20);
  assert.ok(bp.disciples >= 0 && bp.disciples <= 20);
  assert.ok(bp.factions >= 0 && bp.factions <= 15);
  assert.equal(bp.total, bp.reputation + bp.buildings + bp.legacy + bp.disciples + bp.factions);
});

test('calcScoreBreakdown: 名望分 rep=1000 → 25', () => {
  const state = makeInitialState();
  state.resources.reputation = 1000;
  const bp = calcScoreBreakdown(state);
  assert.equal(bp.reputation, 25);
});

test('calcScoreBreakdown: 名望分 rep=200 → 5', () => {
  const state = makeInitialState();
  state.resources.reputation = 200;
  const bp = calcScoreBreakdown(state);
  assert.equal(bp.reputation, 5);
});

test('calcScoreBreakdown: 产业分 - 3个Lv1建筑 → 3', () => {
  const state = makeInitialState();
  // makeInitialState has 3 level-1 buildings (scripture_library, meditation_chamber, training_ground)
  state.grid.placedBuildings = {
    b1: { id: 'b1', defId: 'training_ground',   x: 0, y: 0, level: 1 },
    b2: { id: 'b2', defId: 'scripture_library',  x: 1, y: 0, level: 1 },
    b3: { id: 'b3', defId: 'meditation_chamber', x: 2, y: 0, level: 1 },
  };
  const bp = calcScoreBreakdown(state);
  assert.equal(bp.buildings, 3);
});

test('calcScoreBreakdown: 产业分上限 20', () => {
  const state = makeInitialState();
  // Add 10 level-3 buildings → sum=30, capped at 20
  state.grid.placedBuildings = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `b${i}`, { id: `b${i}`, defId: 'training_ground', x: i, y: 0, level: 3 },
    ]),
  );
  const bp = calcScoreBreakdown(state);
  assert.equal(bp.buildings, 20);
});

test('calcScoreBreakdown: 传承分 - 5武学 → artsBonus=10', () => {
  const state = makeInitialState();
  state.martialArts.unlocked = ['a', 'b', 'c', 'd', 'e'];
  const bp = calcScoreBreakdown(state);
  // 5×2=10; no above-mortal disciples → legacy=10
  assert.equal(bp.legacy, 10);
});

test('calcScoreBreakdown: 江湖影响分 - 正向关系100 → 10', () => {
  const state = makeInitialState();
  state.factions = { 'faction.righteous': 100 };
  const bp = calcScoreBreakdown(state);
  // floor(100/10)=10, capped at 15 → 10
  assert.equal(bp.factions, 10);
});

// ── resolveEnding ─────────────────────────────────────────────────────────────

test('resolveEnding: 默认 → ordinary_sect', () => {
  const state = makeInitialState();
  const t = makeTournament();
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'ordinary_sect');
});

test('resolveEnding: 正道条件满足 → righteous_leader', () => {
  const state = makeInitialState();
  state.resources.reputation = 500;
  state.factions['faction.righteous'] = 60;
  // tournament score ≥ 50 (topThree)
  const t = makeTournament({ martialWins: 0, debateScore: 5, allianceScore: 5, influence: 50 });
  // tScore = 0 + 50 + 50 + 50 = 150 ≥ 50 ✓
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'righteous_leader');
  assert.equal(result.title, '正道盟主');
});

test('resolveEnding: 正道条件 - 声望不足 → ordinary_sect', () => {
  const state = makeInitialState();
  state.resources.reputation = 400; // < 500
  state.factions['faction.righteous'] = 60;
  const t = makeTournament({ influence: 100 });
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'ordinary_sect');
});

test('resolveEnding: 正道条件 - 大会未进前三 → ordinary_sect', () => {
  const state = makeInitialState();
  state.resources.reputation = 600;
  state.factions['faction.righteous'] = 70;
  const t = makeTournament(); // tScore = 0 < 50
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'ordinary_sect');
});

test('resolveEnding: 擂台全胜 → martial_champion', () => {
  const state = makeInitialState();
  const t = makeTournament({ martialWins: 3 });
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'martial_champion');
  assert.equal(result.title, '武林至尊');
});

test('resolveEnding: 擂台全胜 优先级高于正道盟主', () => {
  const state = makeInitialState();
  state.resources.reputation = 600;
  state.factions['faction.righteous'] = 70;
  // 同时满足 righteous_leader 和 martial_champion
  const t = makeTournament({ martialWins: 3, debateScore: 5, allianceScore: 5, influence: 50 });
  const result = resolveEnding(state, t);
  // martial_champion 优先级高于 righteous_leader
  assert.equal(result.endingId, 'martial_champion');
});

test('resolveEnding: 幕后盟主条件满足 → shadow_master', () => {
  const state = makeInitialState();
  // 5 factions, 3 of them ≥ 40; shadow score ≥ 80
  state.factions = {
    'faction.righteous':  50,  // ≥40 ✓
    'faction.demon':      -80, // |−80|=80 contributes to shadow
    'faction.government': 50,  // ≥40 ✓
    'faction.merchant':   50,  // ≥40 ✓
    'faction.beggar':     60,  // ≥40 ✓ (extra)
  };
  // shadow = floor((50+80+50+50+60)/3) = floor(290/3) = 96 ≥ 80 ✓
  // factionsAbove40 = 4 (righteous/government/merchant/beggar) ≥ 3 ✓
  const t = makeTournament(); // no martial wins → not martial_champion
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'shadow_master');
  assert.equal(result.title, '幕后盟主');
});

test('resolveEnding: 幕后盟主 - 暗流分数不足 → 退到其他', () => {
  const state = makeInitialState();
  state.factions = {
    'faction.righteous': 50, 'faction.government': 50, 'faction.merchant': 50,
  };
  // shadow = floor(150/3) = 50 < 80
  const t = makeTournament();
  const result = resolveEnding(state, t);
  assert.notEqual(result.endingId, 'shadow_master');
});

test('resolveEnding: 魔道巨擘条件满足 → demon_lord', () => {
  const state = makeInitialState();
  state.factions['faction.demon'] = 60;
  state.factions['faction.righteous'] = -50;
  const t = makeTournament();
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'demon_lord');
  assert.equal(result.title, '魔道巨擘');
});

test('resolveEnding: 魔道巨擘 - 正道不够低 → 不触发', () => {
  const state = makeInitialState();
  state.factions['faction.demon'] = 60;
  state.factions['faction.righteous'] = -30; // > -40
  const t = makeTournament();
  const result = resolveEnding(state, t);
  assert.notEqual(result.endingId, 'demon_lord');
});

test('resolveEnding: 魔道巨擘 优先级最高（高于擂台全胜）', () => {
  const state = makeInitialState();
  state.factions['faction.demon'] = 80;
  state.factions['faction.righteous'] = -60;
  const t = makeTournament({ martialWins: 3 }); // 也满足 martial_champion
  const result = resolveEnding(state, t);
  assert.equal(result.endingId, 'demon_lord');
});

test('resolveEnding: EndingResult 包含 score + scoreBreakdown + achievements', () => {
  const state = makeInitialState();
  const t = makeTournament();
  const result = resolveEnding(state, t);
  assert.ok(typeof result.score === 'number');
  assert.ok(result.scoreBreakdown !== undefined);
  assert.ok(Array.isArray(result.achievements));
  assert.ok(result.endingId.length > 0);
  assert.ok(result.title.length > 0);
  assert.ok(result.description.length > 0);
});

test('resolveEnding: 擂台全胜成就', () => {
  const state = makeInitialState();
  const t = makeTournament({ martialWins: 3 });
  const result = resolveEnding(state, t);
  assert.ok(result.achievements.some(a => a.includes('擂台全胜')), '应包含擂台全胜成就');
});

// ── 汇总 ──────────────────────────────────────────────────────────────────────

console.log();
if (failed === 0) {
  console.log(`✅  smoke_endings: ${passed}/${passed} tests passed`);
} else {
  console.log(`❌  smoke_endings: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
