/**
 * 实时时钟管理器
 *
 * 职责：根据真实帧时间（delta ms）推进游戏内时间，
 * 在每个游戏月结束时调用 onMonthEnd 回调。
 *
 * 时间常量（1× 速度）：
 *   10 真实秒 = 1 游戏小时
 *   1 游戏天  = 24 小时  = 240 真实秒
 *   1 游戏月  = 30 天    = 7200 真实秒 ≈ 2 真实小时
 *
 * 不依赖 Phaser，不依赖 GameState，纯逻辑类。
 */

import type { TimeState } from '../runtime/turn_engine/types';

export const MS_PER_GAME_HOUR = 10_000;  // 10 真实秒 = 1 游戏小时（1× 速度）
export const HOURS_PER_DAY   = 24;
export const DAYS_PER_MONTH  = 30;
export const MONTHS_PER_YEAR = 12;

export class TimeManager {
  private year:  number;
  private month: number;   // 1-12
  private day:   number;   // 1-30
  private hour:  number;   // 0-23
  private speed: 0 | 1 | 2 | 4;

  /** 累计未消耗的毫秒（已乘速度倍率） */
  private accumMs = 0;

  /** 月末回调，由 GameManager 注入（= endTurn） */
  private readonly onMonthEnd: () => void;

  constructor(initial: TimeState, onMonthEnd: () => void) {
    this.year     = initial.year;
    this.month    = initial.month;
    this.day      = initial.day;
    this.hour     = initial.hour;
    this.speed    = initial.speed;
    this.onMonthEnd = onMonthEnd;
  }

  /**
   * 每帧调用一次（由 MainScene.update 经由 GameManager 转发）。
   * @param deltaMs 真实帧时间（毫秒）
   * @returns 本次调用是否有时间推进（用于决定是否 emit timeChanged）
   */
  tick(deltaMs: number): boolean {
    if (this.speed === 0) return false;

    this.accumMs += deltaMs * this.speed;
    let changed = false;

    while (this.accumMs >= MS_PER_GAME_HOUR) {
      this.accumMs -= MS_PER_GAME_HOUR;
      this.advanceHour();
      changed = true;
    }

    return changed;
  }

  setSpeed(speed: 0 | 1 | 2 | 4): void {
    this.speed = speed;
  }

  getState(): TimeState {
    return {
      year:  this.year,
      month: this.month,
      day:   this.day,
      hour:  this.hour,
      speed: this.speed,
    };
  }

  /** 从外部重置（loadGame 时用） */
  reset(state: TimeState): void {
    this.year   = state.year;
    this.month  = state.month;
    this.day    = state.day;
    this.hour   = state.hour;
    this.speed  = state.speed;
    this.accumMs = 0;
  }

  // ── 内部推进逻辑 ──

  private advanceHour(): void {
    this.hour++;
    if (this.hour < HOURS_PER_DAY) return;

    this.hour = 0;
    this.day++;
    if (this.day <= DAYS_PER_MONTH) return;

    // 月末
    this.day = 1;
    this.month++;
    if (this.month > MONTHS_PER_YEAR) {
      this.month = 1;
      this.year++;
    }
    this.onMonthEnd();
  }
}
