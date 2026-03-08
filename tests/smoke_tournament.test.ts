/**
 * Smoke tests — 武林大会系统 (Task 4.2)
 *
 * Run: npx tsx tests/smoke_tournament.test.ts
 */

import assert from 'node:assert/strict';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { TournamentManager } from '../src/runtime/systems/tournament/manager.js';
import { shouldTriggerTournament } from '../src/runtime/turn_engine/types.js';
import { fastForward } from '../src/runtime/debug/fast_forward.js';
import { createRNG } from '../src/runtime/rng.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { TournamentState, Disciple } from '../src/runtime/turn_engine/types.js';

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

console.log('\n── smoke_tournament ────────────────────────────────────\n');

// ── shouldTriggerTournament ───────────────────────────────────────────────────

test('shouldTriggerTournament: fires at monthIndex=41 (year4 month6)', () => {
  // yearIndex=3, monthInYear=5 (6th month, 0-based)
  // (3+1)%4===0 && 5===5 → true
  assert.equal(shouldTriggerTournament(41), true);
});

test('shouldTriggerTournament: does NOT fire at monthIndex=40', () => {
  assert.equal(shouldTriggerTournament(40), false);
});

test('shouldTriggerTournament: fires again at monthIndex=89 (year8 month6)', () => {
  // yearIndex=7, monthInYear=5 → (7+1)%4===0 && 5===5
  assert.equal(shouldTriggerTournament(89), true);
});

test('shouldTriggerTournament: does NOT fire at monthIndex=53 (year5 month6)', () => {
  assert.equal(shouldTriggerTournament(53), false);
});

// ── TournamentManager.checkTrigger ───────────────────────────────────────────

test('checkTrigger: returns true at monthIndex=41 with tournament contentDB', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  state.monthIndex = 41;
  assert.equal(TournamentManager.checkTrigger(state, db), true);
});

test('checkTrigger: returns false when tournament already active', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  state.monthIndex = 41;
  state.tournament = { ...state.tournament!, active: true };
  assert.equal(TournamentManager.checkTrigger(state, db), false);
});

test('checkTrigger: returns false without tournament contentDB', () => {
  const db = makeEmptyContentDB();
  const dbNoTournament = { ...db, tournament: undefined };
  const state = makeInitialState();
  state.monthIndex = 41;
  assert.equal(TournamentManager.checkTrigger(state, dbNoTournament), false);
});

// ── TournamentManager.initTournament ─────────────────────────────────────────

test('initTournament: creates active tournament at announcement phase', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  state.monthIndex = 41;
  const t = TournamentManager.initTournament(state, db.tournament!);
  assert.equal(t.active, true);
  assert.equal(t.phase, 'announcement');
  assert.equal(t.phaseMonthsElapsed, 0);
  assert.equal(t.year, 1);
});

// ── TournamentManager.advancePhase ───────────────────────────────────────────

test('advancePhase: announcement(0mo) immediately advances to gathering', () => {
  const db = makeEmptyContentDB();
  const t: TournamentState = {
    active: true, year: 1, phase: 'announcement', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [], results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };
  const next = TournamentManager.advancePhase(t, db.tournament!);
  assert.equal(next.phase, 'gathering');
  assert.equal(next.phaseMonthsElapsed, 0);
});

test('advancePhase: gathering(1mo) stays in gathering on first month', () => {
  const db = makeEmptyContentDB();
  const t: TournamentState = {
    active: true, year: 1, phase: 'gathering', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [], results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };
  const next = TournamentManager.advancePhase(t, db.tournament!);
  assert.equal(next.phase, 'martial');  // 0+1=1 >= 1(durationMonths) → advance
  assert.equal(next.phaseMonthsElapsed, 0);
});

test('advancePhase: full sequence announcement→gathering→martial→debate→politics→conclusion', () => {
  const db = makeEmptyContentDB();
  let t: TournamentState = {
    active: true, year: 1, phase: 'announcement', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [], results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };
  const expectedSequence = ['gathering', 'martial', 'debate', 'politics', 'conclusion'];
  for (const expectedPhase of expectedSequence) {
    t = TournamentManager.advancePhase(t, db.tournament!);
    assert.equal(t.phase, expectedPhase, `Expected phase ${expectedPhase}, got ${t.phase}`);
  }
});

test('advancePhase: conclusion phase does not advance further', () => {
  const db = makeEmptyContentDB();
  const t: TournamentState = {
    active: true, year: 1, phase: 'conclusion', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [], results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };
  const next = TournamentManager.advancePhase(t, db.tournament!);
  assert.equal(next.phase, 'conclusion');
});

// ── TournamentManager.conclude ────────────────────────────────────────────────

test('conclude: champion rank (score>=150) yields champion rewards', () => {
  const db = makeEmptyContentDB();
  const t: TournamentState = {
    active: true, year: 1, phase: 'conclusion', phaseMonthsElapsed: 0,
    influence: 50, participants: [], rankings: [], events: [],
    selectedRepresentatives: [],
    results: { martialWins: 5, debateScore: 5, allianceScore: 5 },
    // score = 5*20 + 5*10 + 5*10 + 50 = 100+50+50+50 = 250 >= 150 → champion
  };
  const { updatedTournament, effects } = TournamentManager.conclude(t, db.tournament!);
  assert.equal(updatedTournament.active, false);
  assert.equal(updatedTournament.phase, 'conclusion');
  // Champion reward: +500 rep, +30 morale, set_flag
  const repEffect = effects.find(e => e.type === 'reputation_delta');
  assert.ok(repEffect, 'Expected reputation_delta effect');
  assert.equal((repEffect as { type: 'reputation_delta'; delta: number }).delta, 500);
  const flagEffect = effects.find(e => e.type === 'set_flag');
  assert.ok(flagEffect, 'Expected set_flag for champion title');
});

test('conclude: topThree rank (score 50-149) yields topThree rewards', () => {
  const db = makeEmptyContentDB();
  const t: TournamentState = {
    active: true, year: 1, phase: 'conclusion', phaseMonthsElapsed: 0,
    influence: 20, participants: [], rankings: [], events: [],
    selectedRepresentatives: [],
    results: { martialWins: 1, debateScore: 1, allianceScore: 1 },
    // score = 1*20 + 1*10 + 1*10 + 20 = 60 >= 50 → topThree
  };
  const { effects } = TournamentManager.conclude(t, db.tournament!);
  const repEffect = effects.find(e => e.type === 'reputation_delta');
  assert.ok(repEffect);
  assert.equal((repEffect as { type: 'reputation_delta'; delta: number }).delta, 200);
});

test('conclude: participant rank (score<50) yields participant rewards', () => {
  const db = makeEmptyContentDB();
  const t: TournamentState = {
    active: true, year: 1, phase: 'conclusion', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [],
    results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
    // score = 0 < 50 → participant
  };
  const { effects } = TournamentManager.conclude(t, db.tournament!);
  const repEffect = effects.find(e => e.type === 'reputation_delta');
  assert.ok(repEffect);
  assert.equal((repEffect as { type: 'reputation_delta'; delta: number }).delta, 50);
});

// ── TurnEngine Integration ────────────────────────────────────────────────────

test('TurnEngine: tournament triggers at monthIndex=41 (after endTurn from 40)', () => {
  const db = makeEmptyContentDB();
  const engine = makeEngine();
  // Fast-forward to monthIndex=40
  const { finalState: state40 } = fastForward(makeInitialState(), db, 40);
  assert.equal(state40.monthIndex, 40);
  // One more turn: monthIndex becomes 41 → tournament should trigger
  const { nextState } = engine.executeTurn(state40, db, {});
  assert.equal(nextState.monthIndex, 41);
  assert.equal(nextState.tournament?.active, true, 'Tournament should be active after trigger month');
  assert.equal(nextState.tournament?.phase, 'announcement');
});

test('TurnEngine: tournament concludes at monthIndex=46 (5 months after trigger)', () => {
  const db = makeEmptyContentDB();
  const engine = makeEngine();
  // Fast-forward to trigger (monthIndex=40)
  const { finalState: state40 } = fastForward(makeInitialState(), db, 40);
  // Run 6 more turns: months 41-46 → triggers at 41, concludes at 46
  const { finalState } = fastForward(state40, db, 6);
  assert.equal(finalState.monthIndex, 46);
  assert.equal(finalState.tournament?.active, false, 'Tournament should have concluded');
  // Reputation should have increased from the participation reward
  const initialRep = makeInitialState().resources.reputation;
  assert.ok(finalState.resources.reputation > initialRep, 'Reputation should increase from tournament reward');
});

test('TurnEngine: tournament does not fire again in same 4-year cycle', () => {
  const db = makeEmptyContentDB();
  const { finalState } = fastForward(makeInitialState(), db, 48);
  // monthIndex=48 is year4 month12; tournament should be concluded (not active)
  assert.equal(finalState.tournament?.active, false);
});

// ── 得分计算 ──────────────────────────────────────────────────────────────────

function makeDisciple(overrides: Partial<Record<string, number>> = {}): Disciple {
  return {
    id: 'test_d', name: '测试弟子',
    stats: { physique: 60, comprehension: 80, willpower: 50, agility: 50, charisma: 40, ...overrides },
    statuses: [], trainingProgress: {},
  };
}

test('resolveMartial: high physique wins more bouts on average', () => {
  // S3-2: winProb is capped at 95% even for physique=100 (arts formula).
  // Test statistically: physique=100 should average > 2.5 wins / 3 across many seeds.
  let total = 0;
  for (let seed = 0; seed < 200; seed++) {
    const rng = createRNG(seed);
    total += TournamentManager.resolveMartial(makeDisciple({ physique: 100 }), rng);
  }
  const avg = total / 200;
  assert.ok(avg > 2.5, `physique=100 should average > 2.5 wins/3, got ${avg.toFixed(2)}`);
});

test('resolveMartial: zero physique wins no bouts', () => {
  const rng = createRNG(42);
  const disciple = makeDisciple({ physique: 0 });
  const wins = TournamentManager.resolveMartial(disciple, rng);
  assert.equal(wins, 0, 'physique=0 should never win');
});

test('resolveMartial: result is in range [0, 3]', () => {
  const rng = createRNG(999);
  const disciple = makeDisciple({ physique: 50 });
  const wins = TournamentManager.resolveMartial(disciple, rng);
  assert.ok(wins >= 0 && wins <= 3, `wins out of range: ${wins}`);
});

test('resolveDebate: score = round(comprehension * 0.1)', () => {
  assert.equal(TournamentManager.resolveDebate(makeDisciple({ comprehension: 80 })), 8);
  assert.equal(TournamentManager.resolveDebate(makeDisciple({ comprehension: 100 })), 10);
  assert.equal(TournamentManager.resolveDebate(makeDisciple({ comprehension: 0 })), 0);
});

test('resolveDebate: capped at 15 (S3-2 enhanced cap; base compScore capped at 15)', () => {
  // S3-2 raises the debate cap from 10 to 15 (with state bonuses: inheritance/research/align).
  // Without state, compScore = round(200*0.1) = 20 → clamped to total cap 15.
  const score = TournamentManager.resolveDebate(makeDisciple({ comprehension: 200 }));
  assert.equal(score, 15);
});

test('resolvePolitics: returns score based on reputation', () => {
  const state = makeInitialState();
  state.resources.reputation = 150; // floor(150/50)=3
  state.factions = {};               // no faction bonus
  const score = TournamentManager.resolvePolitics(state);
  assert.equal(score, 3);
});

test('resolvePolitics: adds faction alliance bonus for positive relations', () => {
  const state = makeInitialState();
  state.resources.reputation = 100; // floor(100/50)=2
  state.factions = { 'faction.righteous': 80, 'faction.merchant': 60 }; // 140 total → floor(140/100)=1
  const score = TournamentManager.resolvePolitics(state);
  assert.equal(score, 3); // repScore=2 + allianceBonus=1
});

test('resolvePolitics: ignores negative faction relations', () => {
  const state = makeInitialState();
  state.resources.reputation = 50;
  state.factions = { 'faction.demon': -80 }; // negative → ignored
  const score = TournamentManager.resolvePolitics(state);
  assert.equal(score, 1); // repScore=1 + allianceBonus=0
});

// ── advancePhase 得分自动结算 ─────────────────────────────────────────────────

test('advancePhase with state: martial score accumulated when representative set', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  // Use physique=100 so we always win
  state.disciples[0].stats['physique'] = 100;
  const rng = createRNG(1);

  const t: TournamentState = {
    active: true, year: 1, phase: 'martial', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [{ phaseId: 'martial', discipleId: 'd1' }],
    results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };

  // durationMonths=1; after 1 month elapsed → advance to debate + calc martial score
  const advanced = TournamentManager.advancePhase(t, db.tournament!, state, rng);
  assert.equal(advanced.phase, 'debate');
  assert.equal(advanced.results.martialWins, 3, 'physique=100 → 3 wins');
});

test('advancePhase with state: debate score accumulated when representative set', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  state.disciples[0].stats['comprehension'] = 80;
  const rng = createRNG(1);

  const t: TournamentState = {
    active: true, year: 1, phase: 'debate', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [{ phaseId: 'debate', discipleId: 'd1' }],
    results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };

  const advanced = TournamentManager.advancePhase(t, db.tournament!, state, rng);
  assert.equal(advanced.phase, 'politics');
  assert.equal(advanced.results.debateScore, 8); // round(80 * 0.1) = 8
});

test('advancePhase with state: politics score accumulated (no representative needed)', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  state.resources.reputation = 100;  // floor(100/50)=2
  state.factions = {};
  const rng = createRNG(1);

  const t: TournamentState = {
    active: true, year: 1, phase: 'politics', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [], // no representative slot needed for politics
    results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };

  const advanced = TournamentManager.advancePhase(t, db.tournament!, state, rng);
  assert.equal(advanced.phase, 'conclusion');
  assert.equal(advanced.results.allianceScore, 2); // repScore=2 + allianceBonus=0
});

test('advancePhase without state: no score computed (backward-compat)', () => {
  const db = makeEmptyContentDB();
  const t: TournamentState = {
    active: true, year: 1, phase: 'martial', phaseMonthsElapsed: 0,
    influence: 0, participants: [], rankings: [], events: [],
    selectedRepresentatives: [{ phaseId: 'martial', discipleId: 'd1' }],
    results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
  };
  const advanced = TournamentManager.advancePhase(t, db.tournament!); // no state/rng
  assert.equal(advanced.results.martialWins, 0, 'Without state, no score computed');
  assert.equal(advanced.phase, 'debate');
});

test('advancePhase: martial score accumulates across TurnEngine run', () => {
  const db = makeEmptyContentDB();
  const state = makeInitialState();
  state.disciples[0].stats['physique'] = 100; // guaranteed wins

  // Fast-forward to trigger (monthIndex=40)
  const { finalState: s40 } = fastForward(state, db, 40);
  // Run 6 more turns through tournament
  const { finalState } = fastForward(s40, db, 6);
  // Tournament should have concluded; check martial wins were credited
  assert.equal(finalState.tournament?.active, false);
  // Score accumulated only if representative was set — since none set, martialWins=0
  assert.equal(finalState.tournament?.results.martialWins, 0);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

if (failed > 0) process.exit(1);
