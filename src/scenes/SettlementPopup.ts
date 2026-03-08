/**
 * 月结算弹窗
 *
 * 在 endTurn 完成后显示，展示本月净变化总览 + 事件日志 + 弟子动态 + 任务摘要。
 * 调用方式：popup.show(report)；用户点击"确认"后 hide()。
 */

import Phaser from 'phaser';
import type { SettlementReport } from '../runtime/turn_engine/types';
import type { GameManager } from '../game/GameManager';

// ── 样式常量 ──
const COLOR_BG       = 0x0d0d1e;
const COLOR_BORDER   = 0xc9a959;
const COLOR_TITLE    = '#c9a959';
const COLOR_SECTION  = '#aaddff';
const COLOR_BODY     = '#cccccc';
const COLOR_POSITIVE = '#88cc88';
const COLOR_NEGATIVE = '#cc6666';
const COLOR_NEUTRAL  = '#aaaaaa';
const COLOR_DIVIDER  = '#333355';

const POPUP_W  = 360;
const POPUP_H  = 720;  // taller to fit B1 source breakdown
const POPUP_CX = 195;  // center x (screen is 390px wide)
const POPUP_CY = 415;  // center y — shifted down slightly to stay clear of resource bar

const LINE_H   = 22;
const INDENT_X = 8;    // body text x-offset from left edge inside popup

export class SettlementPopup {
  private readonly scene: Phaser.Scene;
  private readonly gameManager: GameManager;
  private readonly container: Phaser.GameObjects.Container;
  private readonly blocker: Phaser.GameObjects.Rectangle;
  private dynamicItems: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, gameManager: GameManager) {
    this.scene = scene;
    this.gameManager = gameManager;
    // 半透明背景遮罩（拦截点击）
    this.blocker = scene.add.rectangle(195, 420, 390, 845, 0x000000, 0.55);
    this.blocker.setDepth(99);
    this.blocker.setInteractive();   // 吃掉点击事件，防止穿透
    this.blocker.setVisible(false);

    // 弹窗容器
    this.container = scene.add.container(POPUP_CX, POPUP_CY);
    this.container.setDepth(100);
    this.container.setVisible(false);

    // 固定背景
    const bg = scene.add.rectangle(0, 0, POPUP_W, POPUP_H, COLOR_BG, 0.97);
    bg.setStrokeStyle(2, COLOR_BORDER);
    this.container.add(bg);
  }

  show(report: SettlementReport): void {
    // 清除上次内容
    this.dynamicItems.forEach(item => item.destroy());
    this.dynamicItems = [];

    this.buildContent(report);

    this.blocker.setVisible(true);
    this.container.setVisible(true);
  }

  hide(): void {
    this.blocker.setVisible(false);
    this.container.setVisible(false);
  }

  private buildContent(report: SettlementReport): void {
    const db      = this.gameManager.getContentDB();
    const state   = this.gameManager.getState();
    const half    = POPUP_H / 2;

    let y = -half + 30;  // 从顶部开始

    const addText = (
      text: string,
      opts: { color?: string; bold?: boolean; align?: 'center' | 'left'; xOff?: number } = {},
    ): void => {
      const { color = COLOR_BODY, bold = false, align = 'center', xOff = 0 } = opts;
      const font  = `${bold ? 'bold ' : ''}13px Arial`;
      const maxW  = POPUP_W - 24;

      const t = this.scene.add.text(
        align === 'left' ? -half + 16 + xOff : xOff,
        y,
        text,
        { font, color, wordWrap: { width: maxW } },
      );
      t.setOrigin(align === 'left' ? 0 : 0.5, 0);
      this.container.add(t);
      this.dynamicItems.push(t);

      // 根据实际渲染行数推进 y
      const lines = Math.max(1, Math.ceil(t.width / maxW));
      y += LINE_H * lines;
    };

    const addDivider = (): void => {
      const d = this.scene.add.text(0, y, '─────────────────────────────', {
        font: '11px Arial', color: COLOR_DIVIDER,
      }).setOrigin(0.5, 0);
      this.container.add(d);
      this.dynamicItems.push(d);
      y += 14;
    };

    const addCloseButton = (): void => {
      const btnY = half - 36;
      const btnBg = this.scene.add.rectangle(0, btnY, 140, 32, 0x2a2a4e)
        .setStrokeStyle(1, COLOR_BORDER)
        .setInteractive();
      const btnText = this.scene.add.text(0, btnY, '确认关闭', {
        font: 'bold 14px Arial', color: COLOR_TITLE,
      }).setOrigin(0.5);

      btnBg.on('pointerdown', () => this.hide());
      btnBg.on('pointerover',  () => btnBg.setFillStyle(0x4a4a2e));
      btnBg.on('pointerout',   () => btnBg.setFillStyle(0x2a2a4e));

      this.container.add([btnBg, btnText]);
      this.dynamicItems.push(btnBg, btnText);
    };

    // ── 标题 ──
    const yr  = report.yearIndex + 1;
    const mo  = (report.monthIndex % 12) + 1;
    addText(`第${yr}年 第${mo}月  月结算报告`, { color: COLOR_TITLE, bold: true });
    y += 4;
    addDivider();

    // ── 资源净变化 ──
    addText('◆ 资源变化', { color: COLOR_SECTION, bold: true });
    y += 2;

    const netMap: Record<string, number> = {};
    for (const group of report.resourceChanges) {
      for (const ch of group.changes) {
        const key = ch.key ?? ch.type;
        netMap[key] = (netMap[key] ?? 0) + ch.delta;
      }
    }

    const RESOURCE_LABELS: Record<string, string> = {
      silver: '银两', reputation: '声望', morale: '士气',
      inheritance: '传承', food: '粮草', wood: '木材',
      stone: '石料', herbs: '药材', iron: '铁料',
    };

    const netEntries = Object.entries(netMap)
      .filter(([, v]) => v !== 0)
      .sort(([a], [b]) => a.localeCompare(b));

    // 缩写资源标签（用于来源明细的紧凑格式）
    const SHORT_RES: Record<string, string> = {
      silver: '银', reputation: '望', morale: '气',
      inheritance: '承', food: '粮', wood: '木',
      stone: '石', herbs: '药', iron: '铁',
    };

    if (netEntries.length === 0) {
      addText('  无变化', { color: COLOR_NEUTRAL, align: 'left' });
    } else {
      // 每行显示 2 列
      for (let i = 0; i < netEntries.length; i += 2) {
        const parts = netEntries.slice(i, i + 2).map(([k, v]) => {
          const label = RESOURCE_LABELS[k] ?? k;
          const sign  = v >= 0 ? '+' : '';
          return `${label} ${sign}${v}`;
        });
        const color = netEntries[i][1] >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE;
        addText(parts.join('    '), { color, align: 'left', xOff: INDENT_X });
      }
    }

    // ── 来源明细 ──
    const nonEmptyGroups = report.resourceChanges.filter(g =>
      g.changes.some(ch => ch.delta !== 0),
    );
    if (nonEmptyGroups.length > 0) {
      y += 6;
      addText('来源明细:', { color: COLOR_NEUTRAL, align: 'left', xOff: INDENT_X });

      // 来源颜色映射
      const SRC_COLOR: Record<string, string> = {
        production:         COLOR_POSITIVE,
        upkeep:             COLOR_NEGATIVE,
        building_passive:   '#aaddaa',
        mission_settlement: '#88ccff',
        mission_tick:       COLOR_NEUTRAL,
        inner_event:        '#ffaa44',
        pre:                COLOR_NEUTRAL,
      };

      // 来源标签
      const srcLabel = (src: { kind: string; id?: string }): string => {
        if (src.kind === 'building') {
          if (src.id === 'production')       return '产出';
          if (src.id === 'upkeep')           return '维护';
          if (src.id === 'building_passive') return '被动';
          return '建筑';
        }
        if (src.kind === 'mission') {
          return src.id === 'mission_settlement' ? '任务结算' : '任务进行';
        }
        if (src.kind === 'event')  return '事件';
        if (src.kind === 'system') return src.id === 'pre' ? '本月操作' : '系统';
        return src.id ?? src.kind;
      };

      for (const group of nonEmptyGroups.slice(0, 6)) {
        // 聚合本组各资源变化
        const totals: Record<string, number> = {};
        for (const ch of group.changes) {
          const key = ch.key ?? ch.type;
          totals[key] = (totals[key] ?? 0) + ch.delta;
        }
        const changes = Object.entries(totals)
          .filter(([, v]) => v !== 0)
          .map(([k, v]) => `${SHORT_RES[k] ?? k}${v >= 0 ? '+' : ''}${v}`)
          .join(' ');
        if (!changes) continue;

        const color = SRC_COLOR[group.source.id ?? ''] ??
          (group.source.kind === 'event' ? '#ffaa44' : COLOR_NEUTRAL);

        addText(
          `  · ${srcLabel(group.source)}   ${changes}`,
          { color, align: 'left', xOff: INDENT_X },
        );
      }
    }

    y += 4;
    addDivider();

    // ── 事件日志 ──
    addText('◆ 本月事件', { color: COLOR_SECTION, bold: true });
    y += 2;

    if (report.eventsTriggered.length === 0) {
      addText('  本月无事件', { color: COLOR_NEUTRAL, align: 'left' });
    } else {
      for (const ev of report.eventsTriggered) {
        // 尝试从 ContentDB 查找事件名
        const eventDef = db?.events.events.find(e => e.id === ev.eventId);
        const eventName = eventDef?.name ?? ev.eventId;

        let optionLabel = '';
        if (ev.optionId) {
          const optDef = eventDef?.options.find(o => o.id === ev.optionId);
          optionLabel = optDef ? ` [${optDef.text.slice(0, 8)}]` : ` [${ev.optionId}]`;
        }

        let rollLabel = '';
        if (ev.roll) {
          rollLabel = ev.roll.result === 'success' ? ' ✓' : ' ✗';
        }

        addText(`▶ ${eventName}${optionLabel}${rollLabel}`, {
          color: '#ffaa44', bold: true, align: 'left',
        });

        for (const summary of ev.effectsSummary) {
          addText(`    ${summary}`, { color: COLOR_BODY, align: 'left' });
        }
      }
    }
    y += 4;
    addDivider();

    // ── 弟子动态 ──
    addText('◆ 弟子动态', { color: COLOR_SECTION, bold: true });
    y += 2;

    const changedDisciples = report.disciplesChanged.filter(
      (dc) => (dc.statusAdded?.length ?? 0) > 0 ||
               (dc.statusRemoved?.length ?? 0) > 0 ||
               Object.keys(dc.trainingDelta ?? {}).length > 0,
    );

    if (changedDisciples.length === 0) {
      addText('  无变化', { color: COLOR_NEUTRAL, align: 'left' });
    } else {
      for (const dc of changedDisciples.slice(0, 5)) {
        const disciple = state.disciples.find(d => d.id === dc.discipleId);
        const dName = disciple?.name ?? dc.discipleId;

        const parts: string[] = [];
        if (dc.statusAdded?.length) {
          parts.push(...dc.statusAdded.map(s => `+${s}`));
        }
        if (dc.statusRemoved?.length) {
          parts.push(...dc.statusRemoved.map(s => `-${s}`));
        }
        if (dc.trainingDelta) {
          for (const [track, delta] of Object.entries(dc.trainingDelta)) {
            if (delta !== 0) parts.push(`修炼${track}${delta >= 0 ? '+' : ''}${delta}`);
          }
        }

        if (parts.length > 0) {
          addText(`${dName}: ${parts.join(' ')}`, {
            color: COLOR_BODY, align: 'left',
          });
        }
      }
      if (changedDisciples.length > 5) {
        addText(`…等 ${changedDisciples.length} 名弟子有变化`, {
          color: COLOR_NEUTRAL, align: 'left',
        });
      }
    }
    y += 4;
    addDivider();

    // ── 任务摘要 ──
    addText('◆ 任务进度', { color: COLOR_SECTION, bold: true });
    y += 2;

    if (report.missionsSummary.length === 0) {
      addText('  无活跃任务', { color: COLOR_NEUTRAL, align: 'left' });
    } else {
      for (const ms of report.missionsSummary.slice(0, 5)) {
        const tmplDef = db?.missions.templates.find(t => t.id === ms.templateId);
        const missionName = tmplDef?.name ?? ms.templateId;

        if (ms.state === 'finished') {
          const rewardStr = ms.rewardsSummary?.join('  ') ?? '';
          addText(
            `✓ ${missionName}${rewardStr ? '  ' + rewardStr : ''}`,
            { color: COLOR_POSITIVE, align: 'left' },
          );
        } else {
          addText(
            `⧖ ${missionName}  剩${ms.remainingMonths ?? '?'}月`,
            { color: COLOR_NEUTRAL, align: 'left' },
          );
        }
      }
    }

    // ── 关闭按钮（固定在底部） ──
    addCloseButton();
  }
}
