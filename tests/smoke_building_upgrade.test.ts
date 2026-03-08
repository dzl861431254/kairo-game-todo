/**
 * Smoke tests — 建筑升级系统
 *
 * Run: npx tsx tests/smoke_building_upgrade.test.ts
 */

import assert from 'node:assert/strict';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import {
  checkUpgradeRequirements,
  startUpgrade,
  processBuildingUpgrades,
  getBuildingOutputMultiplier,
  getBuildingCapacity,
} from '../src/runtime/systems/building/upgrade.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { GameState } from '../src/runtime/turn_engine/types.js';
import type { ContentDB } from '../src/runtime/turn_engine/engine.js';
import type { BuildingDef } from '../src/runtime/systems/building/types.js';

// ── Test helpers ──

function makeEngine() {
  return new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
}

/** 构造包含升级数据的建筑定义 */
function makeUpgradableDef(): BuildingDef {
  return {
    id: 'test_dojo',
    name: '测试武馆',
    category: 'training',
    description: '',
    size: { w: 2, h: 2 },
    buildCost: { silver: 100 },
    maxLevel: 3,
    upgrades: [
      {
        toLevel: 2,
        cost: { currency: { silver: 300 }, inventories: {} },
        duration: 2,
        requirements: { reputation: 100 },
        duringUpgrade: { outputMultiplier: 0.5 },
      },
      {
        toLevel: 3,
        cost: { currency: { silver: 800 }, inventories: { herbs: 50 } },
        duration: 3,
        requirements: { reputation: 300, discipleMinRealm: 'qi_sense' },
        duringUpgrade: { outputMultiplier: 0.3 },
      },
    ],
    levelEffects: {
      '1': { outputMultiplier: 1.0, capacityBonus: 0 },
      '2': { outputMultiplier: 1.3, capacityBonus: 1 },
      '3': { outputMultiplier: 1.6, capacityBonus: 2 },
    },
    levels: [
      { level: 1, workSlots: 2, effectsStatic: [], productionFlat: [], workerEffects: [], upkeep: [] },
      { level: 2, workSlots: 2, effectsStatic: [], productionFlat: [], workerEffects: [], upkeep: [] },
      { level: 3, workSlots: 2, effectsStatic: [], productionFlat: [], workerEffects: [], upkeep: [] },
    ],
  };
}

/** 构造有测试建筑的状态 */
function makeStateWithBuilding(overrides?: Partial<{
  silver: number;
  reputation: number;
  level: number;
  upgrading: GameState['grid']['placedBuildings'][string]['upgrading'];
}>): { state: GameState; db: ContentDB } {
  const base = makeInitialState();
  const db = makeEmptyContentDB();
  const def = makeUpgradableDef();
  db.buildings = { buildings: [def] };

  const state = {
    ...base,
    resources: {
      ...base.resources,
      silver: overrides?.silver ?? 1000,
      reputation: overrides?.reputation ?? 200,
    },
    grid: {
      ...base.grid,
      placedBuildings: {
        'b_0_0': {
          id: 'b_0_0',
          defId: 'test_dojo',
          x: 0,
          y: 0,
          level: overrides?.level ?? 1,
          upgrading: overrides?.upgrading,
        },
      },
    },
  };
  return { state, db };
}

// ── Test runner ──

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

console.log('\n── smoke_building_upgrade ────────────────────────────────\n');

// ── checkUpgradeRequirements ──

test('checkUpgradeRequirements: 正常条件可升级', () => {
  const { state, db } = makeStateWithBuilding({ silver: 1000, reputation: 200 });
  const check = checkUpgradeRequirements('b_0_0', state, db);
  assert.equal(check.canUpgrade, true);
  assert.equal(check.blockers.length, 0);
});

test('checkUpgradeRequirements: 已达最高级无法升级', () => {
  const { state, db } = makeStateWithBuilding({ level: 3 });
  const check = checkUpgradeRequirements('b_0_0', state, db);
  assert.equal(check.canUpgrade, false);
  assert.ok(check.blockers.some(b => b.type === 'max_level'));
});

test('checkUpgradeRequirements: 银两不足被阻止', () => {
  const { state, db } = makeStateWithBuilding({ silver: 50, reputation: 200 });
  const check = checkUpgradeRequirements('b_0_0', state, db);
  assert.equal(check.canUpgrade, false);
  assert.ok(check.blockers.some(b => b.type === 'resource' && b.key === 'silver'));
});

test('checkUpgradeRequirements: 声望不足被阻止', () => {
  const { state, db } = makeStateWithBuilding({ silver: 1000, reputation: 50 });
  const check = checkUpgradeRequirements('b_0_0', state, db);
  assert.equal(check.canUpgrade, false);
  assert.ok(check.blockers.some(b => b.type === 'reputation'));
});

test('checkUpgradeRequirements: 正在升级中被阻止', () => {
  const { state, db } = makeStateWithBuilding({
    upgrading: { targetLevel: 2, startMonth: 0, durationMonths: 2 },
  });
  const check = checkUpgradeRequirements('b_0_0', state, db);
  assert.equal(check.canUpgrade, false);
  assert.ok(check.blockers.some(b => b.type === 'already_upgrading'));
});

test('checkUpgradeRequirements: 无合格弟子境界被阻止', () => {
  // Lv2 → Lv3 requires qi_sense realm disciple
  const { state, db } = makeStateWithBuilding({ level: 2, silver: 2000, reputation: 400 });
  // No disciples — should be blocked
  const check = checkUpgradeRequirements('b_0_0', state, db);
  assert.equal(check.canUpgrade, false);
  assert.ok(check.blockers.some(b => b.type === 'disciple_realm'));
});

test('checkUpgradeRequirements: 库存不足被阻止', () => {
  const { state, db } = makeStateWithBuilding({ level: 2, silver: 2000, reputation: 400 });
  // qi_sense disciple present but zero herbs (override inventories)
  const stateNoHerbs = {
    ...state,
    resources: {
      ...state.resources,
      inventories: { ...state.resources.inventories, herbs: 0 },
    },
    disciples: [{
      id: 'd1', name: '测试弟子', stats: {}, statuses: [],
      trainingProgress: {}, realm: 'qi_sense' as const,
      realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'C' as const,
    }],
  };
  const check = checkUpgradeRequirements('b_0_0', stateNoHerbs, db);
  assert.equal(check.canUpgrade, false);
  assert.ok(check.blockers.some(b => b.type === 'resource' && b.key === 'herbs'));
});

test('checkUpgradeRequirements: 建筑不存在返回 max_level blocker', () => {
  const { state, db } = makeStateWithBuilding();
  const check = checkUpgradeRequirements('nonexistent', state, db);
  assert.equal(check.canUpgrade, false);
});

// ── startUpgrade ──

test('startUpgrade: 正确消耗银两', () => {
  const def = makeUpgradableDef();
  const effects = startUpgrade('b_0_0', { level: 1 }, def);
  const silverEffect = effects.find(e => e.type === 'currency_delta' && (e as { key: string }).key === 'silver');
  assert.ok(silverEffect, '应有 currency_delta silver');
  assert.equal((silverEffect as { delta: number }).delta, -300);
});

test('startUpgrade: 生成 building_upgrade_start effect', () => {
  const def = makeUpgradableDef();
  const effects = startUpgrade('b_0_0', { level: 1 }, def);
  const startEffect = effects.find(e => e.type === 'building_upgrade_start');
  assert.ok(startEffect, '应有 building_upgrade_start');
  const se = startEffect as { targetLevel: number; duration: number; instanceId: string };
  assert.equal(se.targetLevel, 2);
  assert.equal(se.duration, 2);
  assert.equal(se.instanceId, 'b_0_0');
});

test('startUpgrade: 消耗库存（Lv2→Lv3）', () => {
  const def = makeUpgradableDef();
  const effects = startUpgrade('b_0_0', { level: 2 }, def);
  const herbsEffect = effects.find(e => e.type === 'inventory_delta' && (e as { key: string }).key === 'herbs');
  assert.ok(herbsEffect, '应有 inventory_delta herbs');
  assert.equal((herbsEffect as { delta: number }).delta, -50);
});

test('startUpgrade: 无 upgrades 定义时返回空数组', () => {
  const def: BuildingDef = { ...makeUpgradableDef(), upgrades: undefined };
  const effects = startUpgrade('b_0_0', { level: 1 }, def);
  assert.equal(effects.length, 0);
});

// ── processBuildingUpgrades ──

test('processBuildingUpgrades: 倒计时未到不产出 effect', () => {
  const { state, db } = makeStateWithBuilding({
    upgrading: { targetLevel: 2, startMonth: 0, durationMonths: 2 },
  });
  // monthIndex = 0 → elapsed = 0 - 0 = 0 < 2
  const effects = processBuildingUpgrades(state, db.buildings.buildings);
  assert.equal(effects.length, 0);
});

test('processBuildingUpgrades: 完成时产出 building_upgrade effect', () => {
  const { state, db } = makeStateWithBuilding({
    upgrading: { targetLevel: 2, startMonth: 0, durationMonths: 2 },
  });
  // Simulate monthIndex advanced to 2 (elapsed >= duration)
  const advancedState = { ...state, monthIndex: 2 };
  const effects = processBuildingUpgrades(advancedState, db.buildings.buildings);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, 'building_upgrade');
  assert.equal((effects[0] as { instanceId: string }).instanceId, 'b_0_0');
});

test('processBuildingUpgrades: 无升级中建筑不产出 effect', () => {
  const { state, db } = makeStateWithBuilding();
  const effects = processBuildingUpgrades(state, db.buildings.buildings);
  assert.equal(effects.length, 0);
});

// ── getBuildingOutputMultiplier ──

test('getBuildingOutputMultiplier: 正常 Lv1 返回 1.0', () => {
  const def = makeUpgradableDef();
  const mult = getBuildingOutputMultiplier({ level: 1 }, def);
  assert.equal(mult, 1.0);
});

test('getBuildingOutputMultiplier: 升级中返回 duringUpgrade multiplier', () => {
  const def = makeUpgradableDef();
  const mult = getBuildingOutputMultiplier(
    { level: 1, upgrading: { targetLevel: 2, startMonth: 0, durationMonths: 2 } },
    def,
  );
  assert.equal(mult, 0.5);
});

test('getBuildingOutputMultiplier: Lv2 效果从 levelEffects 取', () => {
  const def = makeUpgradableDef();
  const mult = getBuildingOutputMultiplier({ level: 2 }, def);
  assert.equal(mult, 1.3);
});

// ── getBuildingCapacity ──

test('getBuildingCapacity: Lv1 无加成', () => {
  const def = makeUpgradableDef();
  const cap = getBuildingCapacity({ level: 1 }, def);
  assert.equal(cap, 2); // workSlots=2 + capacityBonus=0
});

test('getBuildingCapacity: Lv2 +1工位', () => {
  const def = makeUpgradableDef();
  const cap = getBuildingCapacity({ level: 2 }, def);
  assert.equal(cap, 3); // workSlots=2 + capacityBonus=1
});

test('getBuildingCapacity: Lv3 +2工位', () => {
  const def = makeUpgradableDef();
  const cap = getBuildingCapacity({ level: 3 }, def);
  assert.equal(cap, 4); // workSlots=2 + capacityBonus=2
});

// ── TurnEngine 集成 ──

test('TurnEngine: building_upgrade_start effect 正确设置 upgrading 字段', () => {
  const { state, db } = makeStateWithBuilding({ silver: 1000, reputation: 200 });
  const engine = makeEngine();

  const { nextState } = engine.executeTurn(state, db, {
    upgrade: [{ buildingInstanceId: 'b_0_0' }],
  });

  const building = nextState.grid.placedBuildings['b_0_0'];
  assert.ok(building.upgrading, '应有 upgrading 状态');
  assert.equal(building.upgrading!.targetLevel, 2);
  assert.equal(building.upgrading!.durationMonths, 2);
  assert.equal(building.level, 1, '等级在升级完成前不应变化');
});

test('TurnEngine: 升级期间银两被消耗', () => {
  const { state, db } = makeStateWithBuilding({ silver: 1000, reputation: 200 });
  const engine = makeEngine();

  const { nextState } = engine.executeTurn(state, db, {
    upgrade: [{ buildingInstanceId: 'b_0_0' }],
  });

  assert.ok(
    nextState.resources.silver < 1000,
    `银两应被消耗（升级费300银），当前: ${nextState.resources.silver}`,
  );
});

test('TurnEngine: 升级完成后等级提升并清除 upgrading', () => {
  // duration=2: 开始月 startMonth=0, 2个月后(monthIndex>=2)完成
  const { state: s0, db } = makeStateWithBuilding({ silver: 1000, reputation: 200 });
  const engine = makeEngine();

  // Turn 1: 开始升级。stagePre 设 startMonth=0, duration=2。
  //   月末 monthIndex→1, elapsed=1 < 2 → 未完成
  const { nextState: s1 } = engine.executeTurn(s0, db, {
    upgrade: [{ buildingInstanceId: 'b_0_0' }],
  });
  assert.equal(s1.grid.placedBuildings['b_0_0'].level, 1, 'Turn1结束后等级仍为1');
  assert.ok(s1.grid.placedBuildings['b_0_0'].upgrading, 'Turn1结束后upgrading已设置');

  // Turn 2: 月末 monthIndex→2, elapsed=2 >= 2 → 升级完成
  const { nextState: s2 } = engine.executeTurn(s1, db, {});
  const b2 = s2.grid.placedBuildings['b_0_0'];
  assert.equal(b2.level, 2, 'Turn2结束后等级应为2（duration=2个月后完成）');
  assert.equal(b2.upgrading, undefined, 'upgrading 应已清除');
});

test('TurnEngine: 升级中不可再次升级', () => {
  const { state: s0, db } = makeStateWithBuilding({ silver: 2000, reputation: 200 });
  const engine = makeEngine();

  // 开始第一次升级
  const { nextState: s1 } = engine.executeTurn(s0, db, {
    upgrade: [{ buildingInstanceId: 'b_0_0' }],
  });
  assert.ok(s1.grid.placedBuildings['b_0_0'].upgrading, '第一次升级应启动');

  // 再次尝试升级同一建筑（应被阻止）
  const silverBefore = s1.resources.silver;
  const { nextState: s2 } = engine.executeTurn(s1, db, {
    upgrade: [{ buildingInstanceId: 'b_0_0' }],
  });
  assert.equal(
    s2.resources.silver, silverBefore,
    '重复升级不应再次消耗银两',
  );
});

// ── 升级期间产出减半 ──

test('升级期间产出减半（productionFlat 应用 outputMultiplier）', () => {
  // 构造有 productionFlat 的建筑
  const db2 = makeEmptyContentDB();
  const defWithProd: BuildingDef = {
    ...makeUpgradableDef(),
    levels: [
      {
        level: 1,
        workSlots: 1,
        effectsStatic: [],
        productionFlat: [{ type: 'inventory_delta', key: 'herbs', delta: 10, reason: '测试产出' }],
        workerEffects: [],
        upkeep: [],
      },
      { level: 2, workSlots: 1, effectsStatic: [], productionFlat: [], workerEffects: [], upkeep: [] },
      { level: 3, workSlots: 1, effectsStatic: [], productionFlat: [], workerEffects: [], upkeep: [] },
    ],
  };
  db2.buildings = { buildings: [defWithProd] };

  const base = makeInitialState();
  const stateNormal = {
    ...base,
    resources: { ...base.resources, silver: 1000, reputation: 200 },
    grid: {
      ...base.grid,
      placedBuildings: {
        'b_0_0': { id: 'b_0_0', defId: 'test_dojo', x: 0, y: 0, level: 1 },
      },
    },
  };

  // 使用零库存初始状态，以便准确测量产出增量
  const stateZeroHerbs = {
    ...stateNormal,
    resources: {
      ...stateNormal.resources,
      inventories: { ...stateNormal.resources.inventories, herbs: 0 },
    },
  };

  // 正常状态产出
  const engine = makeEngine();
  const { nextState: sNormal } = engine.executeTurn(stateZeroHerbs, db2, {});
  const herbsDeltaNormal = sNormal.resources.inventories['herbs'] ?? 0; // 应为 10

  // 升级中状态（outputMultiplier=0.5）
  const stateUpgrading = {
    ...stateZeroHerbs,
    grid: {
      ...stateZeroHerbs.grid,
      placedBuildings: {
        'b_0_0': {
          id: 'b_0_0', defId: 'test_dojo', x: 0, y: 0, level: 1,
          upgrading: { targetLevel: 2, startMonth: 0, durationMonths: 10 }, // 不会完成
        },
      },
    },
  };

  const { nextState: sUpgrading } = engine.executeTurn(stateUpgrading, db2, {});
  const herbsDeltaUpgrading = sUpgrading.resources.inventories['herbs'] ?? 0; // 应为 5

  assert.ok(
    herbsDeltaUpgrading < herbsDeltaNormal,
    `升级中产出(${herbsDeltaUpgrading})应少于正常产出(${herbsDeltaNormal})`,
  );
  assert.equal(
    herbsDeltaUpgrading,
    Math.floor(herbsDeltaNormal * 0.5),
    `产出应为正常的50%（${herbsDeltaNormal} * 0.5 = ${Math.floor(herbsDeltaNormal * 0.5)}）`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────

console.log('');
if (failed === 0) {
  console.log(`✅  smoke_building_upgrade: ${passed}/${passed + failed} tests passed\n`);
  process.exit(0);
} else {
  console.log(`❌  smoke_building_upgrade: ${passed} passed, ${failed} failed\n`);
  process.exit(1);
}
