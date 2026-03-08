/**
 * smoke_tournament_3passes.test.ts
 *
 * S3-2 三关玩法扩展 冒烟测试
 * 覆盖：
 *   - resolveMartial: 武学战力加成（S3-2 新增）
 *   - resolveDebate:  传承/研究/正邪加成（S3-2 新增，上限 15）
 *   - resolvePolitics: 正邪倾向加成（S3-2 新增，上限 22）
 *   - calcMartialPowerBreakdown / calcDebateBreakdown / calcPoliticsBreakdown
 *   - TurnEngine 集成：arts-enhanced 胜率
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TournamentManager,
  type MartialBreakdown,
  type DebateBreakdown,
  type PoliticsBreakdown,
} from '../src/runtime/systems/tournament/manager.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { createRNG } from '../src/runtime/rng.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { Disciple, TournamentState } from '../src/runtime/turn_engine/types.js';
import type { MartialArtContentDef } from '../src/runtime/systems/martial_art/types.js';

// ── 辅助：弟子构造 ──

function makeDisciple(
  id: string,
  physique: number,
  comprehension: number,
  equippedArts: string[] = [],
  overrides: Partial<Disciple> = {},
): Disciple {
  return {
    id,
    name: '测试弟子',
    stats: { physique, comprehension, willpower: 30, agility: 30, charisma: 20 },
    statuses: [],
    trainingProgress: {},
    realm: 'mortal' as const,
    realmProgress: 0,
    breakthroughAttempts: 0,
    talentGrade: 'C' as const,
    loadout: equippedArts.length > 0 ? { equippedArts } : undefined,
    ...overrides,
  };
}

// ── 辅助：最小武学库（power 5 / 20 / 60） ──
const testMartialArts: MartialArtContentDef = makeEmptyContentDB().martialArts;

// ── 辅助：活跃大会状态 ──
function makeTournament(phase: TournamentState['phase'], repDiscipleId?: string): TournamentState {
  const reps: TournamentState['selectedRepresentatives'] = [];
  if (repDiscipleId) {
    const phaseId = phase === 'martial' ? 'martial'
      : phase === 'debate' ? 'debate'
      : 'politics';
    if (phaseId === 'martial' || phaseId === 'debate' || phaseId === 'politics') {
      reps.push({ phaseId, discipleId: repDiscipleId });
    }
  }
  return {
    active: true,
    year: 1,
    phase,
    phaseMonthsElapsed: 0,
    influence: 0,
    participants: [],
    rankings: [],
    events: [],
    selectedRepresentatives: reps,
    results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
    takenPrepActions: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('calcMartialPowerBreakdown', () => {
  it('无武学时：artBonus=0，胜率=physique', () => {
    const d = makeDisciple('d1', 60, 30);
    const bd: MartialBreakdown = TournamentManager.calcMartialPowerBreakdown(d, testMartialArts);
    assert.equal(bd.physique, 60);
    assert.equal(bd.artBonus, 0);
    assert.equal(bd.winProbPct, 60);
  });

  it('装备 test_basic(power=5) → artBonus=5, 胜率=60+2.5≈62', () => {
    const d = makeDisciple('d1', 60, 30, ['test_basic']);
    const bd = TournamentManager.calcMartialPowerBreakdown(d, testMartialArts);
    assert.equal(bd.artBonus, 5);
    // winProbPct = min(95, max(5, 60 + 5*0.5)) = min(95, 62.5) = 62.5 → floor or round?
    // rawPct = 60 + 5*0.5 = 62.5; winProbPct = min(95, max(5, 62.5)) = 62.5
    assert.ok(bd.winProbPct > 60, 'arts should increase win prob');
  });

  it('装备 test_ultimate(power=60) → artBonus=60, 胜率显著提升', () => {
    const d = makeDisciple('d1', 40, 30, ['test_ultimate']);
    const bd = TournamentManager.calcMartialPowerBreakdown(d, testMartialArts);
    assert.equal(bd.artBonus, 60);
    // rawPct = 40 + 60*0.5 = 70
    assert.ok(bd.winProbPct > 40, 'high-power art should greatly improve win prob');
  });

  it('多件武学叠加', () => {
    const d = makeDisciple('d1', 50, 30, ['test_basic', 'test_advanced']);
    const bd = TournamentManager.calcMartialPowerBreakdown(d, testMartialArts);
    assert.equal(bd.artBonus, 5 + 20); // test_basic=5, test_advanced=20
    // rawPct = 50 + 25*0.5 = 50+12.5=62.5
    assert.ok(bd.winProbPct > 50);
  });

  it('胜率上限 95%（physique=100 + 大功法）', () => {
    const d = makeDisciple('d1', 100, 30, ['test_ultimate']);
    const bd = TournamentManager.calcMartialPowerBreakdown(d, testMartialArts);
    assert.ok(bd.winProbPct <= 95, 'win prob should be capped at 95');
  });

  it('physique=0 且无武学 → 胜率 0', () => {
    const d = makeDisciple('d1', 0, 30);
    const bd = TournamentManager.calcMartialPowerBreakdown(d, testMartialArts);
    assert.equal(bd.winProbPct, 0);
  });

  it('无 martialArtsContent 时 artBonus=0', () => {
    const d = makeDisciple('d1', 60, 30, ['test_basic']);
    const bd = TournamentManager.calcMartialPowerBreakdown(d);
    assert.equal(bd.artBonus, 0);
    assert.equal(bd.winProbPct, 60);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveMartial (S3-2 增强版)', () => {
  it('physique=0 且无武学时：0 胜（向后兼容）', () => {
    const d = makeDisciple('d1', 0, 30);
    const rng = createRNG(42);
    const wins = TournamentManager.resolveMartial(d, rng);
    assert.equal(wins, 0);
  });

  it('高体魄弟子胜率更高（平均 > 无武学低体魄）', () => {
    const dHigh = makeDisciple('d1', 90, 30, ['test_ultimate']);
    const dLow  = makeDisciple('d2', 10, 30);
    let highTotal = 0, lowTotal = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      const rng = createRNG(i);
      highTotal += TournamentManager.resolveMartial(dHigh, rng, testMartialArts);
      lowTotal  += TournamentManager.resolveMartial(dLow, rng);
    }
    assert.ok(highTotal > lowTotal, `High-art disciple (${highTotal}) should beat low (${lowTotal})`);
  });

  it('结果始终在 [0, 3] 区间', () => {
    const d = makeDisciple('d1', 60, 30, ['test_basic']);
    for (let i = 0; i < 50; i++) {
      const rng = createRNG(i);
      const wins = TournamentManager.resolveMartial(d, rng, testMartialArts);
      assert.ok(wins >= 0 && wins <= 3, `wins=${wins} out of range`);
    }
  });

  it('无 martialArtsContent 时行为与旧版一致', () => {
    const d = makeDisciple('d1', 60, 30);
    const rng1 = createRNG(123);
    const rng2 = createRNG(123);
    const w1 = TournamentManager.resolveMartial(d, rng1);
    const w2 = TournamentManager.resolveMartial(d, rng2);
    assert.equal(w1, w2); // 确定性
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('calcDebateBreakdown', () => {
  it('无 state 时只计悟性分（向后兼容）', () => {
    const d = makeDisciple('d1', 30, 50);
    const bd: DebateBreakdown = TournamentManager.calcDebateBreakdown(d);
    assert.equal(bd.compScore, Math.round(50 * 0.1)); // 5
    assert.equal(bd.inheritanceBonus, 0);
    assert.equal(bd.researchBonus, 0);
    assert.equal(bd.alignBonus, 0);
    assert.equal(bd.total, 5);
  });

  it('悟性 100 时 compScore=10，上限仍为 10（无额外加成）', () => {
    const d = makeDisciple('d1', 30, 100);
    const bd = TournamentManager.calcDebateBreakdown(d);
    assert.equal(bd.compScore, 10);
    assert.equal(bd.total, 10);
  });

  it('传承 1000 → inheritanceBonus=2', () => {
    const state = makeInitialState();
    state.resources.inheritance = 1000;
    const d = makeDisciple('d1', 30, 50);
    const bd = TournamentManager.calcDebateBreakdown(d, state);
    assert.equal(bd.inheritanceBonus, 2);
  });

  it('传承 1500+ → inheritanceBonus 上限 3', () => {
    const state = makeInitialState();
    state.resources.inheritance = 9999;
    const d = makeDisciple('d1', 30, 50);
    const bd = TournamentManager.calcDebateBreakdown(d, state);
    assert.equal(bd.inheritanceBonus, 3);
  });

  it('研究完成武学：researchBonus 累积', () => {
    const state = makeInitialState();
    // test_basic 已达到 researchCost(10)
    state.martialArts.research = { test_basic: 10 };
    const d = makeDisciple('d1', 30, 50);
    const bd = TournamentManager.calcDebateBreakdown(d, state, testMartialArts);
    assert.equal(bd.researchBonus, 1);
  });

  it('研究上限 5', () => {
    const state = makeInitialState();
    // 全部都研究完（用 9999 超过各自 researchCost），fixture 只有 3 门武学 → researchBonus = 3
    state.martialArts.research = { test_basic: 9999, test_advanced: 9999, test_ultimate: 9999 };
    const d = makeDisciple('d1', 30, 50);
    const bd = TournamentManager.calcDebateBreakdown(d, state, testMartialArts);
    assert.ok(bd.researchBonus <= 5);
    assert.equal(bd.researchBonus, 3); // fixture 3 门全完成
  });

  it('正道倾向 ≥30 → alignBonus=+2', () => {
    const state = makeInitialState();
    state.resources.alignmentValue = 35;
    const d = makeDisciple('d1', 30, 50);
    const bd = TournamentManager.calcDebateBreakdown(d, state);
    assert.equal(bd.alignBonus, 2);
  });

  it('邪道倾向 ≤-30 → alignBonus=-2', () => {
    const state = makeInitialState();
    state.resources.alignmentValue = -40;
    const d = makeDisciple('d1', 30, 50);
    const bd = TournamentManager.calcDebateBreakdown(d, state);
    assert.equal(bd.alignBonus, -2);
  });

  it('total 上限 15', () => {
    const state = makeInitialState();
    state.resources.inheritance = 9999;
    state.resources.alignmentValue = 50;
    state.martialArts.research = { test_basic: 100, test_advanced: 100, test_ultimate: 100 };
    // comp=100 → 10, inheritance=3, research=3, align=+2 → 18 → capped at 15
    const d = makeDisciple('d1', 30, 100);
    const bd = TournamentManager.calcDebateBreakdown(d, state, testMartialArts);
    assert.equal(bd.total, 15);
  });

  it('total 下限 0（邪道惩罚不导致负数）', () => {
    const state = makeInitialState();
    state.resources.alignmentValue = -50;
    const d = makeDisciple('d1', 30, 5); // compScore = round(5*0.1) = 1
    const bd = TournamentManager.calcDebateBreakdown(d, state);
    // 1 + 0 + 0 - 2 = -1 → clamped to 0
    assert.equal(bd.total, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveDebate (S3-2 增强版)', () => {
  it('悟性 100，无 state → 10（向后兼容）', () => {
    const d = makeDisciple('d1', 30, 100);
    assert.equal(TournamentManager.resolveDebate(d), 10);
  });

  it('悟性 50，无 state → 5', () => {
    const d = makeDisciple('d1', 30, 50);
    assert.equal(TournamentManager.resolveDebate(d), 5);
  });

  it('悟性 50 + 传承 500 + 正道 → 得分 > 5', () => {
    const state = makeInitialState();
    state.resources.inheritance = 500;
    state.resources.alignmentValue = 35;
    const d = makeDisciple('d1', 30, 50);
    const score = TournamentManager.resolveDebate(d, state);
    assert.ok(score > 5, `score=${score} should be > 5`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('calcPoliticsBreakdown', () => {
  it('基础：声望 500 → repScore=10，无势力、alignment=0 → total=10', () => {
    const state = makeInitialState();
    state.resources.reputation = 500;
    state.factions = {};
    state.resources.alignmentValue = 0;
    const bd: PoliticsBreakdown = TournamentManager.calcPoliticsBreakdown(state);
    assert.equal(bd.repScore, 10);
    assert.equal(bd.allianceBonus, 0);
    assert.equal(bd.alignBonus, 0);
    assert.equal(bd.total, 10);
  });

  it('正道倾向 ≥30 → alignBonus=2', () => {
    const state = makeInitialState();
    state.resources.alignmentValue = 30;
    const bd = TournamentManager.calcPoliticsBreakdown(state);
    assert.equal(bd.alignBonus, 2);
  });

  it('邪道倾向 ≤-30 → alignBonus=1（暗盟加成）', () => {
    const state = makeInitialState();
    state.resources.alignmentValue = -35;
    const bd = TournamentManager.calcPoliticsBreakdown(state);
    assert.equal(bd.alignBonus, 1);
  });

  it('中立 alignment → alignBonus=0', () => {
    const state = makeInitialState();
    state.resources.alignmentValue = 10;
    const bd = TournamentManager.calcPoliticsBreakdown(state);
    assert.equal(bd.alignBonus, 0);
  });

  it('total 上限 22', () => {
    const state = makeInitialState();
    state.resources.reputation = 9999;   // repScore=10
    state.factions = { 'f1': 100, 'f2': 100, 'f3': 100, 'f4': 100 }; // allianceBonus=4
    state.resources.alignmentValue = 50; // alignBonus=2
    // 10+4+2=16, 远低于22，所以不触发上限。让我用更多势力
    state.factions = {};
    for (let i = 0; i < 10; i++) state.factions[`f${i}`] = 100; // sum=1000 → allianceBonus=min(10,10)=10
    const bd = TournamentManager.calcPoliticsBreakdown(state);
    // 10 + 10 + 2 = 22 → total=min(22,22)=22
    assert.equal(bd.total, 22);
  });

  it('负向势力不计入 allianceBonus', () => {
    const state = makeInitialState();
    state.factions = { bad: -100 };
    const bd = TournamentManager.calcPoliticsBreakdown(state);
    assert.equal(bd.allianceBonus, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolvePolitics (S3-2 增强版)', () => {
  it('声望 500，无势力，alignment=0 → 10（向后兼容）', () => {
    const state = makeInitialState();
    state.resources.reputation = 500;
    state.factions = {};
    state.resources.alignmentValue = 0;
    assert.equal(TournamentManager.resolvePolitics(state), 10);
  });

  it('正道倾向使得分 > 基础值', () => {
    const state = makeInitialState();
    state.resources.reputation = 500;
    state.factions = {};
    state.resources.alignmentValue = 0;
    const base = TournamentManager.resolvePolitics(state);

    state.resources.alignmentValue = 35;
    const withAlign = TournamentManager.resolvePolitics(state);
    assert.ok(withAlign > base);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('TurnEngine 三关集成（S3-2）', () => {
  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
  const contentDB = makeEmptyContentDB();

  it('擂台阶段：有武学的代表胜率更高（大样本）', () => {
    // 两个 run：一个代表装备 test_ultimate，一个不装备
    let winsWithArt = 0;
    let winsWithout = 0;
    const N = 20;

    for (let seed = 0; seed < N; seed++) {
      const state1 = makeInitialState();
      state1.rngState = seed;
      const disciple1 = state1.disciples[0]!;
      disciple1.stats['physique'] = 40;
      disciple1.loadout = { equippedArts: ['test_ultimate'] }; // power=60

      state1.tournament = {
        ...makeTournament('martial', disciple1.id),
        phase: 'martial',
      };
      state1.martialArts.unlocked = ['test_ultimate'];
      const r1 = engine.executeTurn(state1, contentDB, {});
      winsWithArt += r1.nextState.tournament?.results.martialWins ?? 0;

      const state2 = makeInitialState();
      state2.rngState = seed;
      const disciple2 = state2.disciples[0]!;
      disciple2.stats['physique'] = 40;
      // No arts
      state2.tournament = {
        ...makeTournament('martial', disciple2.id),
        phase: 'martial',
      };
      const r2 = engine.executeTurn(state2, contentDB, {});
      winsWithout += r2.nextState.tournament?.results.martialWins ?? 0;
    }
    // With ultimate art (power=60): winProb = min(95, 40+60*0.5) = min(95,70) = 70%
    // Without arts: winProb = 40%
    assert.ok(winsWithArt >= winsWithout,
      `With arts (${winsWithArt}) should ≥ without (${winsWithout})`);
  });

  it('论道阶段：传承资源增加得分', () => {
    const state1 = makeInitialState();
    const d = state1.disciples[0]!;
    d.stats['comprehension'] = 50;
    state1.resources.inheritance = 0;
    state1.tournament = makeTournament('debate', d.id);
    const r1 = engine.executeTurn(state1, contentDB, {});
    const score1 = r1.nextState.tournament?.results.debateScore ?? 0;

    const state2 = makeInitialState();
    const d2 = state2.disciples[0]!;
    d2.stats['comprehension'] = 50;
    state2.resources.inheritance = 1000; // +2 bonus
    state2.tournament = makeTournament('debate', d2.id);
    const r2 = engine.executeTurn(state2, contentDB, {});
    const score2 = r2.nextState.tournament?.results.debateScore ?? 0;

    assert.ok(score2 > score1, `With inheritance (${score2}) should > without (${score1})`);
  });

  it('结盟阶段：正道倾向增加得分', () => {
    const state1 = makeInitialState();
    state1.resources.alignmentValue = 0;
    state1.tournament = makeTournament('politics');
    const r1 = engine.executeTurn(state1, contentDB, {});
    const score1 = r1.nextState.tournament?.results.allianceScore ?? 0;

    const state2 = makeInitialState();
    state2.resources.alignmentValue = 35; // alignBonus=+2
    state2.tournament = makeTournament('politics');
    const r2 = engine.executeTurn(state2, contentDB, {});
    const score2 = r2.nextState.tournament?.results.allianceScore ?? 0;

    assert.ok(score2 >= score1, `With alignment (${score2}) should ≥ without (${score1})`);
  });
});
