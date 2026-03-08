import Phaser from 'phaser';
import { GameManager } from '../game/GameManager';
import type { PlacedBuilding, SettlementReport, TimeState } from '../runtime/turn_engine/types';
import { SettlementPopup } from './SettlementPopup';
import { TournamentPopup } from './TournamentPopup';
import { Toast } from './Toast';
import { checkUpgradeRequirements } from '../runtime/systems/building/upgrade';
import { SceneManager, VIRTUAL_SCENE_DEFS } from '../game/SceneManager';
import type { VirtualSceneId } from '../game/SceneManager';
import { TournamentManager } from '../runtime/systems/tournament/manager';

type TabType = 'overview' | 'build' | 'disciples' | 'missions' | 'martial' | 'faction';

// ── 武林大会常量 ──
const TOURNAMENT_PHASE_ORDER = ['announcement', 'gathering', 'martial', 'debate', 'politics', 'conclusion'] as const;
const TOURNAMENT_PHASE_NAMES: Record<string, string> = {
  announcement: '宣布召开', gathering: '群雄汇聚', martial: '武道比试',
  debate: '论道辩难', politics: '纵横结盟', conclusion: '盟主归属',
};
// 大会面板布局常量
const TP_CX  = 195;  // center-x
const TP_CY  = 150;  // center-y (shifted down slightly for extra row)
const TP_W   = 360;  // width
const TP_H   = 148;  // height (extended to fit representative row)

const SPEED_VALUES   = [0, 1, 2, 4] as const;
const SPEED_TEXTURES = ['ui_speed_pause', 'ui_speed_1x', 'ui_speed_2x', 'ui_speed_4x'] as const;

export class UIScene extends Phaser.Scene {
  private gameManager!: GameManager;
  private resourceTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private dateText!: Phaser.GameObjects.Text;
  private speedButtons: Phaser.GameObjects.Image[] = [];
  private currentTab: TabType = 'overview';
  private tabButtons: Phaser.GameObjects.Container[] = [];
  private tabPanels: Map<TabType, Phaser.GameObjects.Container> = new Map();
  private tabContentItems: Map<TabType, Phaser.GameObjects.GameObject[]> = new Map();
  private selectedBuilding: PlacedBuilding | null = null;
  private selectedDiscipleId: string | null = null;
  private selectedMissionTemplateId: string | null = null;
  private missionPartyIds: string[] = [];
  private buildingSlotAssign: { buildingId: string; slotIndex: number } | null = null;
  private martialResearchArtId: string | null = null;
  private martialResearchPartyIds: string[] = [];
  private martialDiscipleId: string | null = null;
  private breakthroughDiscipleId: string | null = null;
  /** v1.5：师徒选择面板的当前弟子 ID */
  private mastershipDiscipleId: string | null = null;
  private selectedFactionId: string | null = null;
  private panelVisible = false;
  private settlementPopup!: SettlementPopup;
  private tournamentPopup!: TournamentPopup;
  private toast!: Toast;

  // ── 武林大会面板 ──
  private tournamentPanel!: Phaser.GameObjects.Container;
  private tournamentPanelItems: Phaser.GameObjects.GameObject[] = [];
  private lastKnownPhase: string | null = null;
  /** 大会选派模式：当前正在选派阶段的弟子 ID（null=未激活） */
  private tournamentSelectDiscipleId: string | null = null;

  // ── 虚拟场景导航 ──
  private sceneNavButtons: Phaser.GameObjects.Container[] = [];
  private prevTournamentActive = false;

  // ── 主线详情弹窗 ──
  private storyDetailContainer!: Phaser.GameObjects.Container;
  private storyDetailBlocker!: Phaser.GameObjects.Rectangle;
  private storyDetailItems: Phaser.GameObjects.GameObject[] = [];
  private storyDetailVisible = false;
  /** 已折叠的已完成章节 ID 集合 */
  private collapsedChapters: Set<string> = new Set();

  private readonly PANEL_X = 195;
  private readonly PANEL_Y = 530;
  private readonly PANEL_W = 370;
  private readonly PANEL_H = 300;
  private readonly PANEL_LINE_H = 24;
  private readonly PANEL_MAX_LINES = 10;

  constructor() {
    super({ key: 'UIScene' });
  }

  create() {
    this.gameManager = GameManager.getInstance();

    this.createResourceBar();
    this.createTabPanels();
    this.createBottomNav();
    this.createEndTurnButton();
    this.createSaveLoadButtons();
    this.createSceneNavButtons();
    this.createTournamentPanel();

    // 主线详情弹窗（depth=148/149，位于 SettlementPopup 之上，Toast 之下）
    this.createStoryDetailPopup();

    // 结算弹窗（在所有其他 UI 之后创建，确保在最顶层）
    this.settlementPopup = new SettlementPopup(this, this.gameManager);

    // 武林大会结算弹窗（depth 高于 SettlementPopup）
    this.tournamentPopup = new TournamentPopup(this, this.gameManager);

    // Toast 通知层（depth=200，始终覆盖普通 UI）
    this.toast = new Toast(this);
    this.gameManager.on('toastError', (msg: string) => this.toast.show(msg));
    this.gameManager.on('objectiveComplete', (info: { id: string; description: string }) => {
      this.toast.show(`目标完成：${info.description}`, 'success');
    });
    this.gameManager.on('upgradeComplete', (info: { name: string; level: number }) => {
      this.toast.show(`${info.name} 升级至 Lv.${info.level} 完成！`, 'success');
    });
    this.gameManager.on('chapterAdvanced', (info: {
      completedChNum: number; completedTitle: string;
      unlockedChNum: number | null; unlockedTitle: string | null;
    }) => {
      const msg = info.unlockedTitle
        ? `第${info.completedChNum}章完成！解锁第${info.unlockedChNum}章：${info.unlockedTitle}`
        : `第${info.completedChNum}章「${info.completedTitle}」全部完成！`;
      this.toast.show(msg, 'success');
    });
    this.gameManager.on('unlockGranted', (info: { type: string; id: string; name: string }) => {
      this.toast.show(`🔓 解锁：${info.name}`, 'success');
    });

    this.gameManager.on('stateChanged', () => this.updateUI());
    this.gameManager.on('timeChanged', (ts: TimeState) => this.updateTimeDisplay(ts));
    // stateChanged fires before turnEnded, so UI is already updated; just show popup
    this.gameManager.on('turnEnded', (report: SettlementReport) => {
      this.settlementPopup.show(report);
    });
    this.gameManager.on('tournamentConcluded', (t: import('../runtime/turn_engine/types').TournamentState) => {
      this.tournamentPopup.show(t);
      // 大会结束 → 返回之前的场景
      SceneManager.getInstance().switchBack();
    });

    // 虚拟场景变化 → 刷新场景导航按钮
    SceneManager.getInstance().on('virtualSceneChanged', (_newScene: VirtualSceneId) => {
      this.updateSceneNavButtons();
    });
    // 建造模式状态变化时刷新 build tab
    this.gameManager.on('enterBuildMode', () => {
      if (this.currentTab === 'build') this.refreshTabContent('build');
    });
    this.gameManager.on('exitBuildMode', () => {
      if (this.currentTab === 'build') this.refreshTabContent('build');
    });
    this.gameManager.on('buildingClicked', (building: PlacedBuilding) => {
      this.selectedBuilding = building;
      this.buildingSlotAssign = null;
      if (this.currentTab === 'build') {
        this.refreshTabContent('build');
      } else {
        this.switchTab('build');
      }
    });

    // Phase 5: NPC 点击 → toast 显示弟子当前状态
    this.gameManager.on('npcClicked', (discipleId: string) => {
      const state = this.gameManager.getState();
      const d     = state.disciples.find(x => x.id === discipleId);
      if (!d) return;
      const ts     = this.gameManager.getTimeState();
      const isNight = ts.hour >= 22 || ts.hour < 6;
      const statusStr = isNight ? '夜间休息中'
        : d.job        ? `在 ${d.job.buildingInstanceId.slice(0, 6)} 工作`
        :                '闲逛中';
      this.toast.show(`${d.name}：${statusStr}`, 'warn');
    });
    this.events.on('shutdown', () => {
      this.gameManager.off('stateChanged');
      this.gameManager.off('turnEnded');
      this.gameManager.off('buildingClicked');
      this.gameManager.off('toastError');
      this.gameManager.off('objectiveComplete');
      this.gameManager.off('upgradeComplete');
      this.gameManager.off('enterBuildMode');
      this.gameManager.off('exitBuildMode');
      this.gameManager.off('timeChanged');
      this.gameManager.off('npcClicked');
      this.gameManager.off('tournamentConcluded');
      this.gameManager.off('chapterAdvanced');
      this.gameManager.off('unlockGranted');
      SceneManager.getInstance().off('virtualSceneChanged');
    });

    this.updateUI();
  }

  private createResourceBar() {
    const barBg = this.add.rectangle(195, 40, 370, 60, 0x1a1a2e, 0.9);
    barBg.setStrokeStyle(2, 0xc9a959);

    // ── 时间显示（左侧） ──
    this.dateText = this.add.text(82, 20, '', {
      font: 'bold 12px Arial',
      color: '#c9a959',
    }).setOrigin(0.5);

    // ── 速度按钮（右侧，紧凑排列，图标 20×20） ──
    const speedXPositions = [248, 272, 296, 320];
    SPEED_VALUES.forEach((speed, i) => {
      const btn = this.add.image(speedXPositions[i], 20, SPEED_TEXTURES[i])
        .setDisplaySize(20, 20)
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        this.gameManager.setTimeSpeed(speed);
      });
      btn.on('pointerover', () => btn.clearTint());
      btn.on('pointerout',  () => this.updateSpeedButtons());

      this.speedButtons.push(btn);
    });

    // ── 资源显示（下方一行） ──
    const resources = [
      { key: 'silver',     label: '银', x: 30  },
      { key: 'food',       label: '粮', x: 100 },
      { key: 'wood',       label: '木', x: 165 },
      { key: 'stone',      label: '石', x: 230 },
      { key: 'reputation', label: '望', x: 295 },
      { key: 'morale',     label: '气', x: 355 },
    ];

    resources.forEach(res => {
      this.add.text(res.x - 14, 45, res.label, { font: '11px Arial', color: '#888' }).setOrigin(0.5);
      const valueText = this.add.text(res.x + 12, 45, '0', {
        font: 'bold 13px Arial', color: '#ffffff',
      }).setOrigin(0, 0.5);
      this.resourceTexts.set(res.key, valueText);
    });
  }

  private updateTimeDisplay(ts: TimeState): void {
    const hh = String(ts.hour).padStart(2, '0');
    this.dateText.setText(`${ts.year}年${ts.month}月${ts.day}日 ${hh}:00`);
    this.updateSpeedButtons();
  }

  private updateSpeedButtons(): void {
    const currentSpeed = this.gameManager.getTimeState().speed;
    this.speedButtons.forEach((btn, i) => {
      const active = currentSpeed === SPEED_VALUES[i];
      if (active) {
        btn.setTint(0xc9a959);   // 金色 = 当前激活
      } else {
        btn.setTint(0x666666);   // 灰暗 = 未激活
      }
    });
  }

  private createTabPanels() {
    const TAB_ORDER: TabType[] = ['overview', 'build', 'disciples', 'missions', 'martial', 'faction'];
    const TITLES: Record<TabType, string> = {
      overview:  '门派总览',
      build:     '建造管理',
      disciples: '弟子管理',
      missions:  '任务派遣',
      martial:   '武学研究',
      faction:   '江湖势力',
    };

    TAB_ORDER.forEach(tab => {
      const container = this.add.container(0, 0);

      const bg = this.add.rectangle(this.PANEL_X, this.PANEL_Y, this.PANEL_W, this.PANEL_H, 0x1a1a2e, 0.92);
      bg.setStrokeStyle(2, 0x4a4a6a);

      const titleText = this.add.text(
        this.PANEL_X,
        this.PANEL_Y - this.PANEL_H / 2 + 24,
        TITLES[tab],
        { font: 'bold 16px Arial', color: '#c9a959' },
      ).setOrigin(0.5);

      // 右上角关闭按钮 (X)
      const closeBtn = this.add.text(
        this.PANEL_X + this.PANEL_W / 2 - 14,
        this.PANEL_Y - this.PANEL_H / 2 + 14,
        '✕',
        { font: 'bold 16px Arial', color: '#666688' },
      ).setOrigin(0.5).setInteractive({ useHandCursor: true });
      closeBtn.on('pointerover',  () => closeBtn.setColor('#ffffff'));
      closeBtn.on('pointerout',   () => closeBtn.setColor('#666688'));
      closeBtn.on('pointerdown',  () => this.setPanelVisible(false));

      container.add([bg, titleText, closeBtn]);
      container.setVisible(false); // 初始全部隐藏，等玩家点击 tab 再显示
      this.tabPanels.set(tab, container);
      this.tabContentItems.set(tab, []);
    });
  }

  private refreshTabContent(tab: TabType): void {
    const oldItems = this.tabContentItems.get(tab) ?? [];
    oldItems.forEach(item => item.destroy());

    const container = this.tabPanels.get(tab);
    if (!container) return;

    const items: Phaser.GameObjects.GameObject[] = [];
    const state  = this.gameManager.getState();
    const db     = this.gameManager.getContentDB();
    const startY = this.PANEL_Y - this.PANEL_H / 2 + 56;

    // ── helpers ──────────────────────────────────────────────────────────────
    const addLine = (text: string, lineIndex: number, color = '#cccccc'): void => {
      const t = this.add.text(
        this.PANEL_X,
        startY + lineIndex * this.PANEL_LINE_H,
        text,
        { font: '12px Arial', color, wordWrap: { width: this.PANEL_W - 24 } },
      ).setOrigin(0.5);
      container.add(t);
      items.push(t);
    };

    const addButton = (
      text: string, lineIndex: number, xOffset: number,
      normalColor: string, onClick: () => void,
    ): void => {
      const t = this.add.text(
        this.PANEL_X + xOffset,
        startY + lineIndex * this.PANEL_LINE_H,
        text,
        { font: '11px Arial', color: normalColor },
      ).setOrigin(0.5).setInteractive();
      t.on('pointerdown', onClick);
      t.on('pointerover',  () => t.setColor('#ffffff'));
      t.on('pointerout',   () => t.setColor(normalColor));
      container.add(t);
      items.push(t);
    };

    const addText = (
      text: string, lineIndex: number, xOffset: number, color = '#cccccc',
    ): void => {
      const t = this.add.text(
        this.PANEL_X + xOffset,
        startY + lineIndex * this.PANEL_LINE_H,
        text,
        { font: '12px Arial', color },
      ).setOrigin(0.5);
      container.add(t);
      items.push(t);
    };
    // ─────────────────────────────────────────────────────────────────────────

    switch (tab) {
      case 'overview': {
        // ── 主线进度（state.story） ──
        const activeChapter = state.story.chapters.find(ch => ch.status === 'active');
        const chNum         = activeChapter
          ? parseInt(activeChapter.id.replace('story.ch', ''), 10)
          : 0;
        const storyObjs  = activeChapter?.objectives ?? [];
        const doneCount  = storyObjs.filter(o => o.done).length;
        const totalCount = storyObjs.length;
        // 进度条：用目标内进度平均值（单目标时显示招募/声望进度，多目标时显示完成比例）
        const pct = totalCount > 0
          ? Math.floor(
              storyObjs.reduce((acc, o) => acc + Math.min(o.current / Math.max(o.target, 1), 1), 0)
              / totalCount * 100,
            )
          : 0;

        // Sub-background for story section (spans lines 0–2)
        const sectionBg = this.add.rectangle(
          this.PANEL_X,
          startY + this.PANEL_LINE_H,
          this.PANEL_W - 12,
          3 * this.PANEL_LINE_H + 8,
          0x1a1a3a, 0.85,
        ).setStrokeStyle(1, 0x3a3a5a);
        container.add(sectionBg);
        items.push(sectionBg);
        sectionBg.setInteractive({ useHandCursor: true });
        sectionBg.on('pointerdown', () => this.showStoryDetail());

        // Line 0: chapter title + done/total count
        addLine(
          activeChapter
            ? `第${chNum}章 ${activeChapter.title}  已完成 ${doneCount}/${totalCount}`
            : '主线章节未激活',
          0, '#c9a959',
        );

        // Line 1: progress bar (graphics)
        const barY  = startY + 1 * this.PANEL_LINE_H;
        const barW  = 280;
        const barH  = 8;
        const barBg = this.add.rectangle(this.PANEL_X, barY, barW, barH, 0x333344, 0.9)
          .setStrokeStyle(1, 0x555566);
        container.add(barBg);
        items.push(barBg);
        if (pct > 0) {
          const fillW   = Math.max(4, barW * pct / 100);
          const fillBar = this.add.rectangle(
            this.PANEL_X - barW / 2 + fillW / 2, barY, fillW, barH, 0x4a7c59,
          );
          container.add(fillBar);
          items.push(fillBar);
        }
        const pctTxt = this.add.text(
          this.PANEL_X + barW / 2 + 20, barY, `${pct}%`,
          { font: '10px Arial', color: '#6aac79' },
        ).setOrigin(0, 0.5);
        container.add(pctTxt);
        items.push(pctTxt);

        // Line 2: first undone objective with current/target
        const nextObj = storyObjs.find(o => !o.done);
        addLine(
          nextObj
            ? `当前目标: ${nextObj.text} (${nextObj.current}/${nextObj.target})`
            : '✓ 本章目标全部完成',
          2, nextObj ? '#88aacc' : '#88cc88',
        );

        addLine('──────────────────', 3, '#333355');
        addLine(`银两 ${state.resources.silver}　名望 ${state.resources.reputation}`, 4);
        addLine(`士气 ${state.resources.morale}　弟子 ${state.disciples.length}人  任务 ${state.missionsActive.length}`, 5);

        let nextLine = 6;
        if (state.recruitPool.length > 0) {
          addLine(`候选弟子：${state.recruitPool.length} 人可招募`, nextLine++, '#c9a959');
        }

        // ── B2b: 状态推荐 ──
        if (state.resources.silver < 100 && nextLine < this.PANEL_MAX_LINES) {
          addLine('⚠ 银两不足百两', nextLine++, '#cc6666');
        }
        if (state.resources.morale < 50 && nextLine < this.PANEL_MAX_LINES) {
          addLine('⚠ 士气偏低，建议修冥想室', nextLine++, '#cc8866');
        }
        const reports = this.gameManager.getReportHistory();
        if (reports.length > 0 && nextLine < this.PANEL_MAX_LINES) {
          const last = reports[reports.length - 1];
          let netSilver = 0;
          for (const g of last.resourceChanges) {
            for (const ch of g.changes) { if (ch.key === 'silver') netSilver += ch.delta; }
          }
          if (netSilver < -50) {
            addLine(`⚠ 上月银两净减${netSilver}，注意收支`, nextLine++, '#cc8866');
          }
        }
        const hasTraining = Object.values(state.grid.placedBuildings)
          .some(b => b.defId === 'training_ground');
        if (!hasTraining && nextLine < this.PANEL_MAX_LINES) {
          addLine('💡 建议建造练武场强化弟子', nextLine++, '#88aacc');
        }

        // F2: 显示可能触发的事件及玩家预选选项
        const eligibleEvents = this.gameManager.getEligibleEvents();
        for (const event of eligibleEvents.slice(0, 2)) {
          if (nextLine >= this.PANEL_MAX_LINES - 1) break;
          addLine(`▶ ${event.name}`, nextLine++, '#ffaa44');

          const optCount = Math.min(event.options.length, 3);
          const xOffsets = optCount === 1 ? [0] : optCount === 2 ? [-85, 85] : [-110, 0, 110];
          const pendingChoice = this.gameManager.getPendingEventChoice(event.id);
          const eventLineIdx = nextLine++;

          event.options.slice(0, 3).forEach((opt, oi) => {
            const isSelected = pendingChoice === opt.id;
            const label = `[${opt.text.slice(0, 6)}]`;
            addButton(label, eventLineIdx, xOffsets[oi], isSelected ? '#c9a959' : '#888888', () => {
              this.gameManager.queueEventChoice(event.id, opt.id);
              this.refreshTabContent('overview');
            });
          });
        }

        // ── S3-1: 大会备赛行动（仅在宣布/汇聚阶段显示） ──
        const t = state.tournament;
        if (t?.active && (t.phase === 'announcement' || t.phase === 'gathering')
            && nextLine < this.PANEL_MAX_LINES - 1) {
          addLine('──── 大会备赛 ────', nextLine++, '#c9a959');
          const prepActions = this.gameManager.getPrepActions();
          for (const action of prepActions) {
            if (nextLine >= this.PANEL_MAX_LINES - 1) break;
            const taken  = (t.takenPrepActions ?? []).includes(action.id);
            const canDo  = !taken && this.gameManager.canTakePrepAction(action.id).canTake;
            const queued = this.gameManager.getPendingPrepActions().includes(action.id);

            const statusCol = taken ? '#555555' : queued ? '#aaffaa' : canDo ? '#88cc88' : '#cc6666';
            const label     = taken ? `✓ ${action.name}` : queued ? `★ ${action.name}` : action.name;
            const infTag    = `+${action.influenceGain}影`;
            const costTag   = action.cost?.silver ? ` ${action.cost.silver}两` : '';
            addLine(`${label}  ${infTag}${costTag}`, nextLine, statusCol);

            if (!taken && !queued && canDo) {
              const lineForBtn = nextLine;
              addButton('[执行]', lineForBtn, 120, '#4a9a4a', () => {
                this.gameManager.queuePrepAction(action.id);
                this.refreshTabContent('overview');
              });
            }
            nextLine++;
          }
        }
        break;
      }

      case 'build': {
        if (!db) { addLine('数据加载中…', 0); break; }
        let lineIdx = 0;

        // ── 建造模式进行中 ──
        const activeBuildDefId = this.gameManager.getBuildModeDefId();
        if (activeBuildDefId) {
          const activeDef = db.buildings.buildings.find(b => b.id === activeBuildDefId);
          addLine(`建造模式：${activeDef?.name ?? activeBuildDefId}`, lineIdx++, '#c9a959');
          addLine('→ 点击地图选择放置位置', lineIdx++, '#88aacc');
          addButton('[取消建造]', lineIdx, 0, '#cc6666', () => {
            this.gameManager.exitBuildMode();
          });
          break;
        }

        // ── 弟子选择模式（从建筑工位 [→分配] 触发） ──
        if (this.buildingSlotAssign !== null && this.selectedBuilding) {
          const { buildingId, slotIndex } = this.buildingSlotAssign;
          const bld  = state.grid.placedBuildings[buildingId];
          const bDef = bld ? db.buildings.buildings.find(b => b.id === bld.defId) : undefined;

          addLine(`${bDef?.name ?? buildingId} 槽${slotIndex} — 选择弟子`, lineIdx++, '#c9a959');
          addButton('[← 取消]', lineIdx++, 0, '#cc8866', () => {
            this.buildingSlotAssign = null;
            this.refreshTabContent('build');
          });

          const available = state.disciples.filter(
            d => !state.missionsActive.some(m => m.partyDiscipleIds.includes(d.id)),
          );
          if (available.length === 0) {
            addLine('无可用弟子', lineIdx, '#666666');
          } else {
            for (const d of available) {
              if (lineIdx >= this.PANEL_MAX_LINES) break;
              const phy = d.stats['physique']      ?? 0;
              const com = d.stats['comprehension'] ?? 0;
              addText(`${d.name} 体${phy}悟${com}`, lineIdx, -40, '#cccccc');
              const capDId = d.id;
              addButton('[→选]', lineIdx, 130, '#88cc88', () => {
                this.gameManager.queueAssignJob(capDId, buildingId, slotIndex);
                this.buildingSlotAssign = null;
                this.refreshTabContent('build');
              });
              lineIdx++;
            }
          }
          break;
        }

        // ── 升级中建筑摘要（无选中建筑时在顶部显示） ──
        if (!this.selectedBuilding) {
          const upgradingBuildings = Object.values(state.grid.placedBuildings)
            .filter(b => b.upgrading);
          for (const b of upgradingBuildings) {
            if (lineIdx >= this.PANEL_MAX_LINES) break;
            const bDef = db.buildings.buildings.find(d => d.id === b.defId);
            const elapsed = state.monthIndex - b.upgrading!.startMonth;
            const remaining = Math.max(0, b.upgrading!.durationMonths - elapsed);
            addLine(
              `▶ ${bDef?.name ?? b.defId} Lv${b.level}→${b.upgrading!.targetLevel}  剩${remaining}月`,
              lineIdx++, '#aaddcc',
            );
          }
          if (upgradingBuildings.length > 0 && lineIdx < this.PANEL_MAX_LINES) {
            addLine('──────────────────', lineIdx++, '#333355');
          }
        }

        // ── 选中建筑详情 + 工位列表 + 操作按钮 ──
        if (this.selectedBuilding) {
          // 始终从当前 state 取最新数据，避免 selectedBuilding 存储旧快照
          const sel    = state.grid.placedBuildings[this.selectedBuilding.id] ?? this.selectedBuilding;
          const selDef = db.buildings.buildings.find(b => b.id === sel.defId);
          if (selDef) {
            // 升级中：显示进度
            if (sel.upgrading) {
              const elapsed  = state.monthIndex - sel.upgrading.startMonth;
              const total    = sel.upgrading.durationMonths;
              const pct      = Math.min(Math.floor(elapsed / total * 10), 10);
              const bar      = '█'.repeat(pct) + '░'.repeat(10 - pct);
              const remaining = Math.max(0, total - elapsed);
              addLine(`▶ ${selDef.name} [升级中…]`, lineIdx++, '#c9a959');
              addLine(`  Lv.${sel.level} → Lv.${sel.upgrading.targetLevel}`, lineIdx++, '#aaddcc');
              addLine(`  进度: ${bar} 剩${remaining}月`, lineIdx++, '#88aacc');
              addLine('  ⚠ 升级期间产出减少', lineIdx++, '#cc8866');
            } else {
              addLine(`▶ ${selDef.name} Lv.${sel.level} (${sel.x},${sel.y})`, lineIdx++, '#c9a959');

              // 升级按钮区域
              if (sel.level < selDef.maxLevel) {
                if (selDef.upgrades) {
                  // 新异步升级系统
                  const upgradeDef = selDef.upgrades.find(u => u.toLevel === sel.level + 1);
                  if (upgradeDef) {
                    const costParts: string[] = [];
                    for (const [k, v] of Object.entries(upgradeDef.cost.currency ?? {})) {
                      costParts.push(`${v}${k === 'silver' ? '银' : k}`);
                    }
                    for (const [k, v] of Object.entries(upgradeDef.cost.inventories ?? {})) {
                      costParts.push(`${v}${k}`);
                    }
                    const costStr  = costParts.join('+');
                    const durationStr = `${upgradeDef.duration}月`;

                    const check = checkUpgradeRequirements(sel.id, state, db);
                    if (check.canUpgrade) {
                      addButton(
                        `[升级→Lv${sel.level + 1} ${costStr} ${durationStr}]`,
                        lineIdx, -40, '#88cc88',
                        () => {
                          this.gameManager.queueUpgrade(sel.id);
                          this.selectedBuilding  = null;
                          this.buildingSlotAssign = null;
                          this.refreshTabContent('build');
                        },
                      );
                    } else {
                      addText(`[升级→Lv${sel.level + 1}] ${costStr} ${durationStr}`, lineIdx, -40, '#555555');
                      const blockerDesc = check.blockers.map(b => {
                        if (b.type === 'resource') return `${b.key}不足`;
                        if (b.type === 'reputation') return `声望<${b.required}`;
                        if (b.type === 'disciple_realm') return `需${b.required}境弟子`;
                        return b.type;
                      }).join(' ');
                      if (lineIdx < this.PANEL_MAX_LINES - 1) {
                        addLine(`  ✗ ${blockerDesc}`, lineIdx, '#cc6644');
                      }
                    }
                    lineIdx++;
                  }
                } else {
                  // 旧即时升级系统
                  const levelDef = selDef.levels.find(l => l.level === sel.level);
                  const upgradeSilver = levelDef?.upgradeCost?.['silver'];
                  if (upgradeSilver != null) {
                    addButton(`[升级 -${upgradeSilver}银]`, lineIdx, -70, '#88cc88', () => {
                      this.gameManager.queueUpgrade(sel.id);
                      this.selectedBuilding  = null;
                      this.buildingSlotAssign = null;
                      this.refreshTabContent('build');
                    });
                  }
                }
              }

              addButton('[拆除]', lineIdx++, 70, '#cc6666', () => {
                this.gameManager.queueDemolish(sel.id);
                this.selectedBuilding  = null;
                this.buildingSlotAssign = null;
                this.refreshTabContent('build');
              });

              // 工位占用状态
              const levelDef = selDef.levels.find(l => l.level === sel.level);
              const slots = levelDef?.workSlots ?? 0;
              if (slots > 0) {
                const occupiedCount = state.disciples.filter(
                  d => d.job?.buildingInstanceId === sel.id,
                ).length;
                addLine(`工位 (${occupiedCount}/${slots}):`, lineIdx++, '#aaaaaa');
                for (let s = 0; s < slots && lineIdx < this.PANEL_MAX_LINES - 1; s++) {
                  const occ = state.disciples.find(
                    d => d.job?.buildingInstanceId === sel.id && d.job?.slotIndex === s,
                  );
                  if (occ) {
                    addText(`  槽${s}: ${occ.name}`, lineIdx++, 0, '#888888');
                  } else {
                    addText(`  槽${s}: 空闲`, lineIdx, -30, '#88cc88');
                    const capBldId = sel.id;
                    const capSlot  = s;
                    addButton('[→分配]', lineIdx, 120, '#88cc88', () => {
                      this.buildingSlotAssign = { buildingId: capBldId, slotIndex: capSlot };
                      this.refreshTabContent('build');
                    });
                    lineIdx++;
                  }
                }
              }
            }

            addLine('──────────────────', lineIdx++, '#333355');
          }
        }

        // 可建造建筑列表（每项带 [建造] 按钮）
        const placedCounts = new Map<string, number>();
        for (const b of Object.values(state.grid.placedBuildings)) {
          placedCounts.set(b.defId, (placedCounts.get(b.defId) ?? 0) + 1);
        }

        for (const def of db.buildings.buildings) {
          if (lineIdx >= this.PANEL_MAX_LINES) break;
          // S1-3: 隐藏需要主线解锁但尚未解锁的建筑
          if (def.lockedByDefault && !state.unlocks.buildings.includes(def.id)) continue;
          const count   = placedCounts.get(def.id) ?? 0;
          const silver  = def.buildCost['silver'] ?? 0;
          const canAfford = state.resources.silver >= silver;
          const costStr = silver ? `${silver}银` : '免费';
          const countSuffix = count > 0 ? ` ×${count}` : '';

          addText(
            `${def.name}${countSuffix}  ${costStr}`,
            lineIdx, -45,
            canAfford ? '#cccccc' : '#886655',
          );

          const capDefId = def.id;
          addButton(
            '[建造]', lineIdx, 140,
            canAfford ? '#88cc88' : '#555555',
            () => {
              this.gameManager.enterBuildMode(capDefId);
              // 关闭底部面板，让地图完整可见（切换到 overview 不遮挡）
              // 不切 tab — 用户留在 build tab 看取消按钮即可
            },
          );
          lineIdx++;
        }
        break;
      }

      case 'disciples': {
        let discLineIdx = 0;

        // ── v1: 突破详情面板 ──
        if (this.breakthroughDiscipleId !== null) {
          const disc = state.disciples.find(d => d.id === this.breakthroughDiscipleId);
          if (!disc) { this.breakthroughDiscipleId = null; break; }
          const info = this.gameManager.getBreakthroughInfo(disc.id);
          const realmNames: Record<string, string> = {};
          if (db?.realms) {
            for (const r of db.realms.realms) realmNames[r.id] = r.name;
          }
          const currentRealm = realmNames[disc.realm] ?? disc.realm;

          addLine(`${disc.name} 突破修为`, discLineIdx++, '#c9a959');
          addButton('[← 返回]', discLineIdx++, 0, '#cc8866', () => {
            this.breakthroughDiscipleId = null;
            this.refreshTabContent('disciples');
          });

          if (!info) {
            addLine(`当前境界：${currentRealm}（已是最高境界）`, discLineIdx++, '#888888');
            break;
          }

          const targetName = realmNames[info.targetRealm.id] ?? info.targetRealm.id;
          addLine(`${currentRealm}(${disc.realmProgress}%) → ${targetName}`, discLineIdx++, '#aaddcc');

          // 成功率
          const c = info.chance;
          addLine(
            `成功率 ${c.total}%  (天赋${c.talentBonus >= 0 ? '+' : ''}${c.talentBonus} 悟+${c.comprehensionBonus} 志+${c.willpowerBonus} 失败-${c.attemptPenalty})`,
            discLineIdx++, '#88aacc',
          );

          // 前置条件
          if (info.check.canAttempt) {
            addLine('✓ 条件已满足，可突破', discLineIdx++, '#88cc88');
          } else {
            for (const b of info.check.blockers) {
              if (discLineIdx >= this.PANEL_MAX_LINES) break;
              const key = b.key === 'physique' ? '体魄' : b.key === 'comprehension' ? '悟性' : b.key === 'willpower' ? '定力' : b.key === 'realmProgress' ? '境界进度' : b.key;
              addLine(`✗ ${key}: ${b.current}/${b.required}`, discLineIdx++, '#cc8866');
            }
          }

          if (discLineIdx < this.PANEL_MAX_LINES - 1) {
            const capDiscId = disc.id;
            if (info.check.canAttempt) {
              addLine('突破将于月末结算（可能：大成功/成功/失败/走火入魔）', discLineIdx++, '#888888');
              if (discLineIdx < this.PANEL_MAX_LINES) {
                addButton('[确认突破]', discLineIdx, 0, '#c9a959', () => {
                  this.gameManager.queueAttemptBreakthrough(capDiscId);
                  this.breakthroughDiscipleId = null;
                  this.refreshTabContent('disciples');
                });
              }
            }
          }
          break;
        }

        // ── v1.5: 师徒关系面板 ──
        if (this.mastershipDiscipleId !== null) {
          const disc = state.disciples.find(d => d.id === this.mastershipDiscipleId);
          if (!disc) { this.mastershipDiscipleId = null; break; }

          addLine(`${disc.name} 的师徒关系`, discLineIdx++, '#c9a959');
          addButton('[← 返回]', discLineIdx++, 0, '#cc8866', () => {
            this.mastershipDiscipleId = null;
            this.refreshTabContent('disciples');
          });

          // 显示当前师父
          if (disc.masterId) {
            const master = state.disciples.find(d => d.id === disc.masterId);
            const masterName = master?.name ?? '未知';
            const masterBonus = master ? this.gameManager.getMasterBonus(master.id, disc.id) : 0;
            addText(`师父: ${masterName}  突破+${masterBonus}%`, discLineIdx, 0, '#c9a959');
            discLineIdx++;
            const capMasterId = disc.masterId;
            const capDiscId = disc.id;
            addButton('[解除师徒]', discLineIdx++, 0, '#cc8866', () => {
              this.gameManager.queueDissolveMastership(capMasterId, capDiscId);
              this.mastershipDiscipleId = null;
              this.refreshTabContent('disciples');
            });
          } else {
            addText('无师父', discLineIdx++, 0, '#666666');
            // 列出可拜师的弟子
            addLine('── 可拜师 ──', discLineIdx++, '#888888');
            const capDiscId = disc.id;
            for (const candidate of state.disciples) {
              if (discLineIdx >= this.PANEL_MAX_LINES) break;
              if (candidate.id === disc.id) continue;
              const check = this.gameManager.getMastershipCheck(candidate.id, disc.id);
              if (!check) continue;
              const capCandId = candidate.id;
              if (check.canEstablish) {
                addText(`${candidate.name} [${candidate.realm}]`, discLineIdx, -30, '#aaaaaa');
                addButton('[拜师]', discLineIdx, 140, '#88cc88', () => {
                  this.gameManager.queueEstablishMastership(capCandId, capDiscId);
                  this.mastershipDiscipleId = null;
                  this.refreshTabContent('disciples');
                });
              } else {
                addText(`${candidate.name} ✗`, discLineIdx, -30, '#555555');
                addText(check.blockers[0]?.detail.substring(0, 18) ?? '', discLineIdx, 70, '#444444');
              }
              discLineIdx++;
            }
          }

          // 显示徒弟列表
          if (disc.apprenticeIds && disc.apprenticeIds.length > 0) {
            addLine('── 徒弟 ──', discLineIdx < this.PANEL_MAX_LINES ? discLineIdx++ : discLineIdx, '#888888');
            for (const apId of disc.apprenticeIds) {
              if (discLineIdx >= this.PANEL_MAX_LINES) break;
              const ap = state.disciples.find(d => d.id === apId);
              if (ap) addText(`${ap.name} [${ap.realm}]`, discLineIdx++, 0, '#aaaaaa');
            }
          }
          break;
        }

        // ── C2: 武学配置模式 ──
        if (this.martialDiscipleId !== null) {
          if (!db) { addLine('数据加载中…', 0); break; }
          const disc = state.disciples.find(d => d.id === this.martialDiscipleId);
          if (!disc) { this.martialDiscipleId = null; break; }

          const maContent = db.martialArts;
          const equipped  = disc.loadout?.equippedArts ?? [];

          addLine(
            `${disc.name} 武学配置 (${equipped.length}/${maContent.maxEquipSlots}槽)`,
            discLineIdx++, '#c9a959',
          );
          addButton('[← 返回]', discLineIdx++, 0, '#cc8866', () => {
            this.martialDiscipleId = null;
            this.refreshTabContent('disciples');
          });

          // 已装备
          if (equipped.length === 0) {
            addLine('  未装备任何武学', discLineIdx++, '#555555');
          } else {
            for (const artId of equipped) {
              if (discLineIdx >= this.PANEL_MAX_LINES) break;
              const artDef = maContent.martialArts.find(a => a.id === artId);
              const bonusStr = artDef?.trainingBonus.map(b => `${b.track.slice(0, 2)}+${b.delta}`).join(' ') ?? '';
              addText(
                `${artDef?.name ?? artId} [${artDef?.category ?? '?'}] ${bonusStr}`,
                discLineIdx, -55, '#aaddaa',
              );
              const capArtId = artId;
              const capDiscId = disc.id;
              addButton('[卸下]', discLineIdx, 150, '#cc8866', () => {
                this.gameManager.queueUnequipMartialArt(capDiscId, capArtId);
                this.martialDiscipleId = null;
                this.refreshTabContent('disciples');
              });
              discLineIdx++;
            }
          }

          // 可装备（已解锁、未装备、无冲突、槽位足够）
          if (discLineIdx < this.PANEL_MAX_LINES) {
            addLine('── 可装备 ──', discLineIdx++, '#444466');
          }
          const maUnlocked   = state.martialArts.unlocked;
          const equippedSet  = new Set(equipped);
          const equippableDefs = maContent.martialArts.filter(a => {
            if (!maUnlocked.includes(a.id)) return false;
            if (equippedSet.has(a.id)) return false;
            if (equipped.length >= maContent.maxEquipSlots) return false;
            return !equipped.some(eId => {
              const eDef = maContent.martialArts.find(x => x.id === eId);
              return eDef?.conflictGroup === a.conflictGroup;
            });
          });

          if (equippableDefs.length === 0) {
            addLine('  无可装备武学（槽满或已全学）', discLineIdx, '#555555');
          } else {
            for (const artDef of equippableDefs) {
              if (discLineIdx >= this.PANEL_MAX_LINES) break;
              addText(`${artDef.name} [${artDef.category}]`, discLineIdx, -55, '#888888');
              const capArtId  = artDef.id;
              const capDiscId = disc.id;
              addButton('[装备]', discLineIdx, 150, '#88cc88', () => {
                this.gameManager.queueEquipMartialArt(capDiscId, capArtId);
                this.martialDiscipleId = null;
                this.refreshTabContent('disciples');
              });
              discLineIdx++;
            }
          }
          // ── v1.5: 武学学习进度 ──
          if (discLineIdx < this.PANEL_MAX_LINES) {
            addLine('── 学习中 ──', discLineIdx++, '#444466');
          }
          if (disc.martialLearning) {
            const ml = disc.martialLearning;
            const artDef = maContent.martialArts.find(a => a.id === ml.martialId);
            const src = ml.source === 'master_teach' ? '师授' : '自学';
            if (discLineIdx < this.PANEL_MAX_LINES) {
              addText(
                `${artDef?.name ?? ml.martialId} ${ml.progressMonths}/${ml.targetMonths}月 [${src}]`,
                discLineIdx, -20, '#c9a959',
              );
              const capDiscId = disc.id;
              addButton('[取消]', discLineIdx, 155, '#cc8866', () => {
                this.gameManager.queueCancelMartialLearning(capDiscId);
                this.martialDiscipleId = null;
                this.refreshTabContent('disciples');
              });
              discLineIdx++;
            }
          } else {
            // 可学习的武学（已解锁、不在 knownArts 中）
            const knownArts = disc.knownArts ?? [];
            const learnableDefs = maContent.martialArts.filter(a =>
              maUnlocked.includes(a.id) && !knownArts.includes(a.id),
            );
            if (learnableDefs.length === 0) {
              if (discLineIdx < this.PANEL_MAX_LINES) {
                addLine('  无可学武学', discLineIdx++, '#555555');
              }
            } else {
              for (const artDef of learnableDefs) {
                if (discLineIdx >= this.PANEL_MAX_LINES) break;
                const duration = this.gameManager.getLearnDuration(artDef.id, 'self');
                const hasMaster = !!disc.masterId;
                const masterKnows = hasMaster && (() => {
                  const master = state.disciples.find(d => d.id === disc.masterId);
                  return master?.knownArts?.includes(artDef.id) ?? false;
                })();
                addText(
                  `${artDef.name} ${duration ?? '?'}月`,
                  discLineIdx, -60, '#888888',
                );
                const capDiscId = disc.id;
                const capArtId  = artDef.id;
                addButton('[自学]', discLineIdx, 100, '#88cc88', () => {
                  this.gameManager.queueStartMartialLearning(capDiscId, capArtId, 'self');
                  this.martialDiscipleId = null;
                  this.refreshTabContent('disciples');
                });
                if (masterKnows) {
                  const mDur = this.gameManager.getLearnDuration(artDef.id, 'master_teach');
                  addButton(`[师授${mDur}月]`, discLineIdx, 160, '#c9a959', () => {
                    this.gameManager.queueStartMartialLearning(capDiscId, capArtId, 'master_teach');
                    this.martialDiscipleId = null;
                    this.refreshTabContent('disciples');
                  });
                }
                discLineIdx++;
              }
            }
          }

          // ── v1.5: 师徒关系快捷入口 ──
          if (discLineIdx < this.PANEL_MAX_LINES) {
            const capMSDId = disc.id;
            const masterLabel = disc.masterId
              ? `师父: ${state.disciples.find(d => d.id === disc.masterId)?.name ?? '?'}`
              : '(无师父)';
            addText(masterLabel, discLineIdx, -50, disc.masterId ? '#c9a959' : '#555555');
            addButton('[师徒]', discLineIdx++, 140, '#ddaa55', () => {
              this.mastershipDiscipleId = capMSDId;
              this.martialDiscipleId = null;
              this.refreshTabContent('disciples');
            });
          }

          addLine('(改动月末生效)', discLineIdx < this.PANEL_MAX_LINES ? discLineIdx : this.PANEL_MAX_LINES - 1, '#444444');
          break;
        }

        // ── 工位分配模式 ──
        if (this.selectedDiscipleId !== null) {
          if (!db) { addLine('数据加载中…', 0); break; }
          const disc = state.disciples.find(d => d.id === this.selectedDiscipleId);
          if (!disc) { this.selectedDiscipleId = null; break; }

          addLine(`分配 ${disc.name} 到工位`, discLineIdx++, '#c9a959');
          addButton('[← 返回]', discLineIdx++, 0, '#cc8866', () => {
            this.selectedDiscipleId = null;
            this.refreshTabContent('disciples');
          });

          const buildings = Object.values(state.grid.placedBuildings);
          if (buildings.length === 0) { addLine('暂无建筑', discLineIdx, '#666666'); break; }

          for (const bld of buildings) {
            if (discLineIdx >= this.PANEL_MAX_LINES) break;
            const bDef = db.buildings.buildings.find(b => b.id === bld.defId);
            const levelDef = bDef?.levels.find(l => l.level === bld.level);
            const slots = levelDef?.workSlots ?? 0;
            if (slots === 0) continue;

            addText(`${bDef?.name ?? bld.defId} (${slots}槽)`, discLineIdx++, -20, '#aaaaaa');
            for (let s = 0; s < slots && discLineIdx < this.PANEL_MAX_LINES; s++) {
              const occ = state.disciples.find(
                d => d.job?.buildingInstanceId === bld.id && d.job?.slotIndex === s,
              );
              if (occ && occ.id !== disc.id) {
                addText(`  槽${s}: ${occ.name}`, discLineIdx++, 0, '#555555');
              } else {
                const isSelf = occ?.id === disc.id;
                addText(
                  `  槽${s}: ${isSelf ? '(自己)' : '空闲'}`,
                  discLineIdx, -40,
                  isSelf ? '#888888' : '#88cc88',
                );
                if (!isSelf) {
                  const capBldId = bld.id;
                  const capSlot  = s;
                  addButton('[→分配]', discLineIdx, 120, '#88cc88', () => {
                    this.gameManager.queueAssignJob(disc.id, capBldId, capSlot);
                    this.selectedDiscipleId = null;
                    this.refreshTabContent('disciples');
                  });
                }
                discLineIdx++;
              }
            }
          }
          break;
        }

        // ── 大会选派模式：为弟子选择参赛阶段 ──
        if (this.tournamentSelectDiscipleId !== null) {
          const disc = state.disciples.find(d => d.id === this.tournamentSelectDiscipleId);
          if (!disc) { this.tournamentSelectDiscipleId = null; break; }
          const t = state.tournament!;
          const reps = t.selectedRepresentatives;
          addLine(`选派 ${disc.name} 参加:`, discLineIdx++, '#c9a959');
          addButton('[← 返回]', discLineIdx++, 0, '#cc8866', () => {
            this.tournamentSelectDiscipleId = null;
            this.refreshTabContent('disciples');
          });

          const phases: Array<{ id: 'martial' | 'debate' | 'politics'; label: string; hint: string }> = [
            { id: 'martial',  label: '武道比试', hint: `体魄 ${disc.stats['physique'] ?? 0}` },
            { id: 'debate',   label: '论道辩难', hint: `悟性 ${disc.stats['comprehension'] ?? 0}` },
            { id: 'politics', label: '纵横结盟', hint: '声望+势力' },
          ];

          for (const p of phases) {
            if (discLineIdx >= this.PANEL_MAX_LINES) break;
            const existing = reps.find(s => s.phaseId === p.id);
            const isSelected = existing?.discipleId === disc.id;
            const label = isSelected ? `✓ ${p.label}` : `[ ${p.label} ]`;
            const alreadyOcc = existing && !isSelected ? `(已:${state.disciples.find(d => d.id === existing.discipleId)?.name ?? '?'})` : '';
            addText(`${p.hint}  ${alreadyOcc}`, discLineIdx, -40, '#888888');
            const capPhaseId = p.id;
            const capDiscId  = disc.id;
            addButton(label, discLineIdx, 130, isSelected ? '#c9a959' : '#88cc88', () => {
              this.gameManager.selectTournamentRepresentative(capPhaseId, capDiscId);
              this.tournamentSelectDiscipleId = null;
              this.refreshTabContent('disciples');
            });
            discLineIdx++;
          }
          addLine('(选派立即生效)', discLineIdx < this.PANEL_MAX_LINES ? discLineIdx : this.PANEL_MAX_LINES - 1, '#444444');
          break;
        }

        // ── 常规弟子列表 ──
        const pendingRecruits = this.gameManager.getPendingRecruits();
        const realmLookup: Record<string, string> = {};
        if (db?.realms) {
          for (const r of db.realms.realms) realmLookup[r.id] = r.name;
        }

        for (const d of state.disciples) {
          if (discLineIdx >= this.PANEL_MAX_LINES - 1) break;
          const phy = d.stats['physique']      ?? 0;
          const com = d.stats['comprehension'] ?? 0;
          const onMission = state.missionsActive.some(m => m.partyDiscipleIds.includes(d.id));
          const jobLabel   = onMission ? '出行' : d.job ? '在职' : '无职';
          const realmName  = realmLookup[d.realm] ?? d.realm;
          // 天赋色：S=金, A=绿, B=蓝, C=灰, D=暗红
          const talentColor: Record<string, string> = { S: '#ffd700', A: '#88cc88', B: '#88aacc', C: '#cccccc', D: '#bb6666' };
          // v1.5：学习状态标记
          const learnMark = d.martialLearning ? '学' : '';
          // v1.5：师徒标记
          const masterMark = d.masterId ? '师' : (d.apprenticeIds?.length ? `徒${d.apprenticeIds.length}` : '');
          addText(`[${d.talentGrade}]`, discLineIdx, -155, talentColor[d.talentGrade] ?? '#cccccc');
          addText(
            `${d.name} ${phy}/${com} [${jobLabel}] ${realmName}${masterMark ? ' '+masterMark : ''}${learnMark ? ' '+learnMark : ''}`,
            discLineIdx, -50, '#cccccc',
          );
          if (!onMission) {
            const capId = d.id;
            addButton('[分配]', discLineIdx, 95, '#88aacc', () => {
              this.martialDiscipleId = null;
              this.breakthroughDiscipleId = null;
              this.mastershipDiscipleId = null;
              this.selectedDiscipleId = capId;
              this.refreshTabContent('disciples');
            });
          }
          const capMDId = d.id;
          addButton('[武学]', discLineIdx, 148, '#aaddcc', () => {
            this.selectedDiscipleId = null;
            this.breakthroughDiscipleId = null;
            this.mastershipDiscipleId = null;
            this.martialDiscipleId = capMDId;
            this.refreshTabContent('disciples');
          });
          // 大会选派按钮（仅在大会 gathering/martial/debate/politics 阶段显示）
          const tmt = state.tournament;
          if (tmt?.active && ['gathering', 'martial', 'debate', 'politics'].includes(tmt.phase)) {
            const capTDId = d.id;
            const alreadyPicked = tmt.selectedRepresentatives.some(s => s.discipleId === capTDId);
            addButton('[选派]', discLineIdx, 205, alreadyPicked ? '#c9a959' : '#ddaa55', () => {
              this.selectedDiscipleId = null;
              this.martialDiscipleId = null;
              this.breakthroughDiscipleId = null;
              this.mastershipDiscipleId = null;
              this.tournamentSelectDiscipleId = capTDId;
              this.refreshTabContent('disciples');
            });
          } else {
            // 突破按钮（非大会期间）
            const capBDId = d.id;
            addButton('[突破]', discLineIdx, 205, '#ddbbaa', () => {
              this.selectedDiscipleId = null;
              this.martialDiscipleId = null;
              this.mastershipDiscipleId = null;
              this.breakthroughDiscipleId = capBDId;
              this.refreshTabContent('disciples');
            });
          }
          discLineIdx++;
        }

        if (state.recruitPool.length > 0) {
          if (discLineIdx < this.PANEL_MAX_LINES) {
            addLine('── 候选人 ──', discLineIdx++, '#c9a959');
          }
          for (const c of state.recruitPool) {
            if (discLineIdx >= this.PANEL_MAX_LINES) break;
            const already = pendingRecruits.includes(c.id);
            const cPhy = c.stats['physique']      ?? 0;
            const cCom = c.stats['comprehension'] ?? 0;
            addText(`${c.name} 体${cPhy}悟${cCom}`, discLineIdx, -40, '#aaaaaa');
            const capCId = c.id;
            addButton(
              already ? '[已排]' : '[招募]', discLineIdx, 130,
              already ? '#c9a959' : '#88cc88',
              () => {
                if (!already) {
                  this.gameManager.queueRecruit(capCId);
                  this.refreshTabContent('disciples');
                }
              },
            );
            discLineIdx++;
          }
        }

        if (state.disciples.length === 0 && state.recruitPool.length === 0) {
          addLine('门下尚无弟子', 0, '#666666');
        }
        break;
      }

      case 'missions': {
        if (!db) { addLine('数据加载中…', 0); break; }
        let mLineIdx = 0;
        const pendingDispatches = this.gameManager.getPendingDispatches();

        // ── B2a: 可用弟子数（用于主列表战力着色）──
        const availForMission = state.disciples.filter(d =>
          !state.missionsActive.some(m => m.partyDiscipleIds.includes(d.id)) &&
          !d.statuses.some(s => s.statusId === 'injured'),
        );

        // 属性标签（用于事件卡 statCheck 显示）
        const STAT_ZH: Record<string, string> = {
          physique: '体力', comprehension: '悟性',
          willpower: '心志', agility: '身法', charisma: '威望',
        };

        // ── 组队/派遣模式 ──
        if (this.selectedMissionTemplateId !== null) {
          const tmpl = db.missions.templates.find(t => t.id === this.selectedMissionTemplateId);
          if (!tmpl) { this.selectedMissionTemplateId = null; break; }

          addLine(`▶ ${tmpl.name} (${tmpl.durationMonths}月)`, mLineIdx++, '#c9a959');
          addText(`≥${tmpl.minPartySize}人  推荐战力${tmpl.recommendedPower}`, mLineIdx, -30, '#888888');
          addButton('[取消]', mLineIdx++, 130, '#cc6666', () => {
            this.selectedMissionTemplateId = null;
            this.missionPartyIds = [];
            this.refreshTabContent('missions');
          });

          // 主要考验属性（统计事件卡 statCheck 出现频率）
          const statCounts: Record<string, number> = {};
          for (const cardId of tmpl.eventCardIds) {
            const card = db.missions.eventCards.find(c => c.id === cardId);
            if (card?.statCheck) {
              statCounts[card.statCheck] = (statCounts[card.statCheck] ?? 0) + 1;
            }
          }
          const topStats = Object.entries(statCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 2)
            .map(([s]) => STAT_ZH[s] ?? s);
          if (topStats.length > 0 && mLineIdx < this.PANEL_MAX_LINES) {
            addLine(`考验: ${topStats.join('/')}`, mLineIdx++, '#888888');
          }

          const partyCount = this.missionPartyIds.length;
          const ready = partyCount >= tmpl.minPartySize;
          addLine(
            `队伍 ${partyCount}/${tmpl.minPartySize}人${ready ? ' ✓' : ''}`,
            mLineIdx++,
            ready ? '#88cc88' : '#888888',
          );

          for (const d of state.disciples) {
            if (mLineIdx >= this.PANEL_MAX_LINES - 1) break;
            const inParty   = this.missionPartyIds.includes(d.id);
            const onMission = state.missionsActive.some(m => m.partyDiscipleIds.includes(d.id));
            const color = onMission ? '#444444' : inParty ? '#c9a959' : '#aaaaaa';
            addText(`${d.name}`, mLineIdx, -80, color);
            if (!onMission) {
              const capDId = d.id;
              addButton(
                inParty ? '[-]' : '[+]', mLineIdx, 80,
                inParty ? '#cc6666' : '#88cc88',
                () => {
                  if (inParty) {
                    this.missionPartyIds = this.missionPartyIds.filter(id => id !== capDId);
                  } else {
                    this.missionPartyIds.push(capDId);
                  }
                  this.refreshTabContent('missions');
                },
              );
            }
            mLineIdx++;
          }

          if (ready && mLineIdx < this.PANEL_MAX_LINES) {
            const supplies = tmpl.supplyCost ?? {};
            addButton('[确认派遣]', mLineIdx, 0, '#c9a959', () => {
              this.gameManager.queueDispatchMission(
                tmpl.id, [...this.missionPartyIds], { ...supplies },
              );
              this.selectedMissionTemplateId = null;
              this.missionPartyIds = [];
              this.refreshTabContent('missions');
            });
          }
          break;
        }

        // ── 默认视图：进行中 + 可派遣 ──
        if (state.missionsActive.length > 0) {
          addLine('▶ 进行中', mLineIdx++, '#c9a959');
          for (const m of state.missionsActive.slice(0, 3)) {
            if (mLineIdx >= this.PANEL_MAX_LINES) break;
            const mTmpl = db.missions.templates.find(t => t.id === m.templateId);
            addLine(`  ${mTmpl?.name ?? m.templateId}  剩${m.remainingMonths}月`, mLineIdx++, '#aaaaaa');
          }
          if (mLineIdx < this.PANEL_MAX_LINES) {
            addLine('──────────────────', mLineIdx++, '#333355');
          }
        }

        if (mLineIdx < this.PANEL_MAX_LINES) {
          addLine('▷ 可派遣', mLineIdx++, '#c9a959');
        }

        // 势力标签映射
        const FACTION_LABELS: Record<string, string> = {
          'faction.righteous':  '[正]',
          'faction.demon':      '[魔]',
          'faction.government': '[官]',
          'faction.merchant':   '[商]',
          'faction.beggar':     '[丐]',
        };

        // 从任务池获取本月可派遣任务（基于势力关系加权刷新）
        const poolIds = this.gameManager.getMissionsPool();
        for (const tid of poolIds) {
          if (mLineIdx >= this.PANEL_MAX_LINES) break;
          const t = db.missions.templates.find(tmpl => tmpl.id === tid);
          if (!t) continue;
          const dispatched = pendingDispatches.some(d => d.templateId === t.id);
          const enoughPeople = availForMission.length >= t.minPartySize;
          const listColor = dispatched ? '#666666'
            : enoughPeople ? '#cccccc' : '#cc8866';
          const factionLabel = t.factionId ? (FACTION_LABELS[t.factionId] ?? '') : '';
          addText(
            `${factionLabel}${t.name} ${t.durationMonths}月 ≥${t.minPartySize}人`,
            mLineIdx, -40, listColor,
          );
          if (!dispatched) {
            const capTId = t.id;
            addButton('[选择]', mLineIdx, 140, '#88aacc', () => {
              this.selectedMissionTemplateId = capTId;
              this.missionPartyIds = [];
              this.refreshTabContent('missions');
            });
          }
          mLineIdx++;
        }
        break;
      }

      case 'martial': {
        if (!db) { addLine('数据加载中…', 0); break; }
        const maContent = db.martialArts;
        const maState   = state.martialArts;
        let maLine      = 0;

        // ── 研究选人模式 ──
        if (this.martialResearchArtId !== null) {
          const artDef = maContent.martialArts.find(a => a.id === this.martialResearchArtId);
          if (!artDef) { this.martialResearchArtId = null; break; }

          addLine(`研究: ${artDef.name} (需${artDef.researchCost}pts)`, maLine++, '#c9a959');
          addButton('[← 取消]', maLine++, 0, '#cc8866', () => {
            this.martialResearchArtId = null;
            this.martialResearchPartyIds = [];
            this.refreshTabContent('martial');
          });

          addLine(
            `已选 ${this.martialResearchPartyIds.length} 人 — 悟性越高贡献越多`,
            maLine++,
            this.martialResearchPartyIds.length > 0 ? '#88cc88' : '#888888',
          );

          for (const d of state.disciples) {
            if (maLine >= this.PANEL_MAX_LINES - 1) break;
            const inParty = this.martialResearchPartyIds.includes(d.id);
            const com     = d.stats['comprehension'] ?? 0;
            const pts     = 5 + Math.floor(com / 10);
            addText(`${d.name} 悟${com} +${pts}pts`, maLine, -80, inParty ? '#c9a959' : '#aaaaaa');
            const capDId = d.id;
            addButton(inParty ? '[-]' : '[+]', maLine, 120,
              inParty ? '#cc6666' : '#88cc88',
              () => {
                if (inParty) {
                  this.martialResearchPartyIds = this.martialResearchPartyIds.filter(id => id !== capDId);
                } else {
                  this.martialResearchPartyIds.push(capDId);
                }
                this.refreshTabContent('martial');
              },
            );
            maLine++;
          }

          if (this.martialResearchPartyIds.length > 0 && maLine < this.PANEL_MAX_LINES) {
            const capArtId = this.martialResearchArtId;
            addButton('[确认研究]', maLine, 0, '#c9a959', () => {
              this.gameManager.queueSetResearch(capArtId, [...this.martialResearchPartyIds]);
              this.martialResearchArtId = null;
              this.martialResearchPartyIds = [];
              this.refreshTabContent('martial');
            });
          }
          break;
        }

        // ── 默认视图：三节 ──
        const unlocked       = maState.unlocked;
        const unlockedDefs   = maContent.martialArts.filter(a => unlocked.includes(a.id));
        const researchingDefs = maContent.martialArts.filter(
          a => !unlocked.includes(a.id) && (maState.research[a.id] ?? 0) > 0,
        );
        const availDefs = maContent.martialArts.filter(
          a => !unlocked.includes(a.id) &&
               a.prerequisites.every(pid => unlocked.includes(pid)) &&
               (!a.lockedByDefault || state.unlocks.martials.includes(a.id)),
        );
        const pendingResearch = this.gameManager.getPendingResearch();

        // 已解锁
        if (unlockedDefs.length > 0) {
          addLine(`◆ 已解锁 (${unlockedDefs.length})`, maLine++, '#c9a959');
          for (const a of unlockedDefs) {
            if (maLine >= this.PANEL_MAX_LINES) break;
            const bonusStr = a.trainingBonus.map(b => `${b.track.slice(0, 2)}+${b.delta}`).join(' ');
            addLine(`${a.name}  [${a.category}]  ${bonusStr}`, maLine++, '#aaddaa');
          }
          if (maLine < this.PANEL_MAX_LINES) addLine('──────────────────', maLine++, '#333355');
        }

        // 研究中
        if (researchingDefs.length > 0 && maLine < this.PANEL_MAX_LINES) {
          addLine('◆ 研究中', maLine++, '#aaddff');
          for (const a of researchingDefs) {
            if (maLine >= this.PANEL_MAX_LINES) break;
            const prog = maState.research[a.id] ?? 0;
            const isPending = pendingResearch.some(op => op.martialArtId === a.id);
            const suffix = isPending ? ' ★' : '';
            addLine(
              `${a.name}  ${prog}/${a.researchCost}pts${suffix}`,
              maLine++, '#88aacc',
            );
          }
          if (maLine < this.PANEL_MAX_LINES) addLine('──────────────────', maLine++, '#333355');
        }

        // 可研究
        if (availDefs.length > 0 && maLine < this.PANEL_MAX_LINES) {
          addLine('◆ 可研究', maLine++, '#aaaaaa');
          for (const a of availDefs) {
            if (maLine >= this.PANEL_MAX_LINES) break;
            const isPending = pendingResearch.some(op => op.martialArtId === a.id);
            addText(
              `${a.name} [${a.category}] 需${a.researchCost}pts`,
              maLine, -45, isPending ? '#c9a959' : '#888888',
            );
            if (!isPending) {
              const capAId = a.id;
              addButton('[研究]', maLine, 148, '#88aacc', () => {
                this.martialResearchArtId = capAId;
                this.martialResearchPartyIds = [];
                this.refreshTabContent('martial');
              });
            } else {
              addText('(已排)', maLine, 148, '#c9a959');
            }
            maLine++;
          }
        }

        if (unlockedDefs.length === 0 && researchingDefs.length === 0 && availDefs.length === 0) {
          addLine('暂无可用武学', 0, '#666666');
        }
        break;
      }

      // ── 势力 tab ─────────────────────────────────────────────────────────────
      case 'faction': {
        const factionDefs = db?.factions?.factions ?? [];
        const BAR_W  = 110;
        const BAR_H  = 10;
        const barCX  = this.PANEL_X + 20; // bar center x (slightly right of panel center)

        // 势力 ID → 图标纹理映射
        const FACTION_ICON_MAP: Record<string, string> = {
          'faction.righteous':  'icon_faction_shaolin',   // 正道盟 → 少林图标
          'faction.demon':      'icon_faction_mingjiao',  // 魔教 → 明教图标
          'faction.government': 'icon_faction_wudang',    // 官府 → 武当图标
          'faction.merchant':   'icon_faction_emei',      // 商会 → 峨眉图标
          'faction.beggar':     'icon_faction_gaibang',   // 丐帮 → 丐帮图标
        };

        // ── 详情模式 ─────────────────────────────────────────────────────────
        if (this.selectedFactionId) {
          const fId  = this.selectedFactionId;
          const def  = factionDefs.find(f => f.id === fId);
          const rel  = state.factions[fId] ?? 0;

          addButton('[← 返回]', 0, 0, '#cc8866', () => {
            this.selectedFactionId = null;
            this.refreshTabContent('faction');
          });

          if (def) {
            // 门派图标（详情模式）
            const iconKey = FACTION_ICON_MAP[def.id] ?? 'icon_faction_player';
            if (this.textures.exists(iconKey)) {
              const iconY = startY + 1 * this.PANEL_LINE_H;
              const icon = this.add.image(this.PANEL_X - 90, iconY, iconKey)
                .setScale(0.6)
                .setOrigin(0.5);
              container.add(icon);
              items.push(icon);
            }
            addText(def.name, 1, -40, '#c9a959');
            const relStr  = `关系: ${rel >= 0 ? '+' : ''}${rel}`;
            const thdStr  = `友好≥${def.thresholds.friendly}  敌对≤${def.thresholds.hostile}`;
            addLine(relStr, 2, rel >= def.thresholds.friendly ? '#ffd700' : rel <= def.thresholds.hostile ? '#cc4444' : '#cccccc');
            addLine(thdStr, 3, '#888888');
            addLine(`偏好: ${def.preferences.labels.join('/')}`, 4, '#8888aa');

            // 近几回合关系变化（来自 reportHistory）
            const reports = this.gameManager.getReportHistory();
            const changes = reports
              .slice(-6)
              .reverse()
              .flatMap(r => r.factionChanges.filter(fc => fc.factionId === fId));
            if (changes.length > 0) {
              addLine('── 近期变化 ──', 5, '#444466');
              for (let ci = 0; ci < Math.min(changes.length, 4) && 6 + ci < this.PANEL_MAX_LINES; ci++) {
                const ch = changes[ci]!;
                addLine(`${ch.delta >= 0 ? '+' : ''}${ch.delta}`, 6 + ci, ch.delta >= 0 ? '#44cc44' : '#cc4444');
              }
            } else {
              addLine('暂无关系变化记录', 5, '#444444');
            }
          }
          break;
        }

        // ── 列表模式 ─────────────────────────────────────────────────────────
        addLine('── 势力关系 ──', 0, '#888888');

        if (factionDefs.length === 0) {
          addLine('（势力数据未加载）', 1, '#555555');
          break;
        }

        let fLine = 1;
        for (const def of factionDefs) {
          if (fLine >= this.PANEL_MAX_LINES) break;
          const rel     = state.factions[def.id] ?? 0;
          const relStr  = `${rel >= 0 ? '+' : ''}${rel}`;
          const atFriendly = rel >= def.thresholds.friendly;
          const atHostile  = rel <= def.thresholds.hostile;
          const nameColor  = atFriendly ? '#ffd700' : atHostile ? '#cc4444' : '#cccccc';

          // 门派图标（最左侧）
          const iconKey = FACTION_ICON_MAP[def.id] ?? 'icon_faction_player';
          if (this.textures.exists(iconKey)) {
            const iconY = startY + fLine * this.PANEL_LINE_H;
            const icon = this.add.image(this.PANEL_X - 168, iconY, iconKey)
              .setScale(0.4)
              .setOrigin(0.5);
            container.add(icon);
            items.push(icon);
          }

          // 名称（左对齐，稍微右移给图标留空间）
          addText(def.name, fLine, -120, nameColor);

          // 关系值（右）
          addText(relStr, fLine, 148, nameColor);

          // 关系条（背景）
          const barY = startY + fLine * this.PANEL_LINE_H;
          const barBg = this.add.rectangle(barCX, barY, BAR_W, BAR_H, 0x333344, 0.9);
          if (atFriendly)      barBg.setStrokeStyle(1.5, 0xffd700);
          else if (atHostile)  barBg.setStrokeStyle(1.5, 0xcc3333);
          container.add(barBg);
          items.push(barBg);

          // 关系条（填充）
          const relClamped = Math.max(-100, Math.min(100, rel));
          const fillW = Math.abs(relClamped / 100) * (BAR_W / 2);
          if (fillW > 1) {
            const fillColor = rel >= 0 ? 0x33bb33 : 0xbb3333;
            const fillX = rel >= 0 ? barCX + fillW / 2 : barCX - fillW / 2;
            const fill = this.add.rectangle(fillX, barY, fillW, BAR_H, fillColor);
            container.add(fill);
            items.push(fill);
          }

          // 零刻度线
          const zeroMark = this.add.rectangle(barCX, barY, 2, BAR_H + 2, 0x666677);
          container.add(zeroMark);
          items.push(zeroMark);

          // 点击区域 → 进入详情
          const capFId = def.id;
          const hitArea = this.add.rectangle(this.PANEL_X, barY, this.PANEL_W - 20, this.PANEL_LINE_H, 0xffffff, 0);
          hitArea.setInteractive();
          hitArea.on('pointerover', () => barBg.setFillStyle(0x444455, 0.9));
          hitArea.on('pointerout',  () => barBg.setFillStyle(0x333344, 0.9));
          hitArea.on('pointerdown', () => {
            this.selectedFactionId = capFId;
            this.refreshTabContent('faction');
          });
          container.add(hitArea);
          items.push(hitArea);

          fLine++;
        }

        if (fLine < this.PANEL_MAX_LINES) {
          addLine('点击势力查看详情', fLine, '#444455');
        }
        break;
      }
    }

    this.tabContentItems.set(tab, items);
  }

  // ── 武林大会面板 ────────────────────────────────────────────────────────────

  /** 创建空容器（内容由 updateTournamentPanel 动态填充）。 */
  private createTournamentPanel(): void {
    this.tournamentPanel = this.add.container(0, 0);
    // 面板背景（固定，不随内容重建）
    const bg = this.add.rectangle(TP_CX, TP_CY, TP_W, TP_H, 0x1a1a2e, 0.93)
      .setStrokeStyle(2, 0xc9a959);
    const headerBg = this.add.rectangle(TP_CX, TP_CY - TP_H / 2 + 14, TP_W, 24, 0xc9a959, 0.15);
    this.tournamentPanel.add([bg, headerBg]);
    this.tournamentPanel.setDepth(120);
    this.tournamentPanel.setVisible(false);
  }

  /**
   * 根据 tournament 状态刷新面板内容。
   * 每次 stateChanged → updateUI → 此方法被调用。
   */
  private updateTournamentPanel(): void {
    // 清理上一帧动态内容
    this.tournamentPanelItems.forEach(item => item.destroy());
    this.tournamentPanelItems = [];

    const state = this.gameManager.getState();
    const t = state.tournament;

    if (!t?.active) {
      this.tournamentPanel.setVisible(false);
      this.lastKnownPhase = null;
      return;
    }

    this.tournamentPanel.setVisible(true);

    const phaseIdx  = TOURNAMENT_PHASE_ORDER.indexOf(t.phase as typeof TOURNAMENT_PHASE_ORDER[number]);
    const phaseName = TOURNAMENT_PHASE_NAMES[t.phase] ?? t.phase;
    const phaseNum  = phaseIdx >= 0 ? phaseIdx + 1 : 1;
    const top       = TP_CY - TP_H / 2;

    const add = (obj: Phaser.GameObjects.GameObject) => {
      this.tournamentPanel.add(obj);
      this.tournamentPanelItems.push(obj);
    };

    // ── 标题行 ──
    add(this.add.text(TP_CX - 10, top + 14, `🏆 第${t.year}届武林大会`, {
      font: 'bold 14px Arial', color: '#c9a959',
    }).setOrigin(0.5));

    // 关闭按钮（右上角）
    const closeBtn = this.add.text(TP_CX + TP_W / 2 - 14, top + 14, '✕', {
      font: 'bold 14px Arial', color: '#666688',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#666688'));
    closeBtn.on('pointerdown', () => {
      this.tournamentPanel.setVisible(false);
    });
    add(closeBtn);

    // ── 阶段行 ──
    add(this.add.text(TP_CX, top + 35, `阶段：${phaseName}  ${phaseNum}/${TOURNAMENT_PHASE_ORDER.length}`, {
      font: '12px Arial', color: '#dddddd',
    }).setOrigin(0.5));

    // ── 分割线 ──
    const divider = this.add.rectangle(TP_CX, top + 47, TP_W - 20, 1, 0x4a4a6a);
    add(divider);

    // ── 影响力条 ──
    const barX  = TP_CX - 40;
    const barY  = top + 62;
    const barW  = 160;
    const barH  = 10;
    add(this.add.text(TP_CX - TP_W / 2 + 14, barY, '门派影响力', {
      font: '11px Arial', color: '#aaaaaa',
    }).setOrigin(0, 0.5));

    add(this.add.rectangle(barX, barY, barW, barH, 0x333344).setStrokeStyle(1, 0x555566));
    const fillW = Math.max(2, barW * Math.min(100, t.influence) / 100);
    add(this.add.rectangle(barX - barW / 2 + fillW / 2, barY, fillW, barH, 0xc9a959));
    add(this.add.text(barX + barW / 2 + 10, barY, `${t.influence}`, {
      font: 'bold 11px Arial', color: '#c9a959',
    }).setOrigin(0, 0.5));

    // ── 成绩行 ──
    add(this.add.text(TP_CX, top + 86,
      `擂台胜场 ${t.results.martialWins}  ·  论道 ${t.results.debateScore}  ·  结交 ${t.results.allianceScore}`, {
        font: '11px Arial', color: '#aaaacc',
      }).setOrigin(0.5));

    // ── 已选派代表行 ──
    const reps = this.gameManager.getTournamentRepresentatives();
    const martialName  = reps['martial']  ?? '–';
    const debateName   = reps['debate']   ?? '–';
    const politicsName = reps['politics'] ?? '–';
    add(this.add.text(TP_CX, top + 104,
      `武:${martialName}  论:${debateName}  结:${politicsName}`, {
        font: '11px Arial', color: '#c9a959',
      }).setOrigin(0.5));

    // ── S3-2 得分因子行（仅在三关阶段显示） ──
    {
      const db = this.gameManager.getContentDB();
      const disciples = state.disciples;
      let factorText = '';
      let factorColor = '#7788aa';

      if (t.phase === 'martial') {
        const slot = t.selectedRepresentatives.find(s => s.phaseId === 'martial');
        const d = slot ? disciples.find(dd => dd.id === slot.discipleId) : undefined;
        if (d) {
          const bd = TournamentManager.calcMartialPowerBreakdown(d, db?.martialArts);
          factorText = `体魄${bd.physique} 武学+${bd.artBonus} → 胜率${bd.winProbPct}%`;
          factorColor = '#88ccaa';
        } else {
          factorText = '未选派擂台代表';
          factorColor = '#cc8888';
        }
      } else if (t.phase === 'debate') {
        const slot = t.selectedRepresentatives.find(s => s.phaseId === 'debate');
        const d = slot ? disciples.find(dd => dd.id === slot.discipleId) : undefined;
        if (d) {
          const bd = TournamentManager.calcDebateBreakdown(d, state, db?.martialArts);
          const parts: string[] = [`悟${bd.compScore}`];
          if (bd.inheritanceBonus > 0) parts.push(`传+${bd.inheritanceBonus}`);
          if (bd.researchBonus > 0)    parts.push(`研+${bd.researchBonus}`);
          if (bd.alignBonus !== 0)     parts.push(`正${bd.alignBonus > 0 ? '+' : ''}${bd.alignBonus}`);
          factorText = `${parts.join(' ')} → 预计${bd.total}分`;
          factorColor = '#88aacc';
        } else {
          factorText = '未选派论道代表';
          factorColor = '#cc8888';
        }
      } else if (t.phase === 'politics') {
        const bd = TournamentManager.calcPoliticsBreakdown(state);
        const parts: string[] = [`声${bd.repScore}`, `势+${bd.allianceBonus}`];
        if (bd.alignBonus > 0) parts.push(`正+${bd.alignBonus}`);
        factorText = `${parts.join(' ')} → 预计${bd.total}分`;
        factorColor = '#ccaa66';
      }

      if (factorText) {
        add(this.add.text(TP_CX, top + 122, factorText, {
          font: '10px Arial', color: factorColor,
        }).setOrigin(0.5));
      }
    }

    // ── 阶段切换提示（首次检测到阶段变化时 toast） ──
    if (this.lastKnownPhase !== null && this.lastKnownPhase !== t.phase) {
      const db = this.gameManager.getContentDB();
      const phaseDef = db?.tournament?.phases.find(p => p.id === t.phase);
      const desc = phaseDef?.description ?? '';
      this.toast.show(`武林大会：${phaseName}${desc ? '\n' + desc.slice(0, 30) : ''}`, 'warn');
    }
    this.lastKnownPhase = t.phase;
  }

  // ── 虚拟场景导航 ─────────────────────────────────────────────────────────────

  private createSceneNavButtons(): void {
    // 4 场景按钮横排，y=697（面板底部 680 与存档按钮 730 之间）
    // 中心 x=195，4×62px=248px 总宽，从 x=69 起每 62px 一个
    const sm = SceneManager.getInstance();
    const sceneX = [79, 141, 249, 311];  // 避开存档(x=50±30)和结算(x=340±40)

    VIRTUAL_SCENE_DEFS.forEach((def, i) => {
      const x = sceneX[i];
      const y = 697;

      const container = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, 56, 24, 0x1a1a3a, 0.9)
        .setStrokeStyle(1, 0x4a4a6a);
      const label = this.add.text(0, 0, `${def.icon}${def.name}`, {
        font: '11px Arial', color: '#aaaacc',
      }).setOrigin(0.5);

      container.add([bg, label]);
      container.setSize(56, 24);
      container.setInteractive({ useHandCursor: true });

      container.on('pointerdown', () => {
        const state = this.gameManager.getState();
        const switched = sm.switchTo(def.id, state);
        if (!switched) {
          this.toast.show(`${def.name}尚未解锁`, 'warn');
        }
      });

      this.sceneNavButtons.push(container);
    });
  }

  private updateSceneNavButtons(): void {
    const sm = SceneManager.getInstance();
    const state = this.gameManager.getState();
    const current = sm.getCurrentScene();

    this.sceneNavButtons.forEach((container, i) => {
      const def = VIRTUAL_SCENE_DEFS[i];
      const bg    = container.getAt(0) as Phaser.GameObjects.Rectangle;
      const label = container.getAt(1) as Phaser.GameObjects.Text;
      const unlocked = sm.isUnlocked(def.id, state);
      const isCurrent = def.id === current;

      if (isCurrent) {
        bg.setFillStyle(0x3a3a1a, 0.95);
        bg.setStrokeStyle(2, 0xc9a959);
        label.setColor('#c9a959').setText(`${def.icon}${def.name}`);
      } else if (unlocked) {
        bg.setFillStyle(0x1a1a3a, 0.9);
        bg.setStrokeStyle(1, 0x4a4a6a);
        label.setColor('#aaaacc').setText(`${def.icon}${def.name}`);
      } else {
        bg.setFillStyle(0x111122, 0.7);
        bg.setStrokeStyle(1, 0x333344);
        label.setColor('#555566').setText(`🔒${def.name}`);
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────────────

  private createBottomNav() {
    const tabs: { key: TabType; label: string; icon: string }[] = [
      { key: 'overview',  label: '总览', icon: '🏠' },
      { key: 'build',     label: '建造', icon: '🏗️' },
      { key: 'disciples', label: '弟子', icon: '👥' },
      { key: 'missions',  label: '任务', icon: '⚔️' },
      { key: 'martial',   label: '武学', icon: '📖' },
      { key: 'faction',   label: '势力', icon: '🌐' },
    ];

    const navBg = this.add.rectangle(195, 810, 390, 70, 0x1a1a2e, 0.95);
    navBg.setStrokeStyle(2, 0xc9a959);

    // 6 tabs → spacing = 390/6 = 65px; first tab centred at 32.5
    tabs.forEach((tab, index) => {
      const x = 33 + index * 65;
      const y = 810;

      const container = this.add.container(x, y);
      const bg = this.add.rectangle(0, 0, 60, 60, 0x2a2a4e, 0.8);
      bg.setStrokeStyle(1, 0x4a4a6a);
      const icon  = this.add.text(0, -10, tab.icon, { font: '20px Arial' }).setOrigin(0.5);
      const label = this.add.text(0, 18, tab.label, { font: '10px Arial', color: '#aaa' }).setOrigin(0.5);

      container.add([bg, icon, label]);
      container.setSize(60, 60);
      container.setInteractive();
      container.on('pointerdown', () => this.switchTab(tab.key));
      this.tabButtons.push(container);
    });

    this.highlightTab(-1); // 初始无高亮，等玩家点击 tab
  }

  private createEndTurnButton() {
    const btn = this.add.container(340, 750);
    const bg   = this.add.rectangle(0, 0, 80, 40, 0xc9a959);
    bg.setStrokeStyle(2, 0xffd700);
    const text = this.add.text(0, 0, '结算月', { font: 'bold 14px Arial', color: '#1a1a2e' }).setOrigin(0.5);

    btn.add([bg, text]);
    btn.setSize(80, 40);
    btn.setInteractive();
    btn.on('pointerdown', () => this.gameManager.endTurn());
    btn.on('pointerover',  () => bg.setFillStyle(0xffd700));
    btn.on('pointerout',   () => bg.setFillStyle(0xc9a959));
  }

  private createSaveLoadButtons(): void {
    const saveBg = this.add.rectangle(50, 730, 60, 28, 0x1a3a1a, 0.9).setStrokeStyle(1, 0x3a7a3a);
    saveBg.setInteractive();
    const saveLabel = this.add.text(50, 730, '存档', { font: 'bold 12px Arial', color: '#88cc88' }).setOrigin(0.5);
    saveBg.on('pointerdown', () => {
      this.gameManager.saveGame();
      saveLabel.setText('已存！');
      this.time.delayedCall(1200, () => saveLabel.setText('存档'));
    });
    saveBg.on('pointerover', () => saveBg.setFillStyle(0x2a5a2a));
    saveBg.on('pointerout',  () => saveBg.setFillStyle(0x1a3a1a));

    const loadBg = this.add.rectangle(50, 765, 60, 28, 0x1a1a3a, 0.9).setStrokeStyle(1, 0x3a3a7a);
    loadBg.setInteractive();
    const loadLabel = this.add.text(50, 765, '读档', { font: 'bold 12px Arial', color: '#8888cc' }).setOrigin(0.5);
    loadBg.on('pointerdown', () => {
      const ok = this.gameManager.loadGame();
      loadLabel.setText(ok ? '已读！' : '无存档');
      this.time.delayedCall(1200, () => loadLabel.setText('读档'));
    });
    loadBg.on('pointerover', () => loadBg.setFillStyle(0x2a2a5a));
    loadBg.on('pointerout',  () => loadBg.setFillStyle(0x1a1a3a));
  }

  /** 显示/隐藏当前面板；-1 表示取消高亮（面板隐藏时） */
  private setPanelVisible(visible: boolean): void {
    this.panelVisible = visible;
    this.tabPanels.get(this.currentTab)?.setVisible(visible);
    if (visible) {
      const idx = ['overview', 'build', 'disciples', 'missions', 'martial', 'faction'].indexOf(this.currentTab);
      this.highlightTab(idx);
    } else {
      this.highlightTab(-1);   // 所有 tab 按钮取消高亮，表示面板已关闭
    }
  }

  private switchTab(tab: TabType) {
    // 点击已激活的 tab → 切换面板显隐（toggle）
    if (tab === this.currentTab) {
      this.setPanelVisible(!this.panelVisible);
      return;
    }

    // Reset selection state when leaving a tab
    if (this.currentTab === 'build') {
      this.buildingSlotAssign = null;
    } else if (this.currentTab === 'disciples') {
      this.selectedDiscipleId = null;
      this.martialDiscipleId = null;
      this.breakthroughDiscipleId = null;
      this.mastershipDiscipleId = null;
      this.tournamentSelectDiscipleId = null;
    } else if (this.currentTab === 'missions') {
      this.selectedMissionTemplateId = null;
      this.missionPartyIds = [];
    } else if (this.currentTab === 'martial') {
      this.martialResearchArtId = null;
      this.martialResearchPartyIds = [];
    } else if (this.currentTab === 'faction') {
      this.selectedFactionId = null;
    }
    this.panelVisible = true;
    this.currentTab = tab;
    const index = ['overview', 'build', 'disciples', 'missions', 'martial', 'faction'].indexOf(tab);
    this.highlightTab(index);
    this.tabPanels.forEach((panel, key) => { panel.setVisible(key === tab); });
    this.refreshTabContent(tab);
    this.events.emit('tabChanged', tab);
    this.gameManager.emit('sceneTabChanged', tab);
  }

  private highlightTab(index: number) {
    this.tabButtons.forEach((container, i) => {
      const bg = container.getAt(0) as Phaser.GameObjects.Rectangle;
      if (i === index) {
        bg.setFillStyle(0xc9a959, 0.3);
        bg.setStrokeStyle(2, 0xc9a959);
      } else {
        bg.setFillStyle(0x2a2a4e, 0.8);
        bg.setStrokeStyle(1, 0x4a4a6a);
      }
    });
  }

  private updateUI() {
    const state = this.gameManager.getState();

    // 时间显示（从 TimeManager 读取，比 monthIndex 更精细）
    this.updateTimeDisplay(this.gameManager.getTimeState());

    // 资源
    this.resourceTexts.get('silver')?.setText(state.resources.silver.toString());
    this.resourceTexts.get('food')?.setText((state.resources.inventories['food']  ?? 0).toString());
    this.resourceTexts.get('wood')?.setText((state.resources.inventories['wood']  ?? 0).toString());
    this.resourceTexts.get('stone')?.setText((state.resources.inventories['stone'] ?? 0).toString());
    this.resourceTexts.get('reputation')?.setText(state.resources.reputation.toString());
    this.resourceTexts.get('morale')?.setText(state.resources.morale.toString());

    this.refreshTabContent(this.currentTab);
    if (this.storyDetailVisible) this.rebuildStoryDetail();
    this.updateTournamentPanel();
    this.updateSceneNavButtons();

    // 大会自动场景切换
    const nowActive = !!state.tournament?.active;
    if (nowActive && !this.prevTournamentActive) {
      SceneManager.getInstance().forceSwitchTo('tournament_arena');
    }
    this.prevTournamentActive = nowActive;
  }

  // ── 主线详情弹窗 ───────────────────────────────────────────────────────────

  private createStoryDetailPopup(): void {
    // 半透明全屏遮罩，点击关闭弹窗
    this.storyDetailBlocker = this.add.rectangle(195, 422, 390, 845, 0x000000, 0.6);
    this.storyDetailBlocker.setDepth(148);
    this.storyDetailBlocker.setInteractive();
    this.storyDetailBlocker.on('pointerdown', () => this.hideStoryDetail());
    this.storyDetailBlocker.setVisible(false);

    // 弹窗容器（320×500，居中）
    this.storyDetailContainer = this.add.container(195, 422);
    this.storyDetailContainer.setDepth(149);
    this.storyDetailContainer.setVisible(false);

    // 背景板
    const bg = this.add.rectangle(0, 0, 320, 500, 0x0d0d1e, 0.97);
    bg.setStrokeStyle(2, 0xc9a959);
    this.storyDetailContainer.add(bg);

    // 标题
    const title = this.add.text(-140, -235, '主线进度', {
      font: 'bold 16px Arial', color: '#c9a959',
    }).setOrigin(0, 0.5);
    this.storyDetailContainer.add(title);

    // 关闭按钮
    const closeBtn = this.add.text(145, -235, '✕', {
      font: 'bold 16px Arial', color: '#666688',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffffff'));
    closeBtn.on('pointerout',  () => closeBtn.setColor('#666688'));
    closeBtn.on('pointerdown', () => this.hideStoryDetail());
    this.storyDetailContainer.add(closeBtn);

    // 分隔线
    const divider = this.add.rectangle(0, -218, 300, 1, 0x4a4a6a);
    this.storyDetailContainer.add(divider);
  }

  private showStoryDetail(): void {
    this.storyDetailVisible = true;
    this.storyDetailBlocker.setVisible(true);
    this.storyDetailContainer.setVisible(true);
    this.rebuildStoryDetail();
  }

  private hideStoryDetail(): void {
    this.storyDetailVisible = false;
    this.storyDetailBlocker.setVisible(false);
    this.storyDetailContainer.setVisible(false);
  }

  private rebuildStoryDetail(): void {
    this.storyDetailItems.forEach(item => item.destroy());
    this.storyDetailItems = [];

    const story   = this.gameManager.getState().story;
    const LINE_H  = 22;
    const INDENT  = 14;
    let y = -205;   // start y inside container (top content area)

    for (const chapter of story.chapters) {
      const chNum      = parseInt(chapter.id.replace('story.ch', ''), 10);
      const isLocked    = chapter.status === 'locked';
      const isActive    = chapter.status === 'active';
      const isCompleted = chapter.status === 'completed';

      // Chapter header background (active gets gold border)
      if (isActive) {
        const headerBg = this.add.rectangle(0, y + LINE_H / 2, 300, LINE_H + 6, 0x1a1000, 0.6)
          .setStrokeStyle(1, 0xc9a959);
        this.storyDetailContainer.add(headerBg);
        this.storyDetailItems.push(headerBg);
      }

      // Collapse state: locked → always collapsed; active → always expanded;
      // completed → toggleable (starts expanded)
      const isCollapsed = isLocked || (isCompleted && this.collapsedChapters.has(chapter.id));
      const arrow      = isCollapsed ? '▸' : '▾';
      const statusTag  = isActive ? '[激活中]' : isCompleted ? '[✓]' : '[锁]';
      const headerColor = isActive ? '#c9a959' : isCompleted ? '#88cc88' : '#555566';

      const headerTxt = this.add.text(
        -148, y,
        `${arrow} 第${chNum}章 ${chapter.title}  ${statusTag}`,
        { font: `${isActive ? 'bold ' : ''}13px Arial`, color: headerColor },
      ).setOrigin(0, 0);

      if (isCompleted) {
        headerTxt.setInteractive({ useHandCursor: true });
        const chId = chapter.id;
        headerTxt.on('pointerdown', () => {
          if (this.collapsedChapters.has(chId)) {
            this.collapsedChapters.delete(chId);
          } else {
            this.collapsedChapters.add(chId);
          }
          this.rebuildStoryDetail();
        });
      }

      this.storyDetailContainer.add(headerTxt);
      this.storyDetailItems.push(headerTxt);
      y += LINE_H + 4;

      // Expanded content (objectives + unlocks)
      if (!isCollapsed) {
        for (const obj of chapter.objectives) {
          const icon    = obj.done ? '☑' : '☐';
          const color   = obj.done ? '#88cc88' : '#aaaacc';
          const objTxt  = this.add.text(
            -148 + INDENT, y,
            `${icon} ${obj.text}  (${obj.current}/${obj.target})`,
            { font: '12px Arial', color },
          ).setOrigin(0, 0);
          this.storyDetailContainer.add(objTxt);
          this.storyDetailItems.push(objTxt);
          y += LINE_H;
        }

        if (chapter.unlocks.length > 0) {
          const unlockNames = chapter.unlocks
            .map(u => u.unlocked ? `✓${u.name}` : u.name)
            .join(', ');
          const unlockTxt = this.add.text(
            -148 + INDENT, y,
            `解锁: ${unlockNames}`,
            { font: '11px Arial', color: '#7799aa' },
          ).setOrigin(0, 0);
          this.storyDetailContainer.add(unlockTxt);
          this.storyDetailItems.push(unlockTxt);
          y += LINE_H;
        }

        y += 4;   // extra gap after expanded chapter
      }

      y += 4;   // gap between chapters
    }
  }
}
