export type {
  TrainingBonusDef,
  MartialArtDef,
  MartialArtContentDef,
} from "./types.js";

export type { ValidationResult } from "./validator.js";

export {
  findMartialArtDef,
  canResearch,
  canAssign,
} from "./validator.js";

export {
  unlockMartialArt,
  assignMartialArt,
  unassignMartialArt,
  addResearchProgress,
  calcResearchProgress,
  checkResearchCompletion,
  calcTrainingBonus,
  calcDisciplePower,
} from "./manager.js";
