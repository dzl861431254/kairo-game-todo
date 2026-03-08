/**
 * 师徒系统（v1.5）
 *
 * 提供：
 *   canEstablishMastership()      — 检查是否可以建立师徒关系
 *   calcMasterBreakthroughBonus() — 计算师父给予的突破成功率加成
 *   buildInheritanceEffects()     — 突破成功时构造传承属性加成 Effect
 */

import type { Disciple } from "../../turn_engine/types.js";
import type { Effect } from "../../effect/types.js";
import type { RealmDef } from "./types.js";
import { MASTERSHIP_RULES } from "./types.js";

// ── 师徒建立检查 ──

export interface MastershipBlocker {
  type: 'master_realm' | 'realm_gap' | 'max_apprentices' | 'apprentice_realm' | 'already_has_master' | 'self';
  detail: string;
}

export interface MastershipCheck {
  canEstablish: boolean;
  blockers: MastershipBlocker[];
}

/**
 * 检查是否可以建立师徒关系。
 * @param master      拟收徒的师父
 * @param apprentice  拟拜师的徒弟
 * @param realmDefs   境界定义列表
 */
export function canEstablishMastership(
  master: Disciple,
  apprentice: Disciple,
  realmDefs: RealmDef[],
): MastershipCheck {
  const blockers: MastershipBlocker[] = [];

  // 不能自己拜自己
  if (master.id === apprentice.id) {
    blockers.push({ type: 'self', detail: '不能与自己建立师徒关系' });
    return { canEstablish: false, blockers };
  }

  const masterRealmDef = realmDefs.find(r => r.id === master.realm);
  const minMasterRealmDef = realmDefs.find(r => r.id === MASTERSHIP_RULES.masterMinRealm);
  const apprenticeRealmDef = realmDefs.find(r => r.id === apprentice.realm);
  const maxApprenticeRealmDef = realmDefs.find(r => r.id === MASTERSHIP_RULES.apprenticeMaxRealm);

  // 师父境界不够
  if (masterRealmDef && minMasterRealmDef) {
    if (masterRealmDef.order < minMasterRealmDef.order) {
      blockers.push({
        type: 'master_realm',
        detail: `师父境界不足，需达到 ${minMasterRealmDef.name}（当前 ${masterRealmDef.name}）`,
      });
    }
  }

  // 徒弟境界太高
  if (apprenticeRealmDef && maxApprenticeRealmDef) {
    if (apprenticeRealmDef.order > maxApprenticeRealmDef.order) {
      blockers.push({
        type: 'apprentice_realm',
        detail: `徒弟境界过高，结丹及以下才可拜师`,
      });
    }
  }

  // 师徒境界差不足（至少 2 级）
  if (masterRealmDef && apprenticeRealmDef) {
    const gap = masterRealmDef.order - apprenticeRealmDef.order;
    if (gap < MASTERSHIP_RULES.realmGap) {
      blockers.push({
        type: 'realm_gap',
        detail: `师徒境界差不足（至少需相差 ${MASTERSHIP_RULES.realmGap} 级，当前差 ${gap} 级）`,
      });
    }
  }

  // 徒弟已有师父
  if (apprentice.masterId) {
    blockers.push({
      type: 'already_has_master',
      detail: `${apprentice.name} 已有师父`,
    });
  }

  // 师父收徒数量已满
  const apprenticeCount = master.apprenticeIds?.length ?? 0;
  if (apprenticeCount >= MASTERSHIP_RULES.maxApprentices) {
    blockers.push({
      type: 'max_apprentices',
      detail: `${master.name} 已达最大收徒数 ${MASTERSHIP_RULES.maxApprentices}`,
    });
  }

  return { canEstablish: blockers.length === 0, blockers };
}

// ── 突破成功率加成 ──

/**
 * 计算师父给予的突破成功率加成。
 * 公式：境界差每级 +3%，上限 +12%。
 */
export function calcMasterBreakthroughBonus(
  master: Disciple,
  apprentice: Disciple,
  realmDefs: RealmDef[],
): number {
  const masterRealmDef = realmDefs.find(r => r.id === master.realm);
  const discipleRealmDef = realmDefs.find(r => r.id === apprentice.realm);
  if (!masterRealmDef || !discipleRealmDef) return 0;

  const realmGap = masterRealmDef.order - discipleRealmDef.order;
  return Math.min(12, Math.max(0, realmGap * 3));
}

// ── 传承属性加成 ──

/**
 * 突破成功时，弟子获得师父属性的 3%（一次性），每项上限 +3。
 * 适用于 physique、comprehension、willpower 三项。
 */
export function buildInheritanceEffects(
  master: Disciple,
  apprentice: Disciple,
): Effect[] {
  const effects: Effect[] = [];
  const inheritStats = ['physique', 'comprehension', 'willpower'] as const;

  for (const statId of inheritStats) {
    const masterStat = master.stats[statId] ?? 0;
    const bonus = Math.min(3, Math.floor(masterStat * 0.03));
    if (bonus > 0) {
      effects.push({
        type: 'disciple_stat_delta',
        discipleId: apprentice.id,
        statId,
        delta: bonus,
        reason: `师父传承（${master.name}）`,
      });
    }
  }

  return effects;
}
