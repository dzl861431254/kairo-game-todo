# 战斗演出系统 - 技术设计文档

> 版本：v1.1（根据评审修订）
> 日期：2026-03-07
> 预估工时：4-5 天
>
> **v1.1 修订**:
> - P0-1: 全面使用 seeded RNG，禁止 Math.random()
> - P0-2: turnOrder 每次取 actor 时跳过死亡单位
> - P0-3: 明确 CombatState 为可变对象，不假装不可变
> - P0-4: 对齐弟子属性（physique→攻击, willpower→防御, agility→速度, comprehension→技能触发）
> - P1-3: 演出与结算解耦：先算结果，再播动画

---

## 一、系统概述

### 1.1 设计目标

- 为武林大会、任务战斗、切磋挑战提供可视化演出
- 简洁的回合制战斗，强调策略性而非操作
- 武学系统与战斗深度结合

### 1.2 战斗场景

| 场景 | 触发方式 | 参与者 | 奖励 |
|------|----------|--------|------|
| **武林大会·武道比试** | 大会 martial 阶段 | 选派弟子 vs AI | 积分 |
| **任务战斗** | 战斗型任务事件 | 任务队伍 vs 敌人 | 任务奖励 |
| **门派挑战** | 其他门派来访 | 守方弟子 vs 访客 | 声望/关系 |
| **切磋** | 玩家主动 | 任意两弟子 | 无/经验 |

---

## 二、战斗数据结构

### 2.1 战斗单位

```typescript
interface CombatUnit {
  id: string;
  name: string;
  isPlayer: boolean;           // 是否玩家方
  
  // 基础属性（从 Disciple 派生）
  maxHp: number;
  currentHp: number;
  attack: number;              // 攻击力 = physique × realmMultiplier
  defense: number;             // 防御力 = willpower × 0.5
  speed: number;               // 速度 = agility
  
  // 武学
  equippedArts: CombatArt[];
  
  // 状态
  buffs: CombatBuff[];
  cooldowns: Map<string, number>;  // 武学冷却
}

interface CombatArt {
  id: string;
  name: string;
  category: 'inner' | 'outer' | 'ultimate';
  
  // 战斗效果
  damageMultiplier: number;    // 伤害倍率 1.0 ~ 3.0
  hitCount: number;            // 攻击次数 1-3
  cooldown: number;            // 冷却回合数
  
  // 特殊效果
  effects?: CombatEffect[];
}

interface CombatEffect {
  type: 'damage' | 'heal' | 'buff' | 'debuff' | 'dot' | 'stun';
  value: number;
  duration?: number;
  chance?: number;             // 触发概率 0-1
}

interface CombatBuff {
  id: string;
  name: string;
  type: 'attack_up' | 'defense_up' | 'speed_up' | 'regen' | 'dot' | 'stun';
  value: number;
  remainingTurns: number;
}
```

### 2.2 战斗状态

```typescript
interface CombatState {
  id: string;
  type: 'tournament' | 'mission' | 'challenge' | 'spar';
  
  turn: number;
  maxTurns: number;            // 回合上限（防无限战斗）
  
  playerUnits: CombatUnit[];
  enemyUnits: CombatUnit[];
  
  turnOrder: string[];         // 按速度排序的单位 ID
  currentActorIndex: number;
  
  rng: RNG;                    // ⚠️ 必须使用 seeded RNG，禁止 Math.random()
  
  log: CombatLogEntry[];
  result?: CombatResult;
}

// ⚠️ 重要约束：CombatState 是**可变对象**
// - 执行动作时直接修改 playerUnits/enemyUnits
// - 不要假装不可变（避免浅拷贝误导）
// - 如需回放/预测，应先 clone 整个 state

interface CombatLogEntry {
  turn: number;
  actorId: string;
  action: 'attack' | 'skill' | 'defend' | 'item';
  targetId?: string;
  artId?: string;
  damage?: number;
  effects?: string[];
  message: string;
}

interface CombatResult {
  winner: 'player' | 'enemy' | 'draw';
  playerSurvivors: string[];
  enemySurvivors: string[];
  totalDamageDealt: number;
  totalDamageTaken: number;
  turnsUsed: number;
}
```

---

## 三、战斗流程

### 3.1 战斗初始化

```typescript
function initCombat(
  type: CombatState['type'],
  playerDiscipleIds: string[],
  enemies: EnemyDef[],
  state: GameState,
  db: ContentDB
): CombatState {
  const playerUnits = playerDiscipleIds.map(id => 
    discipleToCombatUnit(state.disciples.find(d => d.id === id)!, db)
  );
  
  const enemyUnits = enemies.map(e => enemyToCombatUnit(e, db));
  
  // 按速度排序
  const allUnits = [...playerUnits, ...enemyUnits];
  const turnOrder = allUnits
    .sort((a, b) => b.speed - a.speed)
    .map(u => u.id);
  
  return {
    id: generateId(),
    type,
    turn: 1,
    maxTurns: 30,
    playerUnits,
    enemyUnits,
    turnOrder,
    currentActorIndex: 0,
    log: [],
  };
}

/**
 * 弟子属性 → 战斗属性映射
 * 
 * | 弟子属性 | 战斗属性 | 说明 |
 * |----------|----------|------|
 * | physique | attack, maxHp | 体魄→攻击力、生命值 |
 * | willpower | defense | 心志→防御力 |
 * | agility | speed | 身法→行动速度 |
 * | comprehension | skillTriggerBonus | 悟性→技能触发概率加成 |
 */
function discipleToCombatUnit(d: Disciple, db: ContentDB): CombatUnit {
  const realmDef = db.realms.realms.find(r => r.id === d.realm);
  const multiplier = realmDef?.attrMultiplier ?? 1.0;
  
  const physique = d.stats.physique ?? 50;
  const willpower = d.stats.willpower ?? 30;
  const agility = d.stats.agility ?? 30;
  const comprehension = d.stats.comprehension ?? 30;
  
  return {
    id: d.id,
    name: d.name,
    isPlayer: true,
    maxHp: Math.floor(physique * multiplier * 2),
    currentHp: Math.floor(physique * multiplier * 2),
    attack: Math.floor(physique * multiplier),
    defense: Math.floor(willpower * 0.5 * multiplier),
    speed: agility,
    skillTriggerBonus: comprehension * 0.005,  // 悟性每点 +0.5% 技能触发
    equippedArts: (d.loadout?.equippedArts ?? []).map(artId => 
      martialArtToCombatArt(db.martialArts.arts.find(a => a.id === artId)!)
    ).filter(Boolean),
    buffs: [],
    cooldowns: new Map(),
  };
}
```

### 3.2 回合执行

```typescript
interface CombatAction {
  type: 'attack' | 'skill' | 'defend';
  artId?: string;
  targetId?: string;
}

/**
 * 执行一个行动（直接修改 combat 状态）
 * ⚠️ CombatState 是可变对象，此函数直接 mutate
 */
function executeTurn(combat: CombatState, action: CombatAction): void {
  const actor = getCurrentActor(combat);
  if (!actor || actor.currentHp <= 0) {
    // 跳过死亡单位
    advanceToNextActor(combat);
    return;
  }
  
  // 回合开始：处理 buff/debuff
  processBuffs(actor);
  
  // 眩晕检查
  if (actor.buffs.some(b => b.type === 'stun')) {
    combat.log.push({
      turn: combat.turn,
      actorId: actor.id,
      action: 'attack',
      message: `${actor.name} 被眩晕，无法行动`,
    });
  } else {
    // 执行动作
    switch (action.type) {
      case 'attack':
        executeBasicAttack(combat, actor, action.targetId!);
        break;
      case 'skill':
        executeSkill(combat, actor, action.artId!, action.targetId!);
        break;
      case 'defend':
        executeDefend(combat, actor);
        break;
    }
  }
  
  // 减少冷却
  for (const [artId, cd] of actor.cooldowns) {
    if (cd > 0) actor.cooldowns.set(artId, cd - 1);
  }
  
  // 下一个行动者（跳过死亡单位）
  advanceToNextActor(combat);
  
  // 检查战斗结束
  checkCombatEnd(combat);
}

/**
 * 推进到下一个存活单位
 */
function advanceToNextActor(combat: CombatState): void {
  const startIndex = combat.currentActorIndex;
  let attempts = 0;
  
  do {
    combat.currentActorIndex = (combat.currentActorIndex + 1) % combat.turnOrder.length;
    if (combat.currentActorIndex === 0) {
      combat.turn++;
    }
    
    const actor = findUnit(combat, combat.turnOrder[combat.currentActorIndex]);
    if (actor && actor.currentHp > 0) {
      return; // 找到存活单位
    }
    
    attempts++;
  } while (attempts < combat.turnOrder.length);
}

function executeBasicAttack(combat: CombatState, actor: CombatUnit, targetId: string): void {
  const target = findUnit(combat, targetId);
  if (!target) return;
  
  const rawDamage = actor.attack;
  const finalDamage = Math.max(1, rawDamage - target.defense);
  target.currentHp -= finalDamage;
  
  combat.log.push({
    turn: combat.turn,
    actorId: actor.id,
    action: 'attack',
    targetId,
    damage: finalDamage,
    message: `${actor.name} 攻击 ${target.name}，造成 ${finalDamage} 伤害`,
  });
}

function executeSkill(
  combat: CombatState,
  actor: CombatUnit,
  artId: string,
  targetId: string
): void {
  const art = actor.equippedArts.find(a => a.id === artId);
  if (!art) return;
  
  // 检查冷却
  if ((actor.cooldowns.get(artId) ?? 0) > 0) {
    combat.log.push({
      turn: combat.turn,
      actorId: actor.id,
      action: 'skill',
      message: `${art.name} 冷却中`,
    });
    return;
  }
  
  const target = findUnit(combat, targetId);
  if (!target) return;
  
  // 多段攻击
  let totalDamage = 0;
  for (let i = 0; i < art.hitCount; i++) {
    const rawDamage = Math.floor(actor.attack * art.damageMultiplier);
    const finalDamage = Math.max(1, rawDamage - target.defense);
    target.currentHp -= finalDamage;
    totalDamage += finalDamage;
  }
  
  // 设置冷却
  actor.cooldowns.set(artId, art.cooldown);
  
  // 触发特殊效果（使用 seeded RNG）
  for (const effect of art.effects ?? []) {
    if (combat.rng.next() < (effect.chance ?? 1)) {
      applyEffect(combat, actor, target, effect);
    }
  }
  
  combat.log.push({
    turn: combat.turn,
    actorId: actor.id,
    action: 'skill',
    targetId,
    artId,
    damage: totalDamage,
    message: `${actor.name} 使用 ${art.name}，对 ${target.name} 造成 ${totalDamage} 伤害`,
  });
}
```

### 3.3 AI 决策

```typescript
function getAIAction(combat: CombatState, actor: CombatUnit): CombatAction {
  // 优先使用未冷却的高伤害武学
  const availableArts = actor.equippedArts.filter(
    art => (actor.cooldowns.get(art.id) ?? 0) === 0
  );
  
  // 选择目标：优先血量最低的敌人
  const enemies = actor.isPlayer ? combat.enemyUnits : combat.playerUnits;
  const aliveEnemies = enemies.filter(e => e.currentHp > 0);
  if (aliveEnemies.length === 0) return { type: 'defend' };
  
  const target = aliveEnemies.reduce((a, b) => 
    a.currentHp < b.currentHp ? a : b
  );
  
  // 有武学就用武学，否则普攻
  if (availableArts.length > 0) {
    const bestArt = availableArts.reduce((a, b) => 
      a.damageMultiplier > b.damageMultiplier ? a : b
    );
    return { type: 'skill', artId: bestArt.id, targetId: target.id };
  }
  
  return { type: 'attack', targetId: target.id };
}
```

---

## 四、演出系统

### 4.1 战斗场景 (CombatScene.ts)

```typescript
class CombatScene extends Phaser.Scene {
  private combatState!: CombatState;
  private playerSprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private enemySprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private hpBars: Map<string, { bg: Phaser.GameObjects.Rectangle; fill: Phaser.GameObjects.Rectangle }> = new Map();
  private logText!: Phaser.GameObjects.Text;
  private actionPanel!: Phaser.GameObjects.Container;
  
  // 位置常量
  private readonly PLAYER_POSITIONS = [
    { x: 100, y: 300 },
    { x: 100, y: 400 },
    { x: 100, y: 500 },
  ];
  
  private readonly ENEMY_POSITIONS = [
    { x: 290, y: 300 },
    { x: 290, y: 400 },
    { x: 290, y: 500 },
  ];
  
  create(data: { combatState: CombatState }) {
    this.combatState = data.combatState;
    
    // 背景
    this.add.rectangle(195, 420, 390, 844, 0x1a1a2e);
    
    // 战斗场地
    this.add.rectangle(195, 400, 360, 300, 0x2a2a4e, 0.5)
      .setStrokeStyle(2, 0xc9a959);
    
    // 创建单位精灵
    this.createUnitSprites();
    
    // 战斗日志
    this.logText = this.add.text(195, 600, '', {
      font: '12px Arial',
      color: '#cccccc',
      wordWrap: { width: 360 },
      align: 'center',
    }).setOrigin(0.5, 0);
    
    // 动作面板
    this.createActionPanel();
    
    // 开始战斗循环
    this.runCombatLoop();
  }
  
  private async runCombatLoop() {
    while (!this.combatState.result) {
      const actor = this.getCurrentActor();
      
      if (actor.isPlayer) {
        // 玩家回合：等待输入
        this.showActionPanel(actor);
        const action = await this.waitForPlayerAction();
        this.hideActionPanel();
        await this.executeAndAnimate(action);
      } else {
        // AI 回合
        await this.delay(500);
        const action = getAIAction(this.combatState, actor);
        await this.executeAndAnimate(action);
      }
    }
    
    // 战斗结束
    this.showResult();
  }
  
  /**
   * ⚠️ 演出与结算解耦：先算结果，再播动画
   * 这样便于：快进、跳过、回放、网络同步
   */
  private async executeAndAnimate(action: CombatAction) {
    const actor = this.getCurrentActor();
    const logBefore = this.combatState.log.length;
    
    // 1️⃣ 先执行逻辑，获取结果
    executeTurn(this.combatState, action);
    
    // 2️⃣ 获取本次行动产生的 log
    const newLogs = this.combatState.log.slice(logBefore);
    if (newLogs.length === 0) return;
    
    const logEntry = newLogs[0];
    
    // 3️⃣ 根据结果播放演出
    if (action.type === 'attack' || action.type === 'skill') {
      const actorSprite = this.getSprite(actor.id);
      const targetSprite = logEntry.targetId ? this.getSprite(logEntry.targetId) : null;
      
      if (actorSprite && targetSprite) {
        // 冲刺动画
        await this.tweenTo(actorSprite, targetSprite.x - 50, actorSprite.y, 200);
        
        // 攻击特效
        if (action.type === 'skill' && logEntry.artId) {
          this.playSkillEffect(logEntry.artId);
        }
        
        // 伤害数字（基于已计算的结果）
        if (logEntry.damage) {
          this.showDamageNumber(targetSprite.x, targetSprite.y - 30, logEntry.damage);
          this.flashSprite(targetSprite);
          this.updateHpBar(logEntry.targetId!);
        }
        
        // 返回原位
        await this.tweenTo(actorSprite, this.getOriginalPosition(actor.id).x, actorSprite.y, 200);
      }
      
      // 更新日志显示
      this.logText.setText(logEntry.message);
    }
  }
  
  private showDamageNumber(x: number, y: number, damage: number) {
    const text = this.add.text(x, y, `-${damage}`, {
      font: 'bold 18px Arial',
      color: '#ff4444',
    }).setOrigin(0.5);
    
    this.tweens.add({
      targets: text,
      y: y - 40,
      alpha: 0,
      duration: 800,
      onComplete: () => text.destroy(),
    });
  }
}
```

### 4.2 武学特效

```typescript
private playSkillEffect(artId: string) {
  const art = this.combatState./* ... */;
  
  switch (art.category) {
    case 'inner':
      // 内功：光环效果
      this.add.circle(195, 400, 50, 0x4444ff, 0.5)
        .setBlendMode(Phaser.BlendModes.ADD);
      break;
    case 'outer':
      // 外功：斩击效果
      this.add.line(0, 0, 150, 350, 250, 450, 0xffff00)
        .setLineWidth(3);
      break;
    case 'ultimate':
      // 绝技：全屏特效
      this.cameras.main.shake(200, 0.01);
      this.cameras.main.flash(200, 255, 255, 255, false);
      break;
  }
}
```

---

## 五、与现有系统集成

### 5.1 武林大会集成

```typescript
// tournament/manager.ts 修改
function resolveMartial(state: GameState, db: ContentDB, rng: RNG): number {
  const rep = state.tournament?.selectedRepresentatives.find(
    r => r.phaseId === 'martial'
  );
  
  if (!rep?.discipleId) return 0;
  
  // 生成 3 场战斗
  const combats = [
    initCombat('tournament', [rep.discipleId], [generateTournamentOpponent(1, db)], state, db),
    initCombat('tournament', [rep.discipleId], [generateTournamentOpponent(2, db)], state, db),
    initCombat('tournament', [rep.discipleId], [generateTournamentOpponent(3, db)], state, db),
  ];
  
  // 自动战斗（无演出）获取结果
  let wins = 0;
  for (const combat of combats) {
    const result = runAutoCombat(combat, rng);
    if (result.winner === 'player') wins++;
  }
  
  return wins;
}
```

### 5.2 任务战斗集成

```typescript
// 任务事件卡中的战斗选项
{
  "id": "bandit_ambush",
  "type": "combat",
  "enemies": [
    { "id": "bandit_1", "name": "山贼头目", "level": 3 },
    { "id": "bandit_2", "name": "山贼喽啰", "level": 1 },
  ],
  "rewards": { "silver": 200, "reputation": 10 },
  "failPenalty": { "morale": -5 }
}
```

---

## 六、实现计划

| Day | 任务 |
|-----|------|
| **1** | CombatUnit/CombatState 类型 + 战斗初始化 |
| **2** | 回合执行逻辑 + AI 决策 + 武学效果 |
| **3** | CombatScene 基础 UI + 单位显示 |
| **4** | 动画系统 + 特效 |
| **5** | 集成武林大会/任务 + 测试 |

---

## 七、测试用例

```typescript
describe('战斗系统', () => {
  it('initCombat: 正确计算 HP/攻击/防御');
  it('initCombat: 按速度排序 turnOrder');
  it('executeBasicAttack: 伤害 = 攻击 - 防御');
  it('executeSkill: 多段攻击正确计算');
  it('executeSkill: 冷却正确设置');
  it('executeSkill: 特殊效果正确触发');
  it('getAIAction: 优先攻击低血量目标');
  it('getAIAction: 优先使用高伤武学');
  it('checkCombatEnd: 全灭判定正确');
  it('checkCombatEnd: 回合上限平局');
  it('runAutoCombat: 确定性结果（相同 RNG）');
});
```

---

*设计文档 v1.0 · 2026-03-07*
