/**
 * smoke_tournament_prep.test.ts
 *
 * S3-1 大会备赛系统 冒烟测试
 * 覆盖：PREP_ACTIONS 定义、checkCanTakePrepAction 校验、
 *       engine_impl stagePre 集成（影响力/费用/takenPrepActions）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PREP_ACTIONS, checkCanTakePrepAction } from '../src/runtime/systems/tournament/preparation.js';
import { TurnEngine } from '../src/runtime/turn_engine/engine_impl.js';
import { EffectExecutor } from '../src/runtime/effect/executor_impl.js';
import { ConditionEvaluator } from '../src/runtime/condition/evaluator.js';
import { makeInitialState, makeEmptyContentDB } from './fixtures.js';
import type { TournamentState } from '../src/runtime/turn_engine/types.js';

// ── 辅助：创建活跃大会状态 ──
function makeTournament(override: Partial<TournamentState> = {}): TournamentState {
  return {
    active: true,
    year: 1,
    phase: 'announcement',
    phaseMonthsElapsed: 0,
    influence: 0,
    participants: [],
    rankings: [],
    events: [],
    selectedRepresentatives: [],
    results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
    takenPrepActions: [],
    ...override,
  };
}

describe('PREP_ACTIONS 定义', () => {
  it('应有 4 个备赛行动', () => {
    assert.equal(PREP_ACTIONS.length, 4);
  });

  it('所有行动都有 id/name/description/influenceGain', () => {
    for (const a of PREP_ACTIONS) {
      assert.ok(a.id, `action missing id`);
      assert.ok(a.name, `${a.id} missing name`);
      assert.ok(a.description, `${a.id} missing description`);
      assert.ok(typeof a.influenceGain === 'number' && a.influenceGain > 0,
        `${a.id} influenceGain should be positive`);
    }
  });

  it('train_hard 无费用无前置', () => {
    const a = PREP_ACTIONS.find(a => a.id === 'train_hard')!;
    assert.equal(a.cost, undefined);
    assert.equal(a.requirement, undefined);
  });

  it('invite_heroes 需 300 银', () => {
    const a = PREP_ACTIONS.find(a => a.id === 'invite_heroes')!;
    assert.equal(a.cost?.silver, 300);
  });

  it('host_banquet 需 200 银 且有 reputation 副效果', () => {
    const a = PREP_ACTIONS.find(a => a.id === 'host_banquet')!;
    assert.equal(a.cost?.silver, 200);
    const se = a.sideEffects?.find(s => s.type === 'reputation_delta');
    assert.ok(se && se.delta > 0, 'host_banquet should give reputation');
  });

  it('secret_arts 需要 training_ground 建筑', () => {
    const a = PREP_ACTIONS.find(a => a.id === 'secret_arts')!;
    assert.equal(a.requirement?.buildingDefId, 'training_ground');
  });

  it('secret_arts 影响力增益最高', () => {
    const maxGain = Math.max(...PREP_ACTIONS.map(a => a.influenceGain));
    const sa = PREP_ACTIONS.find(a => a.id === 'secret_arts')!;
    assert.equal(sa.influenceGain, maxGain);
  });
});

describe('checkCanTakePrepAction 校验', () => {
  it('大会未开始时返回 canTake=false', () => {
    const state = makeInitialState();
    const t = makeTournament({ active: false });
    const r = checkCanTakePrepAction('train_hard', state, t);
    assert.equal(r.canTake, false);
  });

  it('非备赛阶段（martial 阶段）返回 canTake=false', () => {
    const state = makeInitialState();
    const t = makeTournament({ phase: 'martial' });
    const r = checkCanTakePrepAction('train_hard', state, t);
    assert.equal(r.canTake, false);
  });

  it('已执行过同一行动返回 canTake=false', () => {
    const state = makeInitialState();
    const t = makeTournament({ takenPrepActions: ['train_hard'] });
    const r = checkCanTakePrepAction('train_hard', state, t);
    assert.equal(r.canTake, false);
  });

  it('银两不足时返回 canTake=false（invite_heroes 需 300）', () => {
    const state = makeInitialState();
    state.resources.silver = 100;  // 不足 300
    const t = makeTournament();
    const r = checkCanTakePrepAction('invite_heroes', state, t);
    assert.equal(r.canTake, false);
    assert.ok(r.reason?.includes('银两'));
  });

  it('银两充足时 invite_heroes 可执行', () => {
    const state = makeInitialState();
    state.resources.silver = 500;
    const t = makeTournament();
    const r = checkCanTakePrepAction('invite_heroes', state, t);
    assert.equal(r.canTake, true);
  });

  it('缺少 training_ground 时 secret_arts 不可执行', () => {
    const state = makeInitialState();
    state.grid.placedBuildings = {};  // 清空建筑
    const t = makeTournament();
    const r = checkCanTakePrepAction('secret_arts', state, t);
    assert.equal(r.canTake, false);
    assert.ok(r.reason?.includes('演武场'));
  });

  it('有 training_ground 时 secret_arts 可执行', () => {
    const state = makeInitialState();
    state.grid.placedBuildings = {
      b1: { id: 'b1', defId: 'training_ground', x: 0, y: 0, level: 1 },
    };
    const t = makeTournament();
    const r = checkCanTakePrepAction('secret_arts', state, t);
    assert.equal(r.canTake, true);
  });

  it('train_hard 在 gathering 阶段也可执行', () => {
    const state = makeInitialState();
    const t = makeTournament({ phase: 'gathering' });
    const r = checkCanTakePrepAction('train_hard', state, t);
    assert.equal(r.canTake, true);
  });

  it('未知 actionId 返回 canTake=false', () => {
    const state = makeInitialState();
    const t = makeTournament();
    const r = checkCanTakePrepAction('nonexistent_action', state, t);
    assert.equal(r.canTake, false);
  });
});

describe('stagePre 备赛行动集成', () => {
  const engine = new TurnEngine(new EffectExecutor(), new ConditionEvaluator());
  const contentDB = makeEmptyContentDB();

  it('执行 train_hard 后 influence 增加', () => {
    const state = makeInitialState();
    state.tournament = makeTournament();

    const result = engine.executeTurn(state, contentDB, { prepActions: ['train_hard'] });
    const inflGain = PREP_ACTIONS.find(a => a.id === 'train_hard')!.influenceGain;
    assert.equal(result.nextState.tournament?.influence, inflGain);
  });

  it('执行 train_hard 后 takenPrepActions 包含该行动', () => {
    const state = makeInitialState();
    state.tournament = makeTournament();

    const result = engine.executeTurn(state, contentDB, { prepActions: ['train_hard'] });
    assert.ok(result.nextState.tournament?.takenPrepActions.includes('train_hard'));
  });

  it('执行 invite_heroes 扣除银两', () => {
    const state = makeInitialState();
    state.resources.silver = 1000;
    state.tournament = makeTournament();

    const result = engine.executeTurn(state, contentDB, { prepActions: ['invite_heroes'] });
    const cost = PREP_ACTIONS.find(a => a.id === 'invite_heroes')!.cost!.silver;
    assert.equal(result.nextState.resources.silver, 1000 - cost);
  });

  it('银两不足时 invite_heroes 被忽略', () => {
    const state = makeInitialState();
    state.resources.silver = 100;
    state.tournament = makeTournament();

    const result = engine.executeTurn(state, contentDB, { prepActions: ['invite_heroes'] });
    // 没有执行 — influence 不变，银两不变
    assert.equal(result.nextState.tournament?.influence, 0);
    assert.equal(result.nextState.resources.silver, 100);
  });

  it('host_banquet 扣除银两并增加名望', () => {
    const state = makeInitialState();
    state.resources.silver = 1000;
    state.resources.reputation = 100;
    state.tournament = makeTournament();

    const result = engine.executeTurn(state, contentDB, { prepActions: ['host_banquet'] });
    const action = PREP_ACTIONS.find(a => a.id === 'host_banquet')!;
    const repSe = action.sideEffects!.find(s => s.type === 'reputation_delta')!;
    assert.equal(result.nextState.resources.silver, 1000 - action.cost!.silver);
    assert.ok(result.nextState.resources.reputation > 100, 'reputation should increase');
    assert.equal(result.nextState.resources.reputation, 100 + repSe.delta);
  });

  it('同一行动重复提交只执行一次', () => {
    const state = makeInitialState();
    state.tournament = makeTournament();

    const result = engine.executeTurn(state, contentDB, {
      prepActions: ['train_hard', 'train_hard'],
    });
    const inflGain = PREP_ACTIONS.find(a => a.id === 'train_hard')!.influenceGain;
    assert.equal(result.nextState.tournament?.influence, inflGain);  // 只加一次
  });

  it('influence 不超过 100', () => {
    const state = makeInitialState();
    state.tournament = makeTournament({ influence: 90 });

    const result = engine.executeTurn(state, contentDB, { prepActions: ['train_hard'] });
    assert.ok(result.nextState.tournament!.influence <= 100);
  });

  it('非活跃大会时 prepActions 被忽略', () => {
    const state = makeInitialState();
    state.tournament = makeTournament({ active: false });

    const result = engine.executeTurn(state, contentDB, { prepActions: ['train_hard'] });
    assert.equal(result.nextState.tournament?.influence, 0);
  });

  it('非备赛阶段（martial）时 prepActions 被忽略', () => {
    const state = makeInitialState();
    state.tournament = makeTournament({ phase: 'martial' });

    const result = engine.executeTurn(state, contentDB, { prepActions: ['train_hard'] });
    // martial 阶段不应接受备赛行动
    assert.equal(result.nextState.tournament?.takenPrepActions.length, 0);
  });

  it('多个不同备赛行动可同时执行', () => {
    const state = makeInitialState();
    state.resources.silver = 1000;
    state.tournament = makeTournament();

    const result = engine.executeTurn(state, contentDB, {
      prepActions: ['train_hard', 'host_banquet'],
    });
    const t = result.nextState.tournament!;
    assert.ok(t.takenPrepActions.includes('train_hard'));
    assert.ok(t.takenPrepActions.includes('host_banquet'));
    const trainGain = PREP_ACTIONS.find(a => a.id === 'train_hard')!.influenceGain;
    const banquetGain = PREP_ACTIONS.find(a => a.id === 'host_banquet')!.influenceGain;
    assert.equal(t.influence, trainGain + banquetGain);
  });
});
