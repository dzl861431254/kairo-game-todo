/**
 * TurnEngine - 月回合引擎接口
 *
 * 按固定 Stage 顺序推进每月结算。
 * 输入：GameState + ContentDB + PlayerOps + rngState
 * 输出：nextGameState + SettlementReport
 */

import type {
  GameState,
  PlayerOps,
  SettlementReport,
  StageName,
  FactionContentDef,
} from "./types.js";
import type { BuildingContentDef } from "../systems/building/types.js";
import type { DiscipleContentDef } from "../systems/disciple/types.js";
import type { MartialArtContentDef } from "../systems/martial_art/types.js";
import type { MissionContentDef } from "../systems/mission/types.js";
import type { EventContentDef } from "../systems/event/types.js";
import type { TournamentContentDef } from "../systems/tournament/types.js";
import type { RealmContentDef, TalentContentDef } from "../systems/cultivation/types.js";

/**
 * 内容数据库（只读），由 DataLoader/Validator 生成
 */
export interface ContentDB {
  buildings: BuildingContentDef;
  disciples: DiscipleContentDef;
  martialArts: MartialArtContentDef;
  missions: MissionContentDef;
  events: EventContentDef;
  factions: FactionContentDef;
  /** 武林大会配置（可选，无 JSON 时不影响现有逻辑） */
  tournament?: TournamentContentDef;
  /** 境界配置（可选，无 JSON 时跳过月度成长） */
  realms?: RealmContentDef;
  /** 天赋配置（可选，无 JSON 时跳过月度成长） */
  talents?: TalentContentDef;
}

/**
 * TurnEngine 执行结果
 */
export interface TurnResult {
  nextState: GameState;
  report: SettlementReport;
}

/**
 * TurnEngine 主接口
 */
export interface ITurnEngine {
  /**
   * 执行一个月的完整结算流水线
   */
  executeTurn(
    state: Readonly<GameState>,
    contentDB: Readonly<ContentDB>,
    playerOps: Readonly<PlayerOps>,
  ): TurnResult;
}

/**
 * 月结算阶段执行顺序（固定，对齐 §4.3）
 */
export const STAGE_ORDER: readonly StageName[] = [
  "pre",
  "building_passive",
  "production",
  "upkeep",
  "training_research",
  "mission_tick",
  "mission_settlement",
  "inner_event",
  "visit_recruit",
  "settlement_report",
] as const;
