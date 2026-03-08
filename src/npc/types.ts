/**
 * NPC 系统类型定义
 *
 * NPCInstance 是纯视觉状态，不放入 GameState，由 MainScene 本地持有。
 * 在每次 stateChanged 时根据 GameState.disciples 同步（增删）。
 */

export type NPCDirection = 'down' | 'up' | 'left' | 'right';

export interface NPCInstance {
  /** 等于对应的 discipleId */
  id: string;

  /** 当前屏幕像素坐标（等距世界空间） */
  pixelX: number;
  pixelY: number;

  /** 当前所在格子坐标 */
  tileX: number;
  tileY: number;

  /** 移动方向（用于将来的动画帧选择） */
  direction: NPCDirection;

  /** 待走的格子队列（shift 消费），为空时 NPC 停止 */
  path: Array<{ x: number; y: number }>;

  /** 当前 AI 状态 */
  state: NPCState;

  /** true = 需要重新计算路径与目标（stateChanged/timeChanged 时置 true） */
  pathDirty: boolean;

  /** 闲逛冷却计时（ms），归零时随机选新目标 */
  wanderCooldown: number;
}

export type NPCState =
  | { type: 'idle' }
  | { type: 'walking'; destTile: { x: number; y: number } }
  | { type: 'working'; buildingId: string }
  | { type: 'sleeping' };
