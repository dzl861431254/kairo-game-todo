/**
 * Smoke tests — Event system (inner events, annual chains, faction thresholds)
 *
 * Run: npx tsx tests/smoke_events.test.ts
 */

import assert from 'node:assert/strict';
import { isEventEligible, processAnnualChains, processInnerEvent } from '../src/runtime/systems/event/manager.js';
import { processFactionThresholds } from '../src/runtime/systems/faction/manager.js';
import { checkFactionThresholds, resolveCrossingEvents } from '../src/runtime/systems/faction/faction_events.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { createRNG } from '../src/runtime/rng.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { EventDef } from '../src/runtime/systems/event/types.js';
import type { EventContentDef } from '../src/runtime/systems/event/types.js';
import type { Faction, GameState } from '../src/runtime/turn_engine/types.js';

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

function makeEvent(overrides: Partial<EventDef> = {}): EventDef {
  return {
    id: 'ev_test',
    name: '测试事件',
    description: '测试',
    conditions: [],
    weight: 10,
    cooldownMonths: 0,
    once: false,
    options: [{ id: 'opt1', text: '接受', effects: [] }],
    ...overrides,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return { ...makeInitialState(), ...overrides };
}

function makeContent(events: EventDef[] = [], extra: Partial<EventContentDef> = {}): EventContentDef {
  return { events, annualChains: [], ...extra };
}

// ── isEventEligible ───────────────────────────────────────────────────────────

console.log('\n── smoke_events ─────────────────────────────────────────\n');

test('once event: eligible on first check', () => {
  const state = makeState();
  const event = makeEvent({ once: true });
  assert.ok(isEventEligible(state, event, evaluator));
});

test('once event: NOT eligible after trigger flag set', () => {
  const event = makeEvent({ once: true });
  const state = makeState({ flags: { [`event_triggered:${event.id}`]: true } });
  assert.ok(!isEventEligible(state, event, evaluator));
});

test('cooldown: eligible when no previous trigger', () => {
  const state = makeState();
  const event = makeEvent({ cooldownMonths: 6 });
  assert.ok(isEventEligible(state, event, evaluator));
});

test('cooldown: NOT eligible within cooldown window', () => {
  const event = makeEvent({ cooldownMonths: 6 });
  // monthIndex=5, last triggered at month 0 → elapsed=5 < 6
  const state = makeState({
    monthIndex: 5,
    flags: { [`event_last:${event.id}`]: 0 },
  });
  assert.ok(!isEventEligible(state, event, evaluator));
});

test('cooldown: eligible once cooldown expires', () => {
  const event = makeEvent({ cooldownMonths: 6 });
  // monthIndex=10, last triggered at month 0 → elapsed=10 >= 6
  const state = makeState({
    monthIndex: 10,
    flags: { [`event_last:${event.id}`]: 0 },
  });
  assert.ok(isEventEligible(state, event, evaluator));
});

test('condition check: blocks ineligible event', () => {
  const event = makeEvent({
    conditions: [{ field: 'resources.silver', op: 'gte', value: 9999 }],
  });
  const state = makeState(); // silver = 1000
  assert.ok(!isEventEligible(state, event, evaluator));
});

test('condition check: passes when condition met', () => {
  const event = makeEvent({
    conditions: [{ field: 'resources.silver', op: 'gte', value: 100 }],
  });
  const state = makeState(); // silver = 1000 >= 100
  assert.ok(isEventEligible(state, event, evaluator));
});

// ── processAnnualChains ───────────────────────────────────────────────────────

test('annual chain: triggers at correct month (stageIndex 0)', () => {
  const state = makeState({ monthIndex: 2 }); // month 2 = March
  const content = makeContent(
    [makeEvent({ id: 'chain_ev_0' })],
    {
      annualChains: [{
        id: 'chain1',
        name: '主线',
        description: '测试链',
        triggerMonth: 2,
        stages: [{ stageIndex: 0, eventId: 'chain_ev_0' }],
      }],
    },
  );
  const rng = createRNG(1);
  const result = processAnnualChains(state, content, evaluator, rng);
  assert.ok(result.effects.length > 0, 'expected chain to trigger');
  // flag for progress should be set to 1
  const progressFlag = result.effects.find(
    e => e.type === 'set_flag' && e.key === 'annual_chain:chain1',
  );
  assert.ok(progressFlag, 'progress flag not found');
  assert.equal((progressFlag as { value: number }).value, 1);
});

test('annual chain: does NOT trigger at wrong month', () => {
  const state = makeState({ monthIndex: 5 }); // wrong month
  const content = makeContent(
    [makeEvent({ id: 'chain_ev_0' })],
    {
      annualChains: [{
        id: 'chain1',
        name: '主线',
        description: '',
        triggerMonth: 2,
        stages: [{ stageIndex: 0, eventId: 'chain_ev_0' }],
      }],
    },
  );
  const rng = createRNG(1);
  const result = processAnnualChains(state, content, evaluator, rng);
  assert.equal(result.effects.length, 0);
});

test('annual chain: completionFlag set on last stage', () => {
  // Already at progress=0 (last stage), triggerMonth=2, monthIndex=2
  const state = makeState({ monthIndex: 2 });
  const content = makeContent(
    [makeEvent({ id: 'final_ev' })],
    {
      annualChains: [{
        id: 'chain_final',
        name: '最终链',
        description: '',
        triggerMonth: 2,
        completionFlag: 'main_done',
        stages: [{ stageIndex: 0, eventId: 'final_ev' }],
      }],
    },
  );
  const rng = createRNG(1);
  const result = processAnnualChains(state, content, evaluator, rng);
  const completionFlag = result.effects.find(
    e => e.type === 'set_flag' && e.key === 'main_done',
  );
  assert.ok(completionFlag, 'completionFlag not emitted');
  const chainCompleteFlag = result.effects.find(
    e => e.type === 'set_flag' && e.key === 'chain_complete:chain_final',
  );
  assert.ok(chainCompleteFlag, 'chain_complete flag not emitted');
});

test('annual chain: stageFlag set when stage has stageFlag', () => {
  const state = makeState({ monthIndex: 3 });
  const content = makeContent(
    [makeEvent({ id: 'stage_ev' })],
    {
      annualChains: [{
        id: 'chain_sf',
        name: '阶段flag链',
        description: '',
        triggerMonth: 3,
        stages: [{ stageIndex: 0, eventId: 'stage_ev', stageFlag: 'stage_0_done' }],
      }],
    },
  );
  const rng = createRNG(1);
  const result = processAnnualChains(state, content, evaluator, rng);
  const stageFlag = result.effects.find(
    e => e.type === 'set_flag' && e.key === 'stage_0_done',
  );
  assert.ok(stageFlag, 'stageFlag not emitted');
});

test('annual chain: resolution tagged with meta.source = annual_chain', () => {
  const state = makeState({ monthIndex: 0 });
  const content = makeContent(
    [makeEvent({ id: 'tagged_ev' })],
    {
      annualChains: [{
        id: 'chain_meta',
        name: '元数据链',
        description: '',
        triggerMonth: 0,
        stages: [{ stageIndex: 0, eventId: 'tagged_ev' }],
      }],
    },
  );
  const rng = createRNG(1);
  const result = processAnnualChains(state, content, evaluator, rng);
  assert.equal(result.resolutions.length, 1);
  assert.equal(result.resolutions[0].meta?.source, 'annual_chain');
  assert.equal(result.resolutions[0].meta?.chainId, 'chain_meta');
  assert.equal(result.resolutions[0].meta?.stageIndex, 0);
});

// ── processFactionThresholds ──────────────────────────────────────────────────

test('faction threshold: triggers at ≥60', () => {
  const state = makeState({ factions: { wudang: 65 } });
  const content: EventContentDef = {
    events: [makeEvent({ id: 'alliance_ev', weight: 0 })],
    annualChains: [],
    factionThresholdEvents: [{
      factionId: 'wudang',
      threshold: 60,
      comparison: 'gte',
      eventId: 'alliance_ev',
      cooldownMonths: 0,
    }],
  };
  const rng = createRNG(1);
  const result = processFactionThresholds(state, content, rng);
  assert.equal(result.resolutions.length, 1);
  assert.equal(result.resolutions[0].eventId, 'alliance_ev');
  assert.equal(result.resolutions[0].meta?.source, 'faction_threshold');
});

test('faction threshold: does NOT trigger below threshold', () => {
  const state = makeState({ factions: { wudang: 55 } });
  const content: EventContentDef = {
    events: [makeEvent({ id: 'alliance_ev', weight: 0 })],
    annualChains: [],
    factionThresholdEvents: [{
      factionId: 'wudang',
      threshold: 60,
      comparison: 'gte',
      eventId: 'alliance_ev',
      cooldownMonths: 0,
    }],
  };
  const rng = createRNG(1);
  const result = processFactionThresholds(state, content, rng);
  assert.equal(result.resolutions.length, 0);
});

test('faction threshold ≤-60: triggers at -70', () => {
  const state = makeState({ factions: { imperial: -70 } });
  const content: EventContentDef = {
    events: [makeEvent({ id: 'siege_ev', weight: 0 })],
    annualChains: [],
    factionThresholdEvents: [{
      factionId: 'imperial',
      threshold: -60,
      comparison: 'lte',
      eventId: 'siege_ev',
      cooldownMonths: 6,
    }],
  };
  const rng = createRNG(1);
  const result = processFactionThresholds(state, content, rng);
  assert.equal(result.resolutions.length, 1);
});

test('faction threshold: respects cooldown (cooldownMonths=0 → once)', () => {
  // cooldown=0 means once-only; if flag already set, skip
  const cooldownKey = 'faction_threshold:wudang:gte:60:last';
  const state = makeState({
    factions: { wudang: 70 },
    flags: { [cooldownKey]: 0 }, // already triggered at month 0
  });
  const content: EventContentDef = {
    events: [makeEvent({ id: 'alliance_ev', weight: 0 })],
    annualChains: [],
    factionThresholdEvents: [{
      factionId: 'wudang',
      threshold: 60,
      comparison: 'gte',
      eventId: 'alliance_ev',
      cooldownMonths: 0,
    }],
  };
  const rng = createRNG(1);
  const result = processFactionThresholds(state, content, rng);
  assert.equal(result.resolutions.length, 0, 'should not re-trigger when cooldown=0 and already fired');
});

test('faction threshold: respects cooldownMonths>0', () => {
  const cooldownKey = 'faction_threshold:imperial:lte:-60:last';
  const state = makeState({
    monthIndex: 3,
    factions: { imperial: -80 },
    flags: { [cooldownKey]: 1 }, // triggered at month 1 → elapsed=2 < cooldown=6
  });
  const content: EventContentDef = {
    events: [makeEvent({ id: 'siege_ev', weight: 0 })],
    annualChains: [],
    factionThresholdEvents: [{
      factionId: 'imperial',
      threshold: -60,
      comparison: 'lte',
      eventId: 'siege_ev',
      cooldownMonths: 6,
    }],
  };
  const rng = createRNG(1);
  const result = processFactionThresholds(state, content, rng);
  assert.equal(result.resolutions.length, 0, 'should not trigger within cooldown');
});

test('inner event resolution tagged with meta.source = inner', () => {
  const state = makeState();
  const content = makeContent([makeEvent({ id: 'inner_ev', weight: 10 })]);
  const rng = createRNG(1);
  const result = processInnerEvent(state, content, evaluator, rng);
  if (result.resolutions.length > 0) {
    assert.equal(result.resolutions[0].meta?.source, 'inner');
  }
  // (may be 0 if rng selected no event — just verify it doesn't crash)
  assert.ok(Array.isArray(result.resolutions));
});

// ── checkFactionThresholds (crossing detection) ────────────────────────────────

const factionDefs: Faction[] = [
  {
    id: 'faction.righteous',
    name: '正道盟',
    relation: 10,
    preferences: { labels: ['qing'] },
    thresholds: { friendly: 60, hostile: -60 },
  },
  {
    id: 'faction.demon',
    name: '魔教',
    relation: -20,
    preferences: { labels: ['xie'] },
    thresholds: { friendly: 60, hostile: -60 },
  },
];

test('checkFactionThresholds: detects friendly crossing (55 → 62)', () => {
  const prev = { 'faction.righteous': 55 };
  const next = { 'faction.righteous': 62 };
  const results = checkFactionThresholds(prev, next, factionDefs);
  const r = results.find(c => c.factionId === 'faction.righteous');
  assert.equal(r?.crossed, 'friendly');
  assert.equal(r?.newRelation, 62);
});

test('checkFactionThresholds: detects hostile crossing (-55 → -65)', () => {
  const prev = { 'faction.demon': -55 };
  const next = { 'faction.demon': -65 };
  const results = checkFactionThresholds(prev, next, factionDefs);
  const r = results.find(c => c.factionId === 'faction.demon');
  assert.equal(r?.crossed, 'hostile');
});

test('checkFactionThresholds: no crossing when already above threshold', () => {
  // Was already at 65, stays at 70 — no crossing this turn
  const prev = { 'faction.righteous': 65 };
  const next = { 'faction.righteous': 70 };
  const results = checkFactionThresholds(prev, next, factionDefs);
  const r = results.find(c => c.factionId === 'faction.righteous');
  assert.equal(r?.crossed, null);
});

test('checkFactionThresholds: no crossing when threshold not reached', () => {
  const prev = { 'faction.righteous': 40 };
  const next = { 'faction.righteous': 58 };
  const results = checkFactionThresholds(prev, next, factionDefs);
  const r = results.find(c => c.factionId === 'faction.righteous');
  assert.equal(r?.crossed, null);
});

test('resolveCrossingEvents: emits event + cooldown flag on friendly crossing', () => {
  const crossings = [{ factionId: 'faction.righteous', crossed: 'friendly' as const, newRelation: 65 }];
  const state: GameState = { ...makeInitialState(), factions: { 'faction.righteous': 65 }, flags: {} };
  const content: EventContentDef = {
    events: [makeEvent({ id: 'ally_ev', weight: 0 })],
    annualChains: [],
    factionThresholdEvents: [{
      factionId: 'faction.righteous', threshold: 60, comparison: 'gte',
      eventId: 'ally_ev', cooldownMonths: 0,
    }],
  };
  const rng = createRNG(1);
  const result = resolveCrossingEvents(crossings, factionDefs, state, content, rng);
  assert.equal(result.resolutions.length, 1, 'expected one event resolution');
  assert.equal(result.resolutions[0].eventId, 'ally_ev');
  assert.equal(result.resolutions[0].meta?.source, 'faction_threshold');
  const cooldownEffect = result.effects.find(
    e => e.type === 'set_flag' && (e as { key: string }).key.startsWith('faction_threshold:faction.righteous'),
  );
  assert.ok(cooldownEffect, 'cooldown flag not emitted');
});

test('resolveCrossingEvents: skips when no matching factionThresholdEvent def', () => {
  const crossings = [{ factionId: 'faction.righteous', crossed: 'friendly' as const, newRelation: 65 }];
  const state: GameState = { ...makeInitialState(), factions: { 'faction.righteous': 65 }, flags: {} };
  // No factionThresholdEvents defined
  const content: EventContentDef = { events: [], annualChains: [] };
  const rng = createRNG(1);
  const result = resolveCrossingEvents(crossings, factionDefs, state, content, rng);
  assert.equal(result.resolutions.length, 0);
});

test('resolveCrossingEvents: skips when cooldown already set (no double-trigger)', () => {
  const ck = 'faction_threshold:faction.righteous:gte:60:last';
  const crossings = [{ factionId: 'faction.righteous', crossed: 'friendly' as const, newRelation: 65 }];
  const state: GameState = {
    ...makeInitialState(),
    factions: { 'faction.righteous': 65 },
    flags: { [ck]: 0 },  // already triggered
  };
  const content: EventContentDef = {
    events: [makeEvent({ id: 'ally_ev', weight: 0 })],
    annualChains: [],
    factionThresholdEvents: [{ factionId: 'faction.righteous', threshold: 60, comparison: 'gte', eventId: 'ally_ev', cooldownMonths: 0 }],
  };
  const rng = createRNG(1);
  const result = resolveCrossingEvents(crossings, factionDefs, state, content, rng);
  assert.equal(result.resolutions.length, 0, 'should not double-trigger');
});

test('engine: crossing detection fires event when faction crosses threshold via mission', () => {
  // Faction starts at 55; a completed mission adds +10 → 65 (crosses 60 threshold)
  const state: GameState = {
    ...makeInitialState(),
    factions: { 'faction.righteous': 55 },
    missionsActive: [{
      id: 'm_cross',
      templateId: 'mission_cross',
      remainingMonths: 0,
      partyDiscipleIds: ['d1'],
      supplies: {},
      state: { eventsResolved: [{ cardId: 'c1', success: true }] },
    }],
  };

  const missionTemplate = {
    id: 'mission_cross', name: '跨越测试', description: '',
    category: 'test', durationMonths: 1, minPartySize: 1, recommendedPower: 0,
    rewards: [{ type: 'faction_relation_delta' as const, factionId: 'faction.righteous', delta: 10, reason: '完成任务' }],
    failPenalty: [],
    eventCardIds: [],
    factionId: 'faction.righteous',
  };

  const allyEvent: EventDef = makeEvent({ id: 'ally_ev', weight: 0 });
  const content = {
    ...makeEmptyContentDB(),
    missions: { templates: [missionTemplate], eventCards: [] },
    events: {
      events: [allyEvent],
      annualChains: [],
      factionThresholdEvents: [{
        factionId: 'faction.righteous', threshold: 60, comparison: 'gte' as const,
        eventId: 'ally_ev', cooldownMonths: 0,
      }],
    },
    factions: { factions: factionDefs },
  };

  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
  const { nextState, report } = engine.executeTurn(state, content, {});

  // Relation should be 55 + 10 (mission) = 65 (factionId auto-delta) + 10 (missionTemplate.factionId) = 75
  // Actually: mission success gives +10 (from rewards) + +10 (from factionId auto-delta) = 75
  // Or just 55 + 10 = 65 if factionId delta doesn't double count...
  // Let me check: the mission has rewards (faction_relation_delta +10) AND factionId (which adds +10)
  // So total = 55 + 10 (rewards) + 10 (factionId) = 75
  assert.ok(nextState.factions['faction.righteous']! >= 60, `relation should be ≥60, got ${nextState.factions['faction.righteous']}`);

  // The crossing event should appear in report
  const crossingEvent = report.eventsTriggered.find(e => e.eventId === 'ally_ev');
  assert.ok(crossingEvent, 'crossing event ally_ev should appear in report');
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  smoke_events: ${passed}/${passed + failed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  smoke_events: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
