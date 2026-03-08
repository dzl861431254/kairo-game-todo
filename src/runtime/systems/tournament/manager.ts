/**
 * TournamentManager - 武林大会 触发 / 推进 / 结算 / 得分计算
 *
 * 纯函数设计：所有方法均不直接修改 GameState，
 * 而是返回更新后的 TournamentState 和 Effect[]，
 * 由调用方（engine_impl）通过 EffectExecutor 写入。
 *
 * S3-2 三关玩法扩展：
 *   - resolveMartial: physique + 武学战力加成
 *   - resolveDebate:  comprehension + 传承/研究/正邪加成（上限 15）
 *   - resolvePolitics: reputation + 势力关系 + 正邪加成（上限 22）
 *   - 新增 breakdown 辅助函数供 UI 显示
 */

import type { Effect } from "../../effect/types.js";
import type {
  GameState,
  Disciple,
  TournamentPhase,
  TournamentState,
} from "../../turn_engine/types.js";
import type { ContentDB } from "../../turn_engine/engine.js";
import type { TournamentContentDef, TournamentEffectDef } from "./types.js";
import type { MartialArtContentDef } from "../martial_art/types.js";
import type { RNG } from "../../rng.js";

const PHASE_ORDER: readonly TournamentPhase[] = [
  "announcement",
  "gathering",
  "martial",
  "debate",
  "politics",
  "conclusion",
];

/** 将 tournament.json 中的奖励效果定义转换为运行时 Effect */
function toGameEffect(eff: TournamentEffectDef): Effect | null {
  switch (eff.type) {
    case "reputation_delta":
      return { type: "reputation_delta", delta: eff.delta ?? 0, reason: eff.reason };
    case "morale_delta":
      return { type: "morale_delta", delta: eff.delta ?? 0, reason: eff.reason };
    case "currency_delta":
      if (!eff.key) return null;
      return {
        type: "currency_delta",
        key: eff.key as "silver" | "reputation" | "inheritance" | "morale",
        delta: eff.delta ?? 0,
        reason: eff.reason,
      };
    default:
      return null;
  }
}

// ── S3-2 得分分解结构 ─────────────────────────────────────────────────────────

/** 擂台得分分解 */
export interface MartialBreakdown {
  physique: number;       // 弟子体魄（0-100）
  artBonus: number;       // 装备武学战力合计
  winProbPct: number;     // 实际胜率（0-95）
}

/** 论道得分分解 */
export interface DebateBreakdown {
  compScore: number;      // 悟性得分 = round(comprehension × 0.1)
  inheritanceBonus: number; // 传承加成（0-3）
  researchBonus: number;  // 武学研究完成加成（0-5）
  alignBonus: number;     // 正邪倾向加成（-2 ~ +2）
  total: number;          // 最终得分（0-15）
}

/** 暗流得分分解 */
export interface PoliticsBreakdown {
  repScore: number;       // 声望得分（0-10）
  allianceBonus: number;  // 正向势力关系加成（0-10）
  alignBonus: number;     // 正邪倾向加成（0-2）
  total: number;          // 最终得分（0-22）
}

export class TournamentManager {
  // ═══════════════════════════════════════════════════════════
  // 触发 / 初始化
  // ═══════════════════════════════════════════════════════════

  /**
   * 检查当前 monthIndex 是否应触发武林大会。
   * 需在 monthIndex 自增之后、buildReport 之前调用。
   */
  static checkTrigger(state: GameState, contentDB: ContentDB): boolean {
    if (!contentDB.tournament) return false;
    if (state.tournament?.active) return false;
    const { yearModulo, month } = contentDB.tournament.triggerCondition;
    const yearIndex = Math.floor(state.monthIndex / 12);
    const monthInYear = state.monthIndex % 12; // 0-based，5 = 第6月
    return (yearIndex + 1) % yearModulo === 0 && monthInYear === month - 1;
  }

  /**
   * 初始化武林大会状态（在触发月调用）。
   */
  static initTournament(state: GameState, content: TournamentContentDef): TournamentState {
    const yearIndex = Math.floor(state.monthIndex / 12);
    const edition = Math.floor((yearIndex + 1) / content.triggerCondition.yearModulo);
    return {
      active: true,
      year: edition,
      phase: "announcement",
      phaseMonthsElapsed: 0,
      influence: 0,
      participants: [],
      rankings: [],
      events: [],
      selectedRepresentatives: [],
      results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
      takenPrepActions: [],
    };
  }

  // ═══════════════════════════════════════════════════════════
  // S3-2 得分分解（供 UI 展示）
  // ═══════════════════════════════════════════════════════════

  /**
   * 计算弟子在擂台阶段的战力分解。
   * - physique: 弟子体魄（直接用于胜率计算）
   * - artBonus: 所有已装备武学的战力之和
   * - winProbPct: 综合胜率（百分比，0-95）
   */
  static calcMartialPowerBreakdown(
    disciple: Disciple,
    martialArtsContent?: MartialArtContentDef,
  ): MartialBreakdown {
    const physique = Math.min(disciple.stats["physique"] ?? 50, 100);
    let artBonus = 0;
    if (martialArtsContent) {
      const equipped = disciple.loadout?.equippedArts ?? [];
      artBonus = equipped.reduce((sum, artId) => {
        const art = martialArtsContent.martialArts.find((a) => a.id === artId);
        return sum + (art?.power ?? 0);
      }, 0);
    }
    // 胜率 = physique/100 + artBonus×0.5/100，physique=0 且 artBonus=0 时为 0
    const rawPct = physique === 0 && artBonus === 0
      ? 0
      : physique + artBonus * 0.5;
    const winProbPct = Math.min(95, Math.max(physique === 0 && artBonus === 0 ? 0 : 5, rawPct));
    return { physique, artBonus, winProbPct };
  }

  /**
   * 计算论道阶段得分分解（S3-2 增强版）。
   * - compScore: 悟性得分 = round(comprehension × 0.1)
   * - inheritanceBonus: 传承资源加成 floor(inheritance/500)，上限 3
   * - researchBonus: 武学研究完成数，上限 5
   * - alignBonus: 正道倾向 ≥30 → +2，邪道 ≤-30 → -2
   * - total: 上限 15（原为 10）
   */
  static calcDebateBreakdown(
    disciple: Disciple,
    state?: Readonly<GameState>,
    martialArtsContent?: MartialArtContentDef,
  ): DebateBreakdown {
    const comp = disciple.stats["comprehension"] ?? 0;
    const compScore = Math.round(comp * 0.1);
    let inheritanceBonus = 0;
    let researchBonus = 0;
    let alignBonus = 0;

    if (state) {
      inheritanceBonus = Math.min(3, Math.floor(state.resources.inheritance / 500));
      if (martialArtsContent) {
        const completed = Object.entries(state.martialArts.research).filter(([artId, pts]) => {
          const art = martialArtsContent.martialArts.find((a) => a.id === artId);
          return art && (pts as number) >= art.researchCost;
        }).length;
        researchBonus = Math.min(5, completed);
      }
      const alignment = state.resources.alignmentValue ?? 0;
      alignBonus = alignment >= 30 ? 2 : alignment <= -30 ? -2 : 0;
    }

    const total = Math.max(0, Math.min(15, compScore + inheritanceBonus + researchBonus + alignBonus));
    return { compScore, inheritanceBonus, researchBonus, alignBonus, total };
  }

  /**
   * 计算纵横结盟阶段得分分解（S3-2 增强版）。
   * - repScore: 声望得分 floor(rep/50)，上限 10
   * - allianceBonus: 正向势力关系之和/100，上限 10
   * - alignBonus: 正道 ≥30 → +2（结盟加成），邪道 ≤-30 → +1（暗盟加成）
   * - total: 上限 22
   */
  static calcPoliticsBreakdown(state: Readonly<GameState>): PoliticsBreakdown {
    const repScore = Math.min(10, Math.floor(state.resources.reputation / 50));
    const allianceBonus = Math.min(
      10,
      Math.floor(
        Object.values(state.factions)
          .filter((r) => r > 0)
          .reduce((sum, r) => sum + r, 0) / 100,
      ),
    );
    const alignment = state.resources.alignmentValue ?? 0;
    const alignBonus = alignment >= 30 ? 2 : alignment <= -30 ? 1 : 0;
    const total = Math.min(22, repScore + allianceBonus + alignBonus);
    return { repScore, allianceBonus, alignBonus, total };
  }

  // ═══════════════════════════════════════════════════════════
  // 得分计算（S3-2 增强版）
  // ═══════════════════════════════════════════════════════════

  /**
   * 武道比试得分：3 场擂台赛，胜率 = (physique + artBonus×0.5) / 100，上限 95%。
   * physique=0 且无武学时胜率为 0（历史兼容：测试用弟子 physique=0 仍输）。
   *
   * @param martialArtsContent 可选，武学内容库（用于计算武学战力加成）
   * @returns 胜场数（0-3）
   */
  static resolveMartial(
    disciple: Disciple,
    rng: RNG,
    martialArtsContent?: MartialArtContentDef,
  ): number {
    const { winProbPct } = TournamentManager.calcMartialPowerBreakdown(disciple, martialArtsContent);
    const winProb = winProbPct / 100;
    let wins = 0;
    for (let i = 0; i < 3; i++) {
      if (rng.next() < winProb) wins++;
    }
    return wins;
  }

  /**
   * 论道辩难得分（S3-2 增强版）。
   * 原公式: round(comprehension × 0.1)，上限 10。
   * 新公式: + 传承加成 + 研究加成 + 正邪加成，上限 15。
   *
   * @param state 可选，游戏状态（用于传承/研究/正邪加成）
   * @param martialArtsContent 可选，武学库（用于研究完成数统计）
   */
  static resolveDebate(
    disciple: Disciple,
    state?: Readonly<GameState>,
    martialArtsContent?: MartialArtContentDef,
  ): number {
    return TournamentManager.calcDebateBreakdown(disciple, state, martialArtsContent).total;
  }

  /**
   * 纵横结盟得分（S3-2 增强版）。
   *   声望分 = floor(reputation / 50)（最高 10）
   *   结交分 = floor(正向关系合计 / 100)（最高 10）
   *   正邪分 = 正道 ≥30 → +2；邪道 ≤-30 → +1
   * @returns 结交得分（0-22）
   */
  static resolvePolitics(state: Readonly<GameState>): number {
    return TournamentManager.calcPoliticsBreakdown(state).total;
  }

  // ═══════════════════════════════════════════════════════════
  // 阶段推进（含得分结算）
  // ═══════════════════════════════════════════════════════════

  /**
   * 每月推进一次大会阶段。
   * - durationMonths=0 的阶段立即进入下一阶段（announcement / conclusion）。
   * - 达到 conclusion 后不再继续推进（由 engine_impl 调用 conclude()）。
   * - 当阶段离开 martial/debate/politics 时，自动计算并累积得分。
   *
   * @param state  当前 GameState（可选，用于得分计算）
   * @param rng    随机数生成器（可选，武道比试需要）
   * @param martialArtsContent 武学内容库（可选，S3-2 武学战力加成）
   */
  static advancePhase(
    tournament: TournamentState,
    content: TournamentContentDef,
    state?: Readonly<GameState>,
    rng?: RNG,
    martialArtsContent?: MartialArtContentDef,
  ): TournamentState {
    const currentIdx = PHASE_ORDER.indexOf(tournament.phase);
    if (currentIdx === -1 || currentIdx === PHASE_ORDER.length - 1) {
      return tournament; // 已在 conclusion 或无效
    }

    const phaseDef = content.phases.find((p) => p.id === tournament.phase);
    const duration = phaseDef?.durationMonths ?? 0;
    const newElapsed = tournament.phaseMonthsElapsed + 1;

    if (duration === 0 || newElapsed >= duration) {
      // ── 离开当前阶段前结算得分 ──
      let updatedResults = { ...tournament.results };
      if (state) {
        updatedResults = TournamentManager.calcPhaseScore(
          tournament, state, rng, updatedResults, martialArtsContent,
        );
      }

      const nextPhase = PHASE_ORDER[currentIdx + 1];
      return {
        ...tournament,
        phase: nextPhase,
        phaseMonthsElapsed: 0,
        results: updatedResults,
      };
    }

    return { ...tournament, phaseMonthsElapsed: newElapsed };
  }

  /**
   * 计算当前阶段得分并叠加到 results（内部辅助方法）。
   */
  private static calcPhaseScore(
    tournament: TournamentState,
    state: Readonly<GameState>,
    rng: RNG | undefined,
    results: TournamentState["results"],
    martialArtsContent?: MartialArtContentDef,
  ): TournamentState["results"] {
    switch (tournament.phase) {
      case "martial": {
        const slot = tournament.selectedRepresentatives.find(
          (s) => s.phaseId === "martial",
        );
        if (!slot) break;
        const disciple = state.disciples.find((d) => d.id === slot.discipleId);
        if (!disciple || !rng) break;
        results = {
          ...results,
          martialWins: results.martialWins + TournamentManager.resolveMartial(disciple, rng, martialArtsContent),
        };
        break;
      }
      case "debate": {
        const slot = tournament.selectedRepresentatives.find(
          (s) => s.phaseId === "debate",
        );
        if (!slot) break;
        const disciple = state.disciples.find((d) => d.id === slot.discipleId);
        if (!disciple) break;
        results = {
          ...results,
          debateScore: results.debateScore + TournamentManager.resolveDebate(disciple, state, martialArtsContent),
        };
        break;
      }
      case "politics": {
        results = {
          ...results,
          allianceScore: results.allianceScore + TournamentManager.resolvePolitics(state),
        };
        break;
      }
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  // 结算
  // ═══════════════════════════════════════════════════════════

  /**
   * 结算武林大会，计算排名并生成奖励效果。
   *
   * 积分规则：总分 = martialWins×20 + debateScore×10 + allianceScore×10 + influence
   *   ≥ 150 → 盟主（champion）
   *   ≥ 50  → 前三（topThree）
   *   其他  → 参与者（participant）
   */
  static conclude(
    tournament: TournamentState,
    content: TournamentContentDef,
  ): { updatedTournament: TournamentState; effects: Effect[] } {
    const { martialWins, debateScore, allianceScore } = tournament.results;
    const score = martialWins * 20 + debateScore * 10 + allianceScore * 10 + tournament.influence;

    let rank: "champion" | "topThree" | "participant";
    if (score >= 150) {
      rank = "champion";
    } else if (score >= 50) {
      rank = "topThree";
    } else {
      rank = "participant";
    }

    const rewardDef = content.rewards[rank];
    const effects: Effect[] = rewardDef.effects
      .map(toGameEffect)
      .filter((e): e is Effect => e !== null);

    // 盟主：添加称号 flag + 主线胜利 flag（供 obj.ch5_win 判定）
    if (rank === "champion") {
      if (content.rewards.champion.title) {
        effects.push({
          type: "set_flag",
          key: `tournament_champion_${tournament.year}`,
          value: true,
          reason: content.rewards.champion.title,
        });
      }
      effects.push({
        type: "set_flag",
        key: "tournament_won",
        value: true,
        reason: "荣登武林盟主",
      });
    }

    const updatedTournament: TournamentState = {
      ...tournament,
      active: false,
      phase: "conclusion",
      rankings: rank === "champion"
        ? ["player"]
        : rank === "topThree"
          ? ["npc1", "player"]
          : ["npc1", "npc2", "player"],
    };

    return { updatedTournament, effects };
  }
}
