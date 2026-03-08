/**
 * Smoke tests — S4-4 Mission Chains (3 chains × 3-4 steps)
 *
 * Chains:
 *  - 正道援助链 (rc_1_patrol → rc_2_rescue → rc_3_siege → rc_4_alliance)
 *  - 商盟贸易链 (trd_1_survey → trd_2_caravan → trd_3_monopoly)
 *  - 大会备战链 (tc_1_intel → tc_2_recruit → tc_3_qualify)
 *
 * Run: npx tsx tests/smoke_mission_chains_s44.test.ts
 */

import assert from 'node:assert/strict';
import { canDispatch } from '../src/runtime/systems/mission/validator.js';
import { settleCompletedMissions } from '../src/runtime/systems/mission/manager.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { makeInitialState, makeEmptyContentDB, loadRealContentDB } from './fixtures.js';
import type { MissionTemplateDef, MissionContentDef } from '../src/runtime/systems/mission/types.js';
import type { ActiveMission, GameState } from '../src/runtime/turn_engine/types.js';

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

function makeState(overrides: Partial<GameState> = {}): GameState {
  return { ...makeInitialState(), ...overrides };
}

/** Build a minimal mission template for chain testing */
function makeTemplate(id: string, unlockFlag?: string, completionFlag?: string): MissionTemplateDef {
  const t: MissionTemplateDef = {
    id,
    name: id,
    description: '',
    category: 'test',
    durationMonths: 1,
    minPartySize: 1,
    recommendedPower: 10,
    rewards: [{ type: 'reputation_delta', delta: 10, reason: 'done' }],
    failPenalty: [],
    eventCardIds: [],
  };
  if (unlockFlag) {
    t.unlockCondition = [{ type: 'state', field: `flags.${unlockFlag}`, op: 'eq', value: true }];
  }
  if (completionFlag) {
    t.completionFlag = completionFlag;
  }
  return t;
}

/** Build an ActiveMission that is ready to settle (remainingMonths = 0, all events succeeded) */
function makeCompletedMission(templateId: string, partySize = 1): ActiveMission {
  return {
    id: `active_${templateId}`,
    templateId,
    remainingMonths: 0,
    partyDiscipleIds: Array.from({ length: partySize }, (_, i) => `d${i + 1}`),
    supplies: {},
    state: { eventsResolved: [{ cardId: 'c1', success: true }, { cardId: 'c2', success: true }] },
  };
}

/** Build a failed ActiveMission (all events fail) */
function makeFailedMission(templateId: string): ActiveMission {
  return {
    id: `active_${templateId}`,
    templateId,
    remainingMonths: 0,
    partyDiscipleIds: ['d1'],
    supplies: {},
    state: { eventsResolved: [{ cardId: 'c1', success: false }, { cardId: 'c2', success: false }] },
  };
}

// ── Real content DB fixture ────────────────────────────────────────────────────

const realDB = loadRealContentDB();
const realMissions = realDB.missions;

function findTemplate(id: string): MissionTemplateDef {
  const t = realMissions.templates.find((t) => t.id === id);
  assert.ok(t, `Template ${id} not found in missions.json`);
  return t;
}

// ── §1: 正道援助链 (4 steps) ──────────────────────────────────────────────────

console.log('\n── smoke_mission_chains_s44 ──────────────────────────────\n');
console.log('§1 正道援助链');

test('rc_1_patrol exists with completionFlag righteous_c1_done', () => {
  const t = findTemplate('rc_1_patrol');
  assert.equal(t.completionFlag, 'righteous_c1_done');
  assert.ok(!t.unlockCondition || t.unlockCondition.length === 0, 'step1 should have no unlock condition');
});

test('rc_2_rescue requires righteous_c1_done flag', () => {
  const t = findTemplate('rc_2_rescue');
  assert.ok(t.unlockCondition && t.unlockCondition.length > 0);
  assert.equal(t.unlockCondition![0].field, 'flags.righteous_c1_done');
});

test('rc_3_siege requires righteous_c2_done flag', () => {
  const t = findTemplate('rc_3_siege');
  assert.ok(t.unlockCondition && t.unlockCondition.length > 0);
  assert.equal(t.unlockCondition![0].field, 'flags.righteous_c2_done');
});

test('rc_4_alliance requires righteous_c3_done and emits righteous_chain_complete', () => {
  const t = findTemplate('rc_4_alliance');
  assert.ok(t.unlockCondition && t.unlockCondition.length > 0);
  assert.equal(t.unlockCondition![0].field, 'flags.righteous_c3_done');
  assert.equal(t.completionFlag, 'righteous_chain_complete');
});

test('rc_2_rescue: canDispatch fails without flag', () => {
  const state = makeState();
  const t = findTemplate('rc_2_rescue');
  const result = canDispatch(state, [t], t.id, ['d1'], evaluator);
  assert.ok(!result.valid, 'should be locked without righteous_c1_done');
});

test('rc_2_rescue: canDispatch unlocked with flag (may still fail party size)', () => {
  const state = makeState({ flags: { righteous_c1_done: true } });
  const t = findTemplate('rc_2_rescue');
  // With flag set, unlock check passes — party size check may still fail
  const resultNoFlag = canDispatch(makeState(), [t], t.id, ['d1'], evaluator);
  const resultWithFlag = canDispatch(state, [t], t.id, ['d1'], evaluator);
  // Without flag → "未解锁" type failure; with flag → different reason (party size)
  assert.ok(!resultNoFlag.valid, 'should be invalid without flag');
  // After setting flag, the unlock check passes (reason changes or becomes party-size)
  assert.ok(
    resultWithFlag.reason !== resultNoFlag.reason || resultWithFlag.valid,
    'reason should differ or become valid after flag set',
  );
});

test('full chain: completing rc_1_patrol sets righteous_c1_done flag', () => {
  const template = findTemplate('rc_1_patrol');
  const mission = makeCompletedMission('rc_1_patrol');
  const state = makeState({ missionsActive: [mission] });
  const content: MissionContentDef = { templates: [template], eventCards: [] };
  const { effects } = settleCompletedMissions(state, content);
  const flagEffect = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'righteous_c1_done' && e.value === true,
  );
  assert.ok(flagEffect, 'righteous_c1_done should be set on success');
});

test('rc_4_alliance success: sets righteous_chain_complete flag', () => {
  const template = findTemplate('rc_4_alliance');
  const mission = makeCompletedMission('rc_4_alliance', 2);
  const state = makeState({
    missionsActive: [mission],
    flags: { righteous_c3_done: true },
  });
  const content: MissionContentDef = { templates: [template], eventCards: [] };
  const { effects } = settleCompletedMissions(state, content);
  const flagEffect = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'righteous_chain_complete' && e.value === true,
  );
  assert.ok(flagEffect, 'righteous_chain_complete should be set on success');
});

test('rc_4_alliance failure: does NOT set righteous_chain_complete', () => {
  const template = findTemplate('rc_4_alliance');
  const mission = makeFailedMission('rc_4_alliance');
  const state = makeState({ missionsActive: [mission] });
  const content: MissionContentDef = { templates: [template], eventCards: [] };
  const { effects } = settleCompletedMissions(state, content);
  const flagEffect = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'righteous_chain_complete',
  );
  assert.ok(!flagEffect, 'completionFlag should NOT be set on failure');
});

// ── §2: 商盟贸易链 (3 steps) ──────────────────────────────────────────────────

console.log('\n§2 商盟贸易链');

test('trd_1_survey exists with completionFlag merchant_c1_done', () => {
  const t = findTemplate('trd_1_survey');
  assert.equal(t.completionFlag, 'merchant_c1_done');
  assert.ok(!t.unlockCondition || t.unlockCondition.length === 0);
});

test('trd_2_caravan requires merchant_c1_done flag', () => {
  const t = findTemplate('trd_2_caravan');
  assert.ok(t.unlockCondition && t.unlockCondition.length > 0);
  assert.equal(t.unlockCondition![0].field, 'flags.merchant_c1_done');
});

test('trd_3_monopoly requires merchant_c2_done and emits merchant_chain_complete', () => {
  const t = findTemplate('trd_3_monopoly');
  assert.ok(t.unlockCondition && t.unlockCondition.length > 0);
  assert.equal(t.unlockCondition![0].field, 'flags.merchant_c2_done');
  assert.equal(t.completionFlag, 'merchant_chain_complete');
});

test('trd_2_caravan: canDispatch fails without merchant_c1_done', () => {
  const state = makeState();
  const t = findTemplate('trd_2_caravan');
  const result = canDispatch(state, [t], t.id, ['d1'], evaluator);
  assert.ok(!result.valid, 'should be locked without merchant_c1_done');
});

test('trd_1_survey success: sets merchant_c1_done flag', () => {
  const template = findTemplate('trd_1_survey');
  const mission = makeCompletedMission('trd_1_survey');
  const state = makeState({ missionsActive: [mission] });
  const content: MissionContentDef = { templates: [template], eventCards: [] };
  const { effects } = settleCompletedMissions(state, content);
  const flagEffect = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'merchant_c1_done' && e.value === true,
  );
  assert.ok(flagEffect, 'merchant_c1_done should be set on success');
});

test('trd_3_monopoly success: sets merchant_chain_complete flag', () => {
  const template = findTemplate('trd_3_monopoly');
  const mission = makeCompletedMission('trd_3_monopoly', 3);
  const state = makeState({
    missionsActive: [mission],
    flags: { merchant_c2_done: true },
  });
  const content: MissionContentDef = { templates: [template], eventCards: [] };
  const { effects } = settleCompletedMissions(state, content);
  const flagEffect = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'merchant_chain_complete' && e.value === true,
  );
  assert.ok(flagEffect, 'merchant_chain_complete should be set on success');
});

test('trd_2_caravan has supplyCost food:5', () => {
  const t = findTemplate('trd_2_caravan');
  assert.equal(t.supplyCost?.food, 5);
});

test('trd_3_monopoly has supplyCost food:10', () => {
  const t = findTemplate('trd_3_monopoly');
  assert.equal(t.supplyCost?.food, 10);
});

// ── §3: 大会备战链 (3 steps) ──────────────────────────────────────────────────

console.log('\n§3 大会备战链');

test('tc_1_intel exists with completionFlag tourney_c1_done', () => {
  const t = findTemplate('tc_1_intel');
  assert.equal(t.completionFlag, 'tourney_c1_done');
  assert.ok(!t.unlockCondition || t.unlockCondition.length === 0);
});

test('tc_2_recruit requires tourney_c1_done flag', () => {
  const t = findTemplate('tc_2_recruit');
  assert.ok(t.unlockCondition && t.unlockCondition.length > 0);
  assert.equal(t.unlockCondition![0].field, 'flags.tourney_c1_done');
});

test('tc_3_qualify requires tourney_c2_done and emits tourney_chain_complete', () => {
  const t = findTemplate('tc_3_qualify');
  assert.ok(t.unlockCondition && t.unlockCondition.length > 0);
  assert.equal(t.unlockCondition![0].field, 'flags.tourney_c2_done');
  assert.equal(t.completionFlag, 'tourney_chain_complete');
});

test('tc_2_recruit: canDispatch fails without tourney_c1_done', () => {
  const state = makeState();
  const t = findTemplate('tc_2_recruit');
  const result = canDispatch(state, [t], t.id, ['d1'], evaluator);
  assert.ok(!result.valid, 'should be locked without tourney_c1_done');
});

test('tc_2_recruit: canDispatch unlock differs when flag is set', () => {
  const t = findTemplate('tc_2_recruit');
  const noFlag = canDispatch(makeState(), [t], t.id, ['d1'], evaluator);
  const withFlag = canDispatch(makeState({ flags: { tourney_c1_done: true } }), [t], t.id, ['d1'], evaluator);
  // Without flag: unlock condition fails
  assert.ok(!noFlag.valid, 'should fail without flag');
  // With flag: either valid or fails for a different reason (party size)
  assert.ok(withFlag.valid || withFlag.reason !== noFlag.reason,
    'reason should differ after flag is set');
});

test('tc_1_intel success: sets tourney_c1_done flag', () => {
  const template = findTemplate('tc_1_intel');
  const mission = makeCompletedMission('tc_1_intel');
  const state = makeState({ missionsActive: [mission] });
  const content: MissionContentDef = { templates: [template], eventCards: [] };
  const { effects } = settleCompletedMissions(state, content);
  const flagEffect = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'tourney_c1_done' && e.value === true,
  );
  assert.ok(flagEffect, 'tourney_c1_done should be set on success');
});

test('tc_3_qualify success: sets tourney_chain_complete flag', () => {
  const template = findTemplate('tc_3_qualify');
  const mission = makeCompletedMission('tc_3_qualify', 2);
  const state = makeState({
    missionsActive: [mission],
    flags: { tourney_c2_done: true },
  });
  const content: MissionContentDef = { templates: [template], eventCards: [] };
  const { effects } = settleCompletedMissions(state, content);
  const flagEffect = effects.find(
    (e) => e.type === 'set_flag' && e.key === 'tourney_chain_complete' && e.value === true,
  );
  assert.ok(flagEffect, 'tourney_chain_complete should be set on success');
});

// ── §4: 全链贯通测试 ──────────────────────────────────────────────────────────

console.log('\n§4 全链贯通');

test('完整正道链：step1→2→3→4 flag 逐步解锁', () => {
  const steps = ['rc_1_patrol', 'rc_2_rescue', 'rc_3_siege', 'rc_4_alliance'];
  const flags = ['righteous_c1_done', 'righteous_c2_done', 'righteous_c3_done', 'righteous_chain_complete'];
  const templates = steps.map(findTemplate);
  const content: MissionContentDef = { templates, eventCards: [] };

  let state = makeState();
  for (let i = 0; i < steps.length; i++) {
    const mission = makeCompletedMission(steps[i], templates[i].minPartySize);
    state = { ...state, missionsActive: [mission] };
    const { effects } = settleCompletedMissions(state, content);
    const flagEffect = effects.find(
      (e) => e.type === 'set_flag' && e.key === flags[i] && e.value === true,
    );
    assert.ok(flagEffect, `Step ${i + 1}: ${flags[i]} should be set`);
    // Apply flag to state for next step
    state = { ...state, missionsActive: [], flags: { ...state.flags, [flags[i]]: true } };
    // Verify next step is now unlockable (if not last)
    if (i + 1 < steps.length) {
      const nt = templates[i + 1];
      const nextResult = canDispatch(state, [nt], nt.id, ['d1'], evaluator);
      assert.ok(!nextResult.reason?.includes('未解锁'), `Step ${i + 2} should be unlocked after step ${i + 1}`);
    }
  }
  assert.ok(state.flags['righteous_chain_complete'] === true, 'Chain should be complete');
});

test('完整商盟链：survey→caravan→monopoly flag 逐步解锁', () => {
  const steps = ['trd_1_survey', 'trd_2_caravan', 'trd_3_monopoly'];
  const flags = ['merchant_c1_done', 'merchant_c2_done', 'merchant_chain_complete'];
  const templates = steps.map(findTemplate);
  const content: MissionContentDef = { templates, eventCards: [] };

  let state = makeState();
  for (let i = 0; i < steps.length; i++) {
    const mission = makeCompletedMission(steps[i], templates[i].minPartySize);
    state = { ...state, missionsActive: [mission] };
    const { effects } = settleCompletedMissions(state, content);
    const flagEffect = effects.find(
      (e) => e.type === 'set_flag' && e.key === flags[i] && e.value === true,
    );
    assert.ok(flagEffect, `Step ${i + 1}: ${flags[i]} should be set`);
    state = { ...state, missionsActive: [], flags: { ...state.flags, [flags[i]]: true } };
  }
  assert.ok(state.flags['merchant_chain_complete'] === true, 'Merchant chain should be complete');
});

test('完整大会链：intel→recruit→qualify flag 逐步解锁', () => {
  const steps = ['tc_1_intel', 'tc_2_recruit', 'tc_3_qualify'];
  const flags = ['tourney_c1_done', 'tourney_c2_done', 'tourney_chain_complete'];
  const templates = steps.map(findTemplate);
  const content: MissionContentDef = { templates, eventCards: [] };

  let state = makeState();
  for (let i = 0; i < steps.length; i++) {
    const mission = makeCompletedMission(steps[i], templates[i].minPartySize);
    state = { ...state, missionsActive: [mission] };
    const { effects } = settleCompletedMissions(state, content);
    const flagEffect = effects.find(
      (e) => e.type === 'set_flag' && e.key === flags[i] && e.value === true,
    );
    assert.ok(flagEffect, `Step ${i + 1}: ${flags[i]} should be set`);
    state = { ...state, missionsActive: [], flags: { ...state.flags, [flags[i]]: true } };
  }
  assert.ok(state.flags['tourney_chain_complete'] === true, 'Tournament chain should be complete');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
