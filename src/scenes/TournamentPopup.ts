/**
 * 武林大会结算弹窗
 *
 * 在大会 conclude 后显示，展示成绩、排名、奖励。
 * 复用 SettlementPopup 视觉风格（颜色常量、布局）。
 */

import Phaser from 'phaser';
import type { TournamentState } from '../runtime/turn_engine/types';
import type { GameManager } from '../game/GameManager';
import { resolveEnding } from '../runtime/systems/tournament/ending_resolver';

// ── 复用 SettlementPopup 风格常量 ──
const COLOR_BG       = 0x0d0d1e;
const COLOR_BORDER   = 0xc9a959;
const COLOR_TITLE    = '#c9a959';
const COLOR_SECTION  = '#aaddff';
const COLOR_BODY     = '#cccccc';
const COLOR_POSITIVE = '#88cc88';
const COLOR_NEUTRAL  = '#aaaaaa';
const COLOR_DIVIDER  = '#333355';

const POPUP_W  = 340;
const POPUP_H  = 560;
const POPUP_CX = 195;
const POPUP_CY = 420;
const LINE_H   = 22;

type Rank = 'champion' | 'topThree' | 'participant';

function calcRank(t: TournamentState): Rank {
  const score =
    t.results.martialWins * 20 +
    t.results.debateScore * 10 +
    t.results.allianceScore * 10 +
    t.influence;
  if (score >= 150) return 'champion';
  if (score >= 50)  return 'topThree';
  return 'participant';
}

function totalScore(t: TournamentState): number {
  return (
    t.results.martialWins * 20 +
    t.results.debateScore * 10 +
    t.results.allianceScore * 10 +
    t.influence
  );
}

export class TournamentPopup {
  private readonly scene: Phaser.Scene;
  private readonly gameManager: GameManager;
  private readonly container: Phaser.GameObjects.Container;
  private readonly blocker: Phaser.GameObjects.Rectangle;
  private dynamicItems: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, gameManager: GameManager) {
    this.scene = scene;
    this.gameManager = gameManager;

    this.blocker = scene.add.rectangle(195, 420, 390, 845, 0x000000, 0.6);
    this.blocker.setDepth(101);
    this.blocker.setInteractive();
    this.blocker.setVisible(false);

    this.container = scene.add.container(POPUP_CX, POPUP_CY);
    this.container.setDepth(102);
    this.container.setVisible(false);

    const bg = scene.add.rectangle(0, 0, POPUP_W, POPUP_H, COLOR_BG, 0.97);
    bg.setStrokeStyle(2, COLOR_BORDER);
    this.container.add(bg);
  }

  show(tournament: TournamentState): void {
    this.dynamicItems.forEach(item => item.destroy());
    this.dynamicItems = [];
    this.buildContent(tournament);
    this.blocker.setVisible(true);
    this.container.setVisible(true);
  }

  hide(): void {
    this.blocker.setVisible(false);
    this.container.setVisible(false);
  }

  private buildContent(t: TournamentState): void {
    const db   = this.gameManager.getContentDB();
    const half = POPUP_H / 2;
    let y = -half + 28;

    const addText = (
      text: string,
      opts: { color?: string; bold?: boolean; align?: 'center' | 'left'; xOff?: number } = {},
    ): void => {
      const { color = COLOR_BODY, bold = false, align = 'center', xOff = 0 } = opts;
      const font = `${bold ? 'bold ' : ''}13px Arial`;
      const maxW = POPUP_W - 24;
      const t = this.scene.add.text(
        align === 'left' ? -POPUP_W / 2 + 16 + xOff : xOff,
        y,
        text,
        { font, color, wordWrap: { width: maxW } },
      );
      t.setOrigin(align === 'left' ? 0 : 0.5, 0);
      this.container.add(t);
      this.dynamicItems.push(t);
      y += LINE_H * Math.max(1, Math.ceil(t.width / maxW));
    };

    const addDivider = (): void => {
      const d = this.scene.add.text(0, y, '─────────────────────────────', {
        font: '11px Arial', color: COLOR_DIVIDER,
      }).setOrigin(0.5, 0);
      this.container.add(d);
      this.dynamicItems.push(d);
      y += 14;
    };

    const rank = calcRank(t);
    const score = totalScore(t);

    // ── 标题 ──
    addText(`🏆 第${t.year}届武林大会 · 落幕`, { color: COLOR_TITLE, bold: true });
    y += 4;
    addDivider();

    // ── 比赛成绩 ──
    addText('◆ 比赛成绩', { color: COLOR_SECTION, bold: true });
    y += 2;
    addText(`武道比试：胜场 ${t.results.martialWins}  (×20 = ${t.results.martialWins * 20}分)`, {
      color: COLOR_BODY, align: 'left',
    });
    addText(`论道辩难：得分 ${t.results.debateScore}  (×10 = ${t.results.debateScore * 10}分)`, {
      color: COLOR_BODY, align: 'left',
    });
    addText(`纵横结盟：得分 ${t.results.allianceScore}  (×10 = ${t.results.allianceScore * 10}分)`, {
      color: COLOR_BODY, align: 'left',
    });
    if (t.influence > 0) {
      addText(`门派影响力：${t.influence}分`, { color: COLOR_BODY, align: 'left' });
    }
    addText(`总积分：${score}`, { color: COLOR_TITLE, bold: true, align: 'left' });
    y += 4;
    addDivider();

    // ── 最终排名 ──
    addText('◆ 最终排名', { color: COLOR_SECTION, bold: true });
    y += 2;
    const RANK_INFO: Record<Rank, { icon: string; label: string; color: string; texture: string }> = {
      champion:    { icon: '🥇', label: '武林盟主 · 本派荣耀！',  color: COLOR_TITLE,   texture: 'icon_trophy_champion'    },
      topThree:    { icon: '🥈', label: '名列前茅 · 勇夺前三',   color: '#88ddff',     texture: 'icon_trophy_topthree'    },
      participant: { icon: '🏅', label: '参与荣耀 · 扬名立万',   color: COLOR_NEUTRAL, texture: 'icon_trophy_participant' },
    };
    const ri = RANK_INFO[rank];

    // 奖杯图标（如果存在）
    if (this.scene.textures.exists(ri.texture)) {
      const trophyIcon = this.scene.add.image(-60, y + 10, ri.texture)
        .setScale(rank === 'champion' ? 0.6 : 0.5)
        .setOrigin(0.5);
      this.container.add(trophyIcon);
      this.dynamicItems.push(trophyIcon);
      const rankLabel = this.scene.add.text(10, y, ri.label, {
        font: 'bold 14px Arial', color: ri.color,
      }).setOrigin(0, 0);
      this.container.add(rankLabel);
      this.dynamicItems.push(rankLabel);
      y += LINE_H + 4;
    } else {
      addText(`${ri.icon} ${ri.label}`, { color: ri.color, bold: true });
    }
    y += 4;
    addDivider();

    // ── 获得奖励 ──
    addText('◆ 获得奖励', { color: COLOR_SECTION, bold: true });
    y += 2;

    const rewardDef = db?.tournament?.rewards[rank];
    if (rewardDef) {
      const LABELS: Record<string, string> = {
        reputation_delta: '声望', morale_delta: '士气',
        currency_delta: '银两',
      };
      const parts = rewardDef.effects.map(eff => {
        const label = eff.type === 'currency_delta'
          ? (eff.key === 'silver' ? '银两' : eff.key ?? '?')
          : (LABELS[eff.type] ?? eff.type);
        const sign = (eff.delta ?? 0) >= 0 ? '+' : '';
        return `${sign}${eff.delta ?? 0} ${label}`;
      });
      addText(parts.join('   '), { color: COLOR_POSITIVE, align: 'left' });
      if (rank === 'champion' && rewardDef.title) {
        addText(`称号：${rewardDef.title}`, { color: COLOR_TITLE, align: 'left' });
      }
    } else {
      addText('暂无奖励信息', { color: COLOR_NEUTRAL, align: 'left' });
    }

    // ── 结局判定 ──
    y += 4;
    addDivider();
    addText('◆ 最终结局', { color: COLOR_SECTION, bold: true });
    y += 2;

    const state   = this.gameManager.getState();
    const ending  = resolveEnding(state, t);
    addText(ending.title, { color: COLOR_TITLE, bold: true });
    addText(ending.description, { color: COLOR_BODY, align: 'left' });

    // 评分概览（单行紧凑显示）
    const bp = ending.scoreBreakdown;
    addText(
      `综合评分：${ending.score}/100  [望${bp.reputation} 产${bp.buildings} 承${bp.legacy} 弟${bp.disciples} 湖${bp.factions}]`,
      { color: '#88aacc', align: 'left' },
    );

    // 成就（最多 3 条）
    if (ending.achievements.length > 0) {
      addText(ending.achievements.slice(0, 3).map(a => `★ ${a}`).join('  '), {
        color: COLOR_POSITIVE, align: 'left',
      });
    }

    // ── 关闭按钮 ──
    const btnY = half - 36;
    const btnBg = this.scene.add.rectangle(0, btnY, 140, 32, 0x2a2a4e)
      .setStrokeStyle(1, COLOR_BORDER)
      .setInteractive();
    const btnText = this.scene.add.text(0, btnY, '确认', {
      font: 'bold 14px Arial', color: COLOR_TITLE,
    }).setOrigin(0.5);

    btnBg.on('pointerdown', () => this.hide());
    btnBg.on('pointerover',  () => btnBg.setFillStyle(0x4a4a2e));
    btnBg.on('pointerout',   () => btnBg.setFillStyle(0x2a2a4e));

    this.container.add([btnBg, btnText]);
    this.dynamicItems.push(btnBg, btnText);
  }
}
