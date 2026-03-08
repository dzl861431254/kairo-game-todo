/**
 * NPC AI 状态机 — 纯函数，无 Phaser 依赖
 *
 * 决策优先级（高→低）：
 *   1. 22:00–06:00 → sleeping（走向左上角休眠区）
 *   2. disciple.job 有效 → working（走向分配建筑的左上格）
 *   3. 其他 → idle（由 MainScene 每 5s 随机选闲逛目标）
 */

import type { NPCInstance, NPCState } from './types.js';
import type { Disciple, GameState } from '../runtime/turn_engine/types.js';

type Point = { x: number; y: number };

/** 闲逛冷却时长（毫秒），NPC 到达目标后等待此时间再随机选下一个 */
export const WANDER_INTERVAL_MS = 5_000;

/** NPC 移动速度（像素/秒，等距世界空间） */
export const MOVE_SPEED_PX_S = 70;

/**
 * 从 roadPoints 中挑选 center 半径（曼哈顿距离）内的随机一格。
 * 若半径内无可选格则退化为全局随机；若 roadPoints 为空则返回 center。
 */
export function randomNearbyRoadTile(
  roadPoints: Point[],
  center: Point,
  radius = 6,
): Point {
  const nearby = roadPoints.filter(
    p => Math.abs(p.x - center.x) + Math.abs(p.y - center.y) <= radius,
  );
  const pool = nearby.length > 0 ? nearby : roadPoints;
  if (pool.length === 0) return center;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/**
 * 根据游戏时间与弟子状态决定 NPC 应处于哪种 AI 状态。
 * 每次 pathDirty=true 时调用一次。
 */
export function decideNPCState(
  _npc: NPCInstance,
  disciple: Disciple,
  state: GameState,
): NPCState {
  const hour = state.time?.hour ?? 8;

  // 夜间休眠
  if (hour >= 22 || hour < 6) {
    return { type: 'sleeping' };
  }

  // 有工作分配
  if (disciple.job) {
    return { type: 'working', buildingId: disciple.job.buildingInstanceId };
  }

  return { type: 'idle' };
}

/**
 * 返回给定 AI 状态对应的目标格坐标。
 * idle 返回 null（由 MainScene 随机选目标）。
 */
export function getDestTile(
  npcState: NPCState,
  gameState: GameState,
): { x: number; y: number } | null {
  switch (npcState.type) {
    case 'working': {
      const b = gameState.grid.placedBuildings[npcState.buildingId];
      return b ? { x: b.x, y: b.y } : null;
    }
    case 'sleeping':
      return { x: 1, y: 1 };   // 左上角休眠区
    default:
      return null;
  }
}
