/**
 * 武林大会 - 内容数据类型（对应 public/assets/content/tournament.json）
 */

export interface TournamentPhaseDef {
  id: string;
  name: string;
  durationMonths: number;
  description: string;
}

export interface TournamentEffectDef {
  type: string;
  key?: string;
  delta?: number;
  reason?: string;
}

export interface TournamentRewardDef {
  title?: string;    // 仅盟主称号
  effects: TournamentEffectDef[];
}

export interface TournamentEntryRequirement {
  reputation?: number;
  factionRelation?: { factionId: string; minRelation: number };
}

export interface TournamentContentDef {
  phases: TournamentPhaseDef[];
  rewards: {
    champion: TournamentRewardDef;
    topThree: TournamentRewardDef;
    participant: TournamentRewardDef;
  };
  entryRequirements?: TournamentEntryRequirement;
  triggerCondition: {
    yearModulo: number;  // 每 N 年触发一次
    month: number;       // 1-based 月份
  };
}
