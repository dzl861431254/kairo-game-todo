/**
 * 突破系统 - 境界突破逻辑
 *
 * 提供：
 *   checkBreakthroughRequirements() — 前置条件检查
 *   calcBreakthroughChance()        — 成功率计算（带分解说明）
 *   rollBreakthroughResult()        — 掷骰确定结果
 *   buildBreakthroughEffects()      — 构造结果对应的 Effect 列表
 */

import type { Disciple, GameState } from "../../turn_engine/types.js";
import type { Effect } from "../../effect/types.js";
import type { RNG } from "../../rng.js";
import type {
  RealmDef,
  TalentGradeDef,
  BreakthroughCheck,
  BreakthroughChanceBreakdown,
  BreakthroughResult,
} from "./types.js";
import { calcMasterBreakthroughBonus } from "./mastership.js";

function clamp(min: number, max: number, val: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── 突破前置条件检查 ──

export function checkBreakthroughRequirements(
  disciple: Disciple,
  targetRealm: RealmDef,
  state: GameState,
): BreakthroughCheck {
  const blockers: BreakthroughCheck['blockers'] = [];
  const req = targetRealm.requirements;

  // 属性检查
  for (const [statId, minVal] of Object.entries(req.stats)) {
    const current = disciple.stats[statId] ?? 0;
    if (current < minVal) {
      blockers.push({ type: 'stat', key: statId, required: minVal, current });
    }
  }

  // 境界进度门槛
  if (disciple.realmProgress < req.realmProgressMin) {
    blockers.push({
      type: 'progress',
      key: 'realmProgress',
      required: req.realmProgressMin,
      current: disciple.realmProgress,
    });
  }

  // 资源检查（silver 来自 resources.silver，herbs 等来自 inventories）
  if (req.resources) {
    for (const [key, amount] of Object.entries(req.resources)) {
      if (amount === undefined) continue;
      let current: number;
      if (key === 'silver') {
        current = state.resources.silver;
      } else {
        current = state.resources.inventories[key] ?? 0;
      }
      if (current < amount) {
        blockers.push({ type: 'resource', key, required: amount, current });
      }
    }
  }

  // 道具检查（inventories 中的特殊道具）
  if (req.items) {
    for (const itemId of req.items) {
      const count = state.resources.inventories[itemId] ?? 0;
      if (count < 1) {
        blockers.push({ type: 'item', key: itemId, required: 1, current: count });
      }
    }
  }

  return { canAttempt: blockers.length === 0, blockers };
}

// ── 突破成功率计算 ──

const TALENT_BONUS: Record<string, number> = { S: 25, A: 15, B: 8, C: 0, D: -8 };

export function calcBreakthroughChance(
  disciple: Disciple,
  talent: TalentGradeDef | undefined,
  state?: GameState,
  realmDefs?: RealmDef[],
): BreakthroughChanceBreakdown {
  const base = 50;

  // 天赋加成
  const talentBonus = talent?.breakthroughBonus ?? TALENT_BONUS[disciple.talentGrade] ?? 0;

  // 悟性加成：每10点悟性+3%，上限+15%
  const comprehensionBonus = Math.min(15, Math.floor((disciple.stats['comprehension'] ?? 0) / 10) * 3);

  // 定力加成：每15点定力+2%，上限+10%
  const willpowerBonus = Math.min(10, Math.floor((disciple.stats['willpower'] ?? 0) / 15) * 2);

  // 尝试惩罚：每次失败-4%，最多-20%
  const attemptPenalty = Math.min(disciple.breakthroughAttempts * 4, 20);

  // 师父加成（v1.5）：境界差每级 +3%，上限 +12%
  let masterBonus = 0;
  if (disciple.masterId && state && realmDefs) {
    const master = state.disciples.find(d => d.id === disciple.masterId);
    if (master) {
      masterBonus = calcMasterBreakthroughBonus(master, disciple, realmDefs);
    }
  }

  // 道具加成（暂未实现）
  const itemBonus = 0;

  const total = clamp(5, 95, base + talentBonus + comprehensionBonus + willpowerBonus - attemptPenalty + masterBonus + itemBonus);

  return { base, talentBonus, comprehensionBonus, willpowerBonus, attemptPenalty, masterBonus, itemBonus, total };
}

// ── 突破结果掷骰 ──

export function rollBreakthroughResult(
  successChance: number,
  rng: RNG,
): BreakthroughResult {
  const roll = rng.next() * 100;

  if (roll < successChance) {
    // 成功区间：前 12% 为大成功
    if (roll < successChance * 0.12) {
      return 'great_success';
    }
    return 'success';
  } else {
    // 失败区间：末尾 25% 为走火入魔
    const failRange = 100 - successChance;
    const deviationThreshold = failRange * 0.25;
    if (roll > 100 - deviationThreshold) {
      return 'qi_deviation';
    }
    return 'failure';
  }
}

// ── 构造突破结果 Effect 列表 ──

export function buildBreakthroughEffects(
  disciple: Disciple,
  result: BreakthroughResult,
  targetRealm: RealmDef,
  state: GameState,
): Effect[] {
  const effects: Effect[] = [];

  // 消耗资源（仅成功/大成功时扣除，失败不消耗）
  if (result === 'success' || result === 'great_success') {
    const req = targetRealm.requirements;
    if (req.resources) {
      if (req.resources.silver) {
        effects.push({
          type: 'currency_delta',
          key: 'silver',
          delta: -req.resources.silver,
          reason: `突破${targetRealm.name}资源消耗`,
        });
      }
      for (const [key, amount] of Object.entries(req.resources)) {
        if (key === 'silver' || amount === undefined) continue;
        effects.push({
          type: 'inventory_delta',
          key,
          delta: -amount,
          reason: `突破${targetRealm.name}资源消耗`,
        });
      }
    }
    if (req.items) {
      for (const itemId of req.items) {
        if ((state.resources.inventories[itemId] ?? 0) > 0) {
          effects.push({
            type: 'inventory_delta',
            key: itemId,
            delta: -1,
            reason: `突破${targetRealm.name}道具消耗`,
          });
        }
      }
    }
  }

  // 记录突破结果
  effects.push({
    type: 'disciple_breakthrough_attempt',
    discipleId: disciple.id,
    result,
    reason: `突破${targetRealm.name}`,
  });

  // 境界提升（成功/大成功）
  if (result === 'success' || result === 'great_success') {
    effects.push({
      type: 'disciple_realm_set',
      discipleId: disciple.id,
      realmId: targetRealm.id,
      reason: `突破成功晋升${targetRealm.name}`,
    });
  }

  // 大成功额外奖励：随机属性 +5
  if (result === 'great_success') {
    const bonusStat = 'physique'; // 简化：固定给体魄（v1.5可随机化）
    effects.push({
      type: 'disciple_stat_delta',
      discipleId: disciple.id,
      statId: bonusStat,
      delta: 5,
      reason: '突破大成功，根骨精进',
    });
  }

  return effects;
}
