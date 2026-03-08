import Phaser from 'phaser';
import type { GameState } from '../runtime/turn_engine/types';

export type VirtualSceneId =
  | 'sect_gate'
  | 'training_ground'
  | 'jianghu_map'
  | 'tournament_arena';

export interface VirtualSceneDef {
  id: VirtualSceneId;
  name: string;
  icon: string;
  bgColor: number;
  showGrid: boolean;
  overlayText: string;
}

export const VIRTUAL_SCENE_DEFS: readonly VirtualSceneDef[] = [
  {
    id: 'sect_gate',
    name: '山门',
    icon: '⛩',
    bgColor: 0x4a6741,
    showGrid: true,
    overlayText: '',
  },
  {
    id: 'training_ground',
    name: '练武场',
    icon: '⚔',
    bgColor: 0x5a4030,
    showGrid: true,
    overlayText: '练武场',
  },
  {
    id: 'jianghu_map',
    name: '江湖',
    icon: '🗺',
    bgColor: 0x1a3a5a,
    showGrid: false,
    overlayText: '江湖地图\n天下风云录',
  },
  {
    id: 'tournament_arena',
    name: '擂台',
    icon: '🏆',
    bgColor: 0x4a1010,
    showGrid: false,
    overlayText: '武林大会\n群雄汇聚',
  },
];

/**
 * 虚拟场景管理器。
 *
 * 纯视觉层：不修改 GameState。
 * 通过 EventEmitter 通知 MainScene / UIScene 更新。
 */
export class SceneManager extends Phaser.Events.EventEmitter {
  private static instance: SceneManager | null = null;

  private current: VirtualSceneId = 'sect_gate';
  private previous: VirtualSceneId = 'sect_gate';

  private constructor() {
    super();
  }

  static getInstance(): SceneManager {
    if (!SceneManager.instance) SceneManager.instance = new SceneManager();
    return SceneManager.instance;
  }

  /** 重置（读档/新游戏时调用） */
  static reset(): void {
    SceneManager.instance = null;
  }

  getCurrentScene(): VirtualSceneId {
    return this.current;
  }

  getPreviousScene(): VirtualSceneId {
    return this.previous;
  }

  /**
   * 切换到指定虚拟场景（检查解锁状态）。
   * 如果已在该场景则忽略。
   */
  switchTo(id: VirtualSceneId, state: GameState): boolean {
    if (id === this.current) return true;
    if (!this.isUnlocked(id, state)) return false;
    this.previous = this.current;
    this.current = id;
    this.emit('virtualSceneChanged', id, this.previous);
    return true;
  }

  /**
   * 强制切换（无视解锁，用于大会自动切换）。
   */
  forceSwitchTo(id: VirtualSceneId): void {
    if (id === this.current) return;
    this.previous = this.current;
    this.current = id;
    this.emit('virtualSceneChanged', id, this.previous);
  }

  /** 返回上一个场景。 */
  switchBack(): void {
    const prev = this.previous;
    this.previous = this.current;
    this.current = prev;
    this.emit('virtualSceneChanged', this.current, this.previous);
  }

  isUnlocked(id: VirtualSceneId, state: GameState): boolean {
    return this.getUnlocked(state).includes(id);
  }

  getAvailable(state: GameState): VirtualSceneId[] {
    return this.getUnlocked(state);
  }

  getDef(id: VirtualSceneId): VirtualSceneDef {
    return VIRTUAL_SCENE_DEFS.find(d => d.id === id)!;
  }

  private getUnlocked(state: GameState): VirtualSceneId[] {
    const list: VirtualSceneId[] = ['sect_gate'];

    // 练武场：已建造 training_ground
    if (Object.values(state.grid.placedBuildings).some(b => b.defId === 'training_ground')) {
      list.push('training_ground');
    }

    // 江湖地图：第2章不为 locked
    const ch2 = state.story?.chapters?.find(c => c.id === 'story.ch2');
    if (ch2 && ch2.status !== 'locked') list.push('jianghu_map');

    // 大会擂台：大会进行中
    if (state.tournament?.active) list.push('tournament_arena');

    return list;
  }
}
