export type {
  BuildingSize,
  WorkerEffectDef,
  BuildingLevelDef,
  BuildingDef,
  BuildingContentDef,
} from "./types.js";

export type { ValidationResult } from "./validator.js";

export {
  findBuildingDef,
  getBuildingLevel,
  canPlace,
  canUpgrade,
  canDemolish,
} from "./validator.js";

export {
  generateBuildingInstanceId,
  placeBuilding,
  upgradeBuilding,
  demolishBuilding,
  calcStaticEffects,
  calcProduction,
  calcUpkeep,
} from "./manager.js";
