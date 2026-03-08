/**
 * 弟子系统 - 内容数据类型定义
 *
 * 描述 content/disciples.json 的 Schema，
 * 运行时 Disciple 接口在 turn_engine/types.ts 中定义。
 */

/** 属性定义 */
export interface StatDef {
  id: string;
  name: string;
  min: number;
  max: number;
}

/** 姓名池 */
export interface NamePools {
  surnames: string[];
  givenNames: string[];
}

/** 招募池配置 */
export interface RecruitPoolConfig {
  baseSize: number;
  maxSize: number;
  reputationBonusThreshold: number;
  reputationBonusSize: number;
}

/** content/disciples.json 根结构 */
export interface DiscipleContentDef {
  namePools: NamePools;
  statDefs: StatDef[];
  recruitPool: RecruitPoolConfig;
  maxDiscipleCount: number;
}
