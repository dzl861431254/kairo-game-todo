export type {
  MissionTemplateDef,
  MissionEventCardDef,
  MissionContentDef,
  MissionProgress,
} from "./types.js";

export type { ValidationResult } from "./validator.js";

export {
  findTemplateDef,
  isDiscipleOnMission,
  canDispatch,
} from "./validator.js";

export {
  generateMissionId,
  findEventCardDef,
  dispatchMission,
  tickMissions,
  completeMission,
  calcEventSuccessRate,
  getPartyDisciples,
  processMissionTick,
  settleCompletedMissions,
} from "./manager.js";
