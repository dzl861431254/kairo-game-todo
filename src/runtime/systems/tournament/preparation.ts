/**
 * 武林大会备赛系统（S3-1）
 *
 * 定义备赛行动列表及执行校验逻辑。
 * 所有函数均为纯函数，不直接修改 GameState。
 */

import type { GameState, TournamentState } from "../../turn_engine/types.js";

// ── 备赛行动定义 ──

export interface PrepSideEffect {
  type: "reputation_delta" | "morale_delta";
  delta: number;
  reason: string;
}

export interface PrepActionDef {
  id: string;
  name: string;
  description: string;
  /** 影响力增益（0~100 区间内叠加） */
  influenceGain: number;
  /** 可选银两消耗 */
  cost?: { silver: number };
  /** 需要特定建筑（defId） */
  requirement?: { buildingDefId: string; buildingName: string };
  /** 附加效果（名望/士气） */
  sideEffects?: PrepSideEffect[];
}

export const PREP_ACTIONS: readonly PrepActionDef[] = [
  {
    id: "train_hard",
    name: "全力备赛",
    description: "封闭修炼，集中提升弟子实力，备战大会",
    influenceGain: 15,
  },
  {
    id: "invite_heroes",
    name: "广邀高手",
    description: "四处广邀武林豪杰赴会，聚拢人气与影响力",
    influenceGain: 25,
    cost: { silver: 300 },
  },
  {
    id: "host_banquet",
    name: "设宴交好",
    description: "大摆宴席广结善缘，提升门派名望",
    influenceGain: 15,
    cost: { silver: 200 },
    sideEffects: [{ type: "reputation_delta", delta: 30, reason: "设宴交好" }],
  },
  {
    id: "secret_arts",
    name: "秘法推演",
    description: "在演武场中推演大会对手套路，知己知彼百战百胜",
    influenceGain: 30,
    requirement: { buildingDefId: "training_ground", buildingName: "演武场" },
  },
] as const;

// ── 备赛行动校验 ──

export interface PrepActionCheck {
  canTake: boolean;
  reason?: string;
}

/**
 * 检查玩家是否可以执行指定备赛行动。
 */
export function checkCanTakePrepAction(
  actionId: string,
  state: Readonly<GameState>,
  tournament: Readonly<TournamentState>,
): PrepActionCheck {
  const action = PREP_ACTIONS.find((a) => a.id === actionId);
  if (!action) return { canTake: false, reason: "未知备赛行动" };

  if (!tournament.active) {
    return { canTake: false, reason: "武林大会未开始" };
  }

  if (tournament.phase !== "announcement" && tournament.phase !== "gathering") {
    return { canTake: false, reason: "只能在宣布/汇聚阶段进行备赛" };
  }

  const taken = tournament.takenPrepActions ?? [];
  if (taken.includes(actionId)) {
    return { canTake: false, reason: "本届大会已执行过此备赛行动" };
  }

  if (action.cost?.silver && state.resources.silver < action.cost.silver) {
    return { canTake: false, reason: `银两不足（需 ${action.cost.silver} 两）` };
  }

  if (action.requirement) {
    const hasBld = Object.values(state.grid.placedBuildings).some(
      (b) => b.defId === action.requirement!.buildingDefId,
    );
    if (!hasBld) {
      return { canTake: false, reason: `需要建造${action.requirement.buildingName}` };
    }
  }

  return { canTake: true };
}
