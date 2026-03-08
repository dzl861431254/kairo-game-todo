/**
 * 结局判定器 - S3-3
 *
 * 纯函数，不修改 GameState。
 * 根据通关时的 GameState + 大会结果，计算评分并选定结局。
 */

import type { GameState, TournamentState } from "../../turn_engine/types.js";

// ── 境界等级映射（对应 public/assets/content/realms.json）──
const REALM_ORDER: Record<string, number> = {
  mortal: 0,
  qi_sense: 1,
  qi_gather: 2,
  foundation: 3,
  inner_core: 4,
  golden_core: 5,
  nascent: 6,
  transcend: 7,
};

// ── 导出接口 ──────────────────────────────────────────────────

export interface ScoreBreakdown {
  /** 名望分 (0-25) */
  reputation: number;
  /** 产业分 (0-20)：建筑总等级之和 */
  buildings: number;
  /** 传承分 (0-20)：武学数量 + 境界提升弟子数 */
  legacy: number;
  /** 弟子成就分 (0-20)：最高属性总和 */
  disciples: number;
  /** 江湖影响分 (0-15)：正向势力关系之和 */
  factions: number;
  /** 总分 (0-100) */
  total: number;
}

export interface EndingResult {
  endingId: string;
  title: string;
  description: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  achievements: string[];
}

// ── 辅助函数 ──────────────────────────────────────────────────

/**
 * 计算暗流分数（0-100）。
 * 公式：floor(所有势力 |关系值| 之和 / 3)，上限 100。
 * 分数高代表门派与各势力深度纠缠（无论正负）。
 */
export function calcShadowScore(factions: Record<string, number>): number {
  const totalAbs = Object.values(factions).reduce(
    (sum, r) => sum + Math.abs(r),
    0,
  );
  return Math.min(100, Math.floor(totalAbs / 3));
}

/**
 * 计算大会积分（tournament score）。
 */
export function calcTournamentScore(t: TournamentState): number {
  return (
    t.results.martialWins * 20 +
    t.results.debateScore * 10 +
    t.results.allianceScore * 10 +
    t.influence
  );
}

/**
 * 计算通关评分各维度。
 */
export function calcScoreBreakdown(
  state: Readonly<GameState>,
): ScoreBreakdown {
  // 名望分 (0-25): 每 40 声望 = 1 分，上限 25
  const reputation = Math.min(25, Math.floor(state.resources.reputation / 40));

  // 产业分 (0-20): 所有建筑等级之和，上限 20
  const buildings = Math.min(
    20,
    Object.values(state.grid.placedBuildings).reduce(
      (sum, b) => sum + b.level,
      0,
    ),
  );

  // 传承分 (0-20):
  //   武学分 = 解锁武学数 × 2，上限 10
  //   境界分 = 突破凡人的弟子数 × 2，上限 10
  const artsBonus = Math.min(10, state.martialArts.unlocked.length * 2);
  const aboveMortal = state.disciples.filter(
    (d) => (REALM_ORDER[d.realm] ?? 0) > 0,
  ).length;
  const legacy = Math.min(20, artsBonus + Math.min(10, aboveMortal * 2));

  // 弟子成就分 (0-20): 最强弟子的属性总和 / 15
  const bestStatSum = state.disciples.reduce((best, d) => {
    const sum = Object.values(d.stats).reduce((s, v) => s + v, 0);
    return sum > best ? sum : best;
  }, 0);
  const disciples = Math.min(20, Math.floor(bestStatSum / 15));

  // 江湖影响分 (0-15): 正向势力关系之和 / 10
  const posRelations = Object.values(state.factions)
    .filter((r) => r > 0)
    .reduce((sum, r) => sum + r, 0);
  const factions = Math.min(15, Math.floor(posRelations / 10));

  const total = reputation + buildings + legacy + disciples + factions;
  return { reputation, buildings, legacy, disciples, factions, total };
}

/**
 * 收集成就列表（文字描述）。
 */
function collectAchievements(
  state: Readonly<GameState>,
  tournament: TournamentState,
  breakdown: ScoreBreakdown,
): string[] {
  const list: string[] = [];
  if (state.resources.reputation >= 500) list.push("声名显赫（名望500+）");
  if (tournament.results.martialWins >= 3) list.push("擂台全胜（武道3/3胜）");
  const topRealm = Math.max(
    ...state.disciples.map((d) => REALM_ORDER[d.realm] ?? 0),
    0,
  );
  if (topRealm >= 4) list.push("门派有结丹弟子");
  if (state.martialArts.unlocked.length >= 5) list.push("武学库丰富（5门以上）");
  if (breakdown.total >= 80) list.push("全面发展（总分80+）");
  if (
    Object.values(state.grid.placedBuildings).some((b) => b.level >= 3)
  ) {
    list.push("建筑大师（建筑升至Lv3）");
  }
  return list;
}

// ── 核心判定函数 ──────────────────────────────────────────────

/**
 * 根据游戏结束时的状态和大会结果，返回对应结局。
 *
 * 优先级（高→低）：
 *   1. demon_lord   — 魔教关系≥60 且 正道关系≤-40
 *   2. martial_champion — 擂台全胜（3/3）
 *   3. shadow_master — 暗流分数≥80 且 3势力关系≥40
 *   4. righteous_leader — 正道≥60 且 声望≥500 且 大会前三
 *   5. ordinary_sect（默认）
 */
export function resolveEnding(
  state: Readonly<GameState>,
  tournament: TournamentState,
): EndingResult {
  const breakdown = calcScoreBreakdown(state);
  const achievements = collectAchievements(state, tournament, breakdown);

  const righteous = state.factions["faction.righteous"] ?? 0;
  const demon = state.factions["faction.demon"] ?? 0;
  const tScore = calcTournamentScore(tournament);
  const shadowScore = calcShadowScore(state.factions);
  const factionsAbove40 = Object.values(state.factions).filter(
    (r) => r >= 40,
  ).length;

  const make = (
    endingId: string,
    title: string,
    description: string,
  ): EndingResult => ({
    endingId,
    title,
    description,
    score: breakdown.total,
    scoreBreakdown: breakdown,
    achievements,
  });

  // 1. 魔道巨擘
  if (demon >= 60 && righteous <= -40) {
    return make(
      "demon_lord",
      "魔道巨擘",
      "你与魔教深度合作，踏上魔道巅峰。正道视你为公敌，然而邪魔奉你为领袖。是非功过，自有后人评说。",
    );
  }

  // 2. 武林至尊
  if (tournament.results.martialWins >= 3) {
    return make(
      "martial_champion",
      "武林至尊",
      "三番擂台，百战百胜。武道已臻化境，天下英雄无不折服，武林至尊之名实至名归！",
    );
  }

  // 3. 幕后盟主
  if (shadowScore >= 80 && factionsAbove40 >= 3) {
    return make(
      "shadow_master",
      "幕后盟主",
      "八面玲珑，纵横江湖。你编织了庞大的关系网络，武林盟主或许是他人，真正的决策者却是你。",
    );
  }

  // 4. 正道盟主（需大会前三：tScore ≥ 50）
  if (righteous >= 60 && state.resources.reputation >= 500 && tScore >= 50) {
    return make(
      "righteous_leader",
      "正道盟主",
      "以德服人，广结善缘，声望卓著。大会之上力压群雄，被众英雄推举为武林盟主，开创一代太平盛世。",
    );
  }

  // 默认：一方宗门
  return make(
    "ordinary_sect",
    "一方宗门",
    "经过多年经营，门派在江湖中站稳脚跟。虽未能问鼎武林，但弟子成材、家业兴旺，亦是一番佳话。",
  );
}
