/**
 * 武学系统 - 校验逻辑
 *
 * 纯函数，不产生副作用。由 Stage Handler 在生成 Effect 前调用。
 */

import type { MartialArtState, DiscipleLoadout } from "../../turn_engine/types.js";
import type { MartialArtDef, MartialArtContentDef } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** 查找武学定义 */
export function findMartialArtDef(
  defs: readonly MartialArtDef[],
  artId: string,
): MartialArtDef | undefined {
  return defs.find((d) => d.id === artId);
}

/**
 * 校验是否可以研究指定武学
 */
export function canResearch(
  maState: Readonly<MartialArtState>,
  defs: readonly MartialArtDef[],
  artId: string,
): ValidationResult {
  const def = findMartialArtDef(defs, artId);
  if (!def) {
    return { valid: false, reason: `武学 ${artId} 定义不存在` };
  }

  // 已解锁
  if (maState.unlocked.includes(artId)) {
    return { valid: false, reason: `武学 ${def.name} 已经解锁` };
  }

  // 前置检查
  for (const prereq of def.prerequisites) {
    if (!maState.unlocked.includes(prereq)) {
      const prereqDef = findMartialArtDef(defs, prereq);
      const prereqName = prereqDef?.name ?? prereq;
      return { valid: false, reason: `需要先解锁前置武学：${prereqName}` };
    }
  }

  return { valid: true };
}

/**
 * 校验是否可以为弟子装备武学
 */
export function canAssign(
  maState: Readonly<MartialArtState>,
  content: Readonly<MartialArtContentDef>,
  loadout: Readonly<DiscipleLoadout> | undefined,
  artId: string,
): ValidationResult {
  const def = findMartialArtDef(content.martialArts, artId);
  if (!def) {
    return { valid: false, reason: `武学 ${artId} 定义不存在` };
  }

  // 是否已解锁
  if (!maState.unlocked.includes(artId)) {
    return { valid: false, reason: `武学 ${def.name} 尚未解锁` };
  }

  const equipped = loadout?.equippedArts ?? [];

  // 是否已装备
  if (equipped.includes(artId)) {
    return { valid: false, reason: `武学 ${def.name} 已经装备` };
  }

  // 装备槽位检查
  if (equipped.length >= content.maxEquipSlots) {
    return { valid: false, reason: `装备槽位已满（最多 ${content.maxEquipSlots} 个）` };
  }

  // 冲突组检查
  for (const equippedId of equipped) {
    const equippedDef = findMartialArtDef(content.martialArts, equippedId);
    if (equippedDef && equippedDef.conflictGroup === def.conflictGroup) {
      return {
        valid: false,
        reason: `与已装备的 ${equippedDef.name} 冲突（同属${def.conflictGroup}类）`,
      };
    }
  }

  return { valid: true };
}
