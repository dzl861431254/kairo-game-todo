/**
 * Smoke tests — Mission Chain System (T-B2)
 *
 * Tests:
 *  - canDispatch rejects when unlockCondition not met
 *  - canDispatch passes when unlockCondition met
 *  - settleCompletedMissions emits set_flag on success with completionFlag
 *  - settleCompletedMissions does NOT emit flag on failure
 *  - flag from completionFlag appears in SettlementReport.flagsChanged
 *
 * Run: npx tsx tests/smoke_mission_chain.test.ts
 */

import assert from 'node:assert/strict';
import { canDispatch } from '../src/runtime/systems/mission/validator.js';
import { settleCompletedMissions } from '../src/runtime/systems/mission/manager.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { MissionTemplateDef } from '../src/runtime/systems/mission/types.js';
import type { ActiveMission, GameState } from '../src/runtime/turn_engine/types.js';
import type { MissionContentDef } from '../src/runtime/systems/mission/types.js';

const evaluator = new ConditionEvaluator();

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

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseTemplate: MissionTemplateDef = {
  id: 'mission_a',
  name: '任务A',
  description: '测试任务',
  category: 'test',
  durationMonths: 3,
  minPartySize: 1,
  recommendedPower: 50,
  rewards: [{ type: 'reputation_delta', delta: 20, reason: '任务成功' }],
  failPenalty: [],
  eventCardIds: [],
};

const chainedTemplate: MissionTemplateDef = {
  ...baseTemplate,
  id: 'mission_b',
  name: '任务B（需任务A完成）',
  unlockCondition: [{ field: 'flags.mission_a_done', op: 'eq', value: true }],
  completionFlag: 'mission_b_done',
};

const templateWithFlag: MissionTemplateDef = {
  ...baseTemplate,
  id: 'mission_with_flag',
  completionFlag: 'mission_complete_flag',
};

// ── canDispatch + unlockCondition ─────────────────────────────────────────────

console.log('\n── smoke_mission_chain ──────────────────────────────────\n');

test('canDispatch succeeds for unlocked mission (no condition)', () => {
  const state = makeInitialState();
  const result = canDispatch(state, [baseTemplate], 'mission_a', ['d1'], evaluator);
  assert.ok(result.valid, result.reason);
});

test('canDispatch rejects when unlockCondition not met', () => {
  // flags.mission_a_done is not set
  const state = makeInitialState();
  const result = canDispatch(state, [chainedTemplate], 'mission_b', ['d1'], evaluator);
  assert.ok(!result.valid, 'should be invalid when flag not set');
  assert.match(result.reason ?? '', /未解锁|unlock/i);
});

test('canDispatch succeeds when unlockCondition is met', () => {
  const state: GameState = {
    ...makeInitialState(),
    flags: { 'mission_a_done': true },
  };
  const result = canDispatch(state, [chainedTemplate], 'mission_b', ['d1'], evaluator);
  assert.ok(result.valid, result.reason);
});

test('canDispatch without evaluator skips condition check', () => {
  // Without evaluator, unlockCondition is NOT checked → should pass
  const state = makeInitialState(); // no flag set
  const result = canDispatch(state, [chainedTemplate], 'mission_b', ['d1']);
  assert.ok(result.valid, 'without evaluator, condition check skipped');
});

test('canDispatch rejects unknown templateId', () => {
  const state = makeInitialState();
  const result = canDispatch(state, [], 'nonexistent', ['d1'], evaluator);
  assert.ok(!result.valid);
});

test('canDispatch rejects when party size below minimum', () => {
  const state = makeInitialState();
  const template: MissionTemplateDef = { ...baseTemplate, minPartySize: 3 };
  const result = canDispatch(state, [template], 'mission_a', ['d1'], evaluator);
  assert.ok(!result.valid, 'should fail: only 1 disciple, need 3');
});

// ── settleCompletedMissions + completionFlag ──────────────────────────────────

function makeCompletedMission(succeeded: boolean): { state: GameState; content: MissionContentDef } {
  const mission: ActiveMission = {
    id: 'm_1',
    templateId: 'mission_with_flag',
    remainingMonths: 0, // ready to complete
    partyDiscipleIds: ['d1'],
    supplies: {},
    state: succeeded
      ? { eventsResolved: [{ cardId: 'c1', success: true }] }
      : { eventsResolved: [{ cardId: 'c1', success: false }] },
  };
  const gameState: GameState = {
    ...makeInitialState(),
    missionsActive: [mission],
  };
  const content: MissionContentDef = {
    templates: [templateWithFlag],
    eventCards: [],
  };
  return { state: gameState, content };
}

test('settleCompletedMissions emits completionFlag on success', () => {
  const { state, content } = makeCompletedMission(true);
  const result = settleCompletedMissions(state, content);
  const flagEffect = result.effects.find(
    e => e.type === 'set_flag' && e.key === 'mission_complete_flag',
  );
  assert.ok(flagEffect, 'completionFlag effect not emitted on success');
  assert.equal((flagEffect as { value: boolean }).value, true);
});

test('settleCompletedMissions does NOT emit completionFlag on failure', () => {
  const { state, content } = makeCompletedMission(false);
  const result = settleCompletedMissions(state, content);
  const flagEffect = result.effects.find(
    e => e.type === 'set_flag' && e.key === 'mission_complete_flag',
  );
  assert.ok(!flagEffect, 'completionFlag should NOT be emitted on failure');
});

test('completionFlag appears in SettlementReport.flagsChanged', () => {
  const { state: gameState, content } = makeCompletedMission(true);

  const db = {
    ...makeEmptyContentDB(),
    missions: content,
  };

  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
  const { report } = engine.executeTurn(gameState, db, {});

  const flagInReport = report.flagsChanged.find(
    f => f.key === 'mission_complete_flag',
  );
  assert.ok(flagInReport, `mission_complete_flag not in flagsChanged. Found: ${report.flagsChanged.map(f => f.key).join(', ')}`);
  assert.equal(flagInReport.value, true);
  assert.equal(flagInReport.stage, 'mission_settlement');
});

test('mission chain: step2 unlocked only after step1 completion', () => {
  // Simulate step1 completing → flag set → step2 now unlockable
  const step1: MissionTemplateDef = {
    ...baseTemplate,
    id: 'step1',
    completionFlag: 'step1_done',
  };
  const step2: MissionTemplateDef = {
    ...baseTemplate,
    id: 'step2',
    unlockCondition: [{ field: 'flags.step1_done', op: 'eq', value: true }],
  };
  const templates = [step1, step2];

  // Before: step2 not unlocked
  const stateBefore = makeInitialState();
  const before = canDispatch(stateBefore, templates, 'step2', ['d1'], evaluator);
  assert.ok(!before.valid, 'step2 should be locked before step1 done');

  // After: step1_done = true
  const stateAfter: GameState = {
    ...makeInitialState(),
    flags: { step1_done: true },
  };
  const after = canDispatch(stateAfter, templates, 'step2', ['d1'], evaluator);
  assert.ok(after.valid, 'step2 should unlock after step1_done set');
});

// ── faction_relation_delta on mission settlement ──────────────────────────────

function makeFactionMission(succeeded: boolean): { state: GameState; content: MissionContentDef } {
  const factionTemplate: MissionTemplateDef = {
    ...baseTemplate,
    id: 'mission_faction',
    factionId: 'faction.righteous',
  };
  const mission: ActiveMission = {
    id: 'm_faction',
    templateId: 'mission_faction',
    remainingMonths: 0,
    partyDiscipleIds: ['d1'],
    supplies: {},
    state: succeeded
      ? { eventsResolved: [{ cardId: 'c1', success: true }] }
      : { eventsResolved: [{ cardId: 'c1', success: false }] },
  };
  const gameState: GameState = {
    ...makeInitialState(),
    factions: { 'faction.righteous': 10 },
    missionsActive: [mission],
  };
  const content: MissionContentDef = { templates: [factionTemplate], eventCards: [] };
  return { state: gameState, content };
}

test('settleCompletedMissions emits faction_relation_delta +10 on success', () => {
  const { state, content } = makeFactionMission(true);
  const { effects } = settleCompletedMissions(state, content);
  const rel = effects.find(e => e.type === 'faction_relation_delta');
  assert.ok(rel, 'faction_relation_delta effect not emitted on success');
  assert.equal((rel as { factionId: string }).factionId, 'faction.righteous');
  assert.equal((rel as { delta: number }).delta, 10);
});

test('settleCompletedMissions emits faction_relation_delta -5 on failure', () => {
  const { state, content } = makeFactionMission(false);
  const { effects } = settleCompletedMissions(state, content);
  const rel = effects.find(e => e.type === 'faction_relation_delta');
  assert.ok(rel, 'faction_relation_delta effect not emitted on failure');
  assert.equal((rel as { delta: number }).delta, -5);
});

test('faction relation updates in GameState after executeTurn (success)', () => {
  const { state: gameState, content } = makeFactionMission(true);
  const db = { ...makeEmptyContentDB(), missions: content };
  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
  const { nextState } = engine.executeTurn(gameState, db, {});
  assert.equal(nextState.factions['faction.righteous'], 20, 'relation should be 10 + 10 = 20');
});

test('faction relation clamps to -100 / 100', () => {
  const executor = new EffectExecutor();
  const state: GameState = { ...makeInitialState(), factions: { 'faction.x': 95 } };
  const result = executor.apply(state, [
    { type: 'faction_relation_delta', factionId: 'faction.x', delta: 20 },
  ], { source: { kind: 'system' } });
  assert.equal(result.nextState.factions['faction.x'], 100, 'should clamp at 100');

  const state2: GameState = { ...makeInitialState(), factions: { 'faction.x': -95 } };
  const result2 = executor.apply(state2, [
    { type: 'faction_relation_delta', factionId: 'faction.x', delta: -20 },
  ], { source: { kind: 'system' } });
  assert.equal(result2.nextState.factions['faction.x'], -100, 'should clamp at -100');
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  smoke_mission_chain: ${passed}/${passed + failed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  smoke_mission_chain: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
