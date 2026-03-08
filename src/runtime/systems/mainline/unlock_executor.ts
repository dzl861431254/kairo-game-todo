/**
 * 主线解锁执行器 — S1-3
 *
 * 将章节完成时的 UnlockItem[] 转换为可执行的 Effect[]。
 * 效果由 EffectExecutor 统一写入 GameState.unlocks.*。
 */

import type { UnlockItem } from "../../turn_engine/types.js";
import type {
  SystemUnlockEffect,
  BuildingUnlockEffect,
  MartialUnlockEffect,
  FeatureUnlockEffect,
} from "../../effect/types.js";

type UnlockEffect =
  | SystemUnlockEffect
  | BuildingUnlockEffect
  | MartialUnlockEffect
  | FeatureUnlockEffect;

/**
 * 将 UnlockItem 列表转为对应的解锁 Effect 数组。
 * 已经解锁的条目（unlocked: true）和非识别类型均跳过。
 */
export function executeUnlocks(unlocks: UnlockItem[]): UnlockEffect[] {
  const effects: UnlockEffect[] = [];
  for (const u of unlocks) {
    switch (u.type) {
      case 'system':
        effects.push({ type: 'system_unlock',   systemId:   u.id, reason: `章节解锁：${u.name}` });
        break;
      case 'building':
        effects.push({ type: 'building_unlock', buildingId: u.id, reason: `章节解锁：${u.name}` });
        break;
      case 'martial':
        effects.push({ type: 'martial_unlock',  martialId:  u.id, reason: `章节解锁：${u.name}` });
        break;
      case 'feature':
        effects.push({ type: 'feature_unlock',  featureId:  u.id, reason: `章节解锁：${u.name}` });
        break;
    }
  }
  return effects;
}
