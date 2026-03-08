export type {
  StatDef,
  NamePools,
  RecruitPoolConfig,
  DiscipleContentDef,
} from "./types.js";

export {
  generateName,
  generateStats,
  generateDiscipleId,
  generateCandidate,
} from "./generator.js";

export {
  calcPoolSize,
  generateRecruitPool,
} from "./recruit_pool.js";

export {
  recruitDisciple,
  dismissDisciple,
  modifyDiscipleStat,
  assignJob,
  unassignJob,
  accumulateTraining,
  tickStatuses,
  setRecruitPool,
} from "./manager.js";
