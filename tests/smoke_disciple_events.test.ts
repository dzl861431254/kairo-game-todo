/**
 * Smoke tests — Disciple personal events (processDiscipleEvents)
 *
 * Run: npx tsx tests/smoke_disciple_events.test.ts
 */

import assert from 'node:assert/strict';
import { processDiscipleEvents } from '../src/runtime/systems/event/manager.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { createRNG } from '../src/runtime/rng.js';
import { makeInitialState, makeEmptyContentDB, loadRealContentDB } from './fixtures.js';
import type { DiscipleEventDef, EventContentDef } from '../src/runtime/systems/event/types.js';
import type { GameState } from '../src/runtime/turn_engine/types.js';

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

function makeDiscipleEvent(overrides: Partial<DiscipleEventDef> = {}): DiscipleEventDef {
  return {
    id: 'de_test',
    name: '测试弟子事件',
    description: '测试用',
    weight: 10,
    cooldownMonths: 0,
    once: false,
    options: [
      {
        id: 'opt1',
        text: '接受',
        effects: [
          { type: 'disciple_stat_delta', discipleId: '__target__', stat: 'physique', delta: 5, reason: '测试' },
        ],
      },
    ],
    ...overrides,
  };
}

function makeContent(discipleEvents: DiscipleEventDef[] = []): EventContentDef {
  return { events: [], annualChains: [], discipleEvents };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n── smoke_disciple_events ───────────────────────────────────\n');

// Empty cases

test('returns empty when no discipleEvents in content', () => {
  const state = makeState();
  const content = makeContent([]);
  const rng = createRNG(1);
  const result = processDiscipleEvents(state, content, rng);
  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.resolutions, []);
});

test('returns empty when content.discipleEvents is undefined', () => {
  const state = makeState();
  const content: EventContentDef = { events: [], annualChains: [] }; // no discipleEvents key
  const rng = createRNG(1);
  const result = processDiscipleEvents(state, content, rng);
  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.resolutions, []);
});

test('returns empty when state has no disciples', () => {
  const state = makeState({ disciples: [] });
  const content = makeContent([makeDiscipleEvent()]);
  const rng = createRNG(1);
  const result = processDiscipleEvents(state, content, rng);
  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.resolutions, []);
});

// Target substitution

test('__target__ is substituted with actual disciple id', () => {
  const state = makeState(); // has disciple d1
  const content = makeContent([makeDiscipleEvent()]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  // Find the disciple_stat_delta effect
  const statEffect = result.effects.find((e) => e.type === 'disciple_stat_delta');
  assert.ok(statEffect, 'should have disciple_stat_delta effect');
  if (statEffect && statEffect.type === 'disciple_stat_delta') {
    assert.notEqual(statEffect.discipleId, '__target__', '__target__ should be replaced');
    assert.equal(statEffect.discipleId, 'd1', 'should be replaced with actual disciple id');
  }
});

test('payloadEffects also have __target__ substituted', () => {
  const state = makeState();
  const content = makeContent([makeDiscipleEvent()]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  assert.equal(result.resolutions.length, 1);
  const resolution = result.resolutions[0];
  const statEffect = resolution.payloadEffects.find((e) => e.type === 'disciple_stat_delta');
  assert.ok(statEffect);
  if (statEffect && statEffect.type === 'disciple_stat_delta') {
    assert.equal(statEffect.discipleId, 'd1');
  }
});

// Meta

test('resolution meta has source === "disciple_event"', () => {
  const state = makeState();
  const content = makeContent([makeDiscipleEvent()]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  assert.equal(result.resolutions.length, 1);
  assert.equal(result.resolutions[0].meta?.source, 'disciple_event');
});

test('resolution meta has targetDiscipleId set', () => {
  const state = makeState();
  const content = makeContent([makeDiscipleEvent()]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  assert.equal(result.resolutions.length, 1);
  assert.equal(result.resolutions[0].meta?.targetDiscipleId, 'd1');
});

// Cooldown flag

test('emits disciple_event_last flag effect', () => {
  const state = makeState();
  const content = makeContent([makeDiscipleEvent({ id: 'de_cooldown_test' })]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  const flagEffect = result.effects.find(
    (e) => e.type === 'set_flag' && e.key === 'disciple_event_last:de_cooldown_test',
  );
  assert.ok(flagEffect, 'should emit cooldown flag');
});

test('cooldown: event not eligible when within cooldown window', () => {
  const ev = makeDiscipleEvent({ id: 'de_cooldown', cooldownMonths: 3 });
  const state = makeState({
    monthIndex: 5,
    flags: { 'disciple_event_last:de_cooldown': 4 }, // last triggered at month 4 (elapsed=1 < 3)
  });
  const content = makeContent([ev]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  assert.deepEqual(result.effects, [], 'should not trigger during cooldown');
});

test('cooldown: event eligible after cooldown expires', () => {
  const ev = makeDiscipleEvent({ id: 'de_cooldown2', cooldownMonths: 3 });
  const state = makeState({
    monthIndex: 10,
    flags: { 'disciple_event_last:de_cooldown2': 5 }, // elapsed=5 >= 3
  });
  const content = makeContent([ev]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  assert.ok(result.effects.length > 0, 'should trigger after cooldown');
});

// Once flag

test('once event: emits triggered flag', () => {
  const ev = makeDiscipleEvent({ id: 'de_once_test', once: true });
  const state = makeState();
  const content = makeContent([ev]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  const flagEffect = result.effects.find(
    (e) => e.type === 'set_flag' && e.key === 'disciple_event_triggered:de_once_test',
  );
  assert.ok(flagEffect, 'should emit once-triggered flag');
});

test('once event: not eligible after triggered flag set', () => {
  const ev = makeDiscipleEvent({ id: 'de_once_used', once: true });
  const state = makeState({ flags: { 'disciple_event_triggered:de_once_used': true } });
  const content = makeContent([ev]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  assert.deepEqual(result.effects, [], 'once event should not re-trigger');
});

// weight=0 skip

test('event with weight 0 is skipped', () => {
  const ev = makeDiscipleEvent({ id: 'de_zero_weight', weight: 0 });
  const state = makeState();
  const content = makeContent([ev]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  assert.deepEqual(result.effects, [], 'weight=0 event should not trigger');
});

// Multiple effects types substituted

test('disciple_status_add __target__ is substituted', () => {
  const ev = makeDiscipleEvent({
    id: 'de_status_test',
    options: [
      {
        id: 'opt1',
        text: '接受',
        effects: [
          { type: 'disciple_status_add', discipleId: '__target__', statusId: 'injured', reason: '测试' },
        ],
      },
    ],
  });
  const state = makeState();
  const content = makeContent([ev]);
  const rng = createRNG(42);
  const result = processDiscipleEvents(state, content, rng);
  const statusEffect = result.effects.find((e) => e.type === 'disciple_status_add');
  assert.ok(statusEffect);
  if (statusEffect && statusEffect.type === 'disciple_status_add') {
    assert.equal(statusEffect.discipleId, 'd1');
  }
});

// TurnEngine integration

test('TurnEngine: disciple stat changes via disciple event (real content)', () => {
  const contentDB = loadRealContentDB();
  // Find a disciple stat delta event in discipleEvents
  const discipleEvents = contentDB.events.discipleEvents ?? [];
  assert.ok(discipleEvents.length > 0, 'real content should have discipleEvents');

  // Run 12 months and check that some disciple events fired (flags set)
  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
  let state = makeInitialState(99);

  let discipleEventFired = false;
  for (let i = 0; i < 12; i++) {
    const { nextState } = engine.executeTurn(state, contentDB, {});
    state = nextState;
    // Check for any disciple_event_last flags
    const flagKeys = Object.keys(state.flags);
    if (flagKeys.some((k) => k.startsWith('disciple_event_last:'))) {
      discipleEventFired = true;
      break;
    }
  }
  assert.ok(discipleEventFired, 'at least one disciple event should have fired in 12 months');
});

test('TurnEngine: report.eventsTriggered grows as disciple events fire (real content)', () => {
  const contentDB = loadRealContentDB();
  const discipleEvents = contentDB.events.discipleEvents ?? [];
  assert.ok(discipleEvents.length > 0, 'real content should have discipleEvents');

  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
  let state = makeInitialState(7);

  let totalEventsTriggered = 0;
  for (let i = 0; i < 12; i++) {
    const { nextState, report } = engine.executeTurn(state, contentDB, {});
    state = nextState;
    totalEventsTriggered += report.eventsTriggered.length;
  }
  // With 12 months, inner events + disciple events should have fired multiple times
  assert.ok(totalEventsTriggered > 0, 'at least some events should appear in report.eventsTriggered over 12 months');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
