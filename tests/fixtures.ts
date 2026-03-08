/**
 * Shared test fixtures — minimal ContentDB + initial GameState
 *
 * All test content is defined inline so tests run without loading JSON files.
 * Use loadRealContentDB() for integration tests that need real content.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import type { GameState } from '../src/runtime/turn_engine/types.js';
import type { ContentDB } from '../src/runtime/turn_engine/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONTENT_DIR = resolve(__dirname, '../public/assets/content');

// ── Minimal empty ContentDB (for unit tests that don't need events/missions) ──

export function makeEmptyContentDB(): ContentDB {
  return {
    buildings: { buildings: [] },
    disciples: {
      namePools: { surnames: ['张'], givenNames: ['三'] },
      statDefs: [
        { id: 'physique',      name: '体魄', min: 1, max: 100 },
        { id: 'comprehension', name: '悟性', min: 1, max: 100 },
        { id: 'willpower',     name: '定力', min: 1, max: 100 },
        { id: 'agility',       name: '身法', min: 1, max: 100 },
        { id: 'charisma',      name: '魅力', min: 1, max: 100 },
      ],
      recruitPool: { baseSize: 2, maxSize: 5 },
      maxDiscipleCount: 12,
    },
    martialArts: {
      maxEquipSlots: 4,
      categories: ['内功', '外功'],
      martialArts: [
        { id: 'test_basic',    name: '测试基础功', category: '外功', description: '测试用', conflictGroup: 'test', researchCost: 10,  prerequisites: [],           trainingBonus: [], power: 5,  martialCategory: 'outer',    tier: 1, learnCost: { months: 2, comprehensionReq: 10 } },
        { id: 'test_advanced', name: '测试进阶功', category: '内功', description: '测试用', conflictGroup: 'adv', researchCost: 50,  prerequisites: ['test_basic'], trainingBonus: [], power: 20, martialCategory: 'inner',    tier: 3, realmRequired: 'qi_gather' as const, learnCost: { months: 5, comprehensionReq: 35, silver: 100 } },
        { id: 'test_ultimate', name: '测试绝学',   category: '绝技', description: '测试用', conflictGroup: 'ult', researchCost: 200, prerequisites: ['test_advanced'], trainingBonus: [], power: 60, martialCategory: 'ultimate', tier: 5, realmRequired: 'foundation' as const, learnCost: { months: 10, comprehensionReq: 60, silver: 500 } },
      ],
    },
    missions: { templates: [], eventCards: [] },
    events: { events: [], annualChains: [] },
    factions: { factions: [] },
    realms: {
      realms: [
        { id: 'mortal',      name: '凡人', order: 0, attrMultiplier: 1.0,  maxMartialSlots: 1, requirements: { stats: {},                                              realmProgressMin: 0  } },
        { id: 'qi_sense',    name: '感气', order: 1, attrMultiplier: 1.15, maxMartialSlots: 2, requirements: { stats: { physique: 30, comprehension: 25 },              realmProgressMin: 80, resources: { silver: 100 } } },
        { id: 'qi_gather',   name: '聚气', order: 2, attrMultiplier: 1.3,  maxMartialSlots: 2, requirements: { stats: { physique: 45, comprehension: 40 },              realmProgressMin: 80, resources: { silver: 300, herbs: 50 } } },
        { id: 'foundation',  name: '筑基', order: 3, attrMultiplier: 1.5,  maxMartialSlots: 3, requirements: { stats: { physique: 60, comprehension: 55, willpower: 40 }, realmProgressMin: 85, resources: { silver: 800, herbs: 150 } } },
        { id: 'inner_core',  name: '结丹', order: 4, attrMultiplier: 1.75, maxMartialSlots: 3, requirements: { stats: { physique: 75, comprehension: 70, willpower: 55 }, realmProgressMin: 85, resources: { silver: 2000, herbs: 400 } } },
        { id: 'golden_core', name: '金丹', order: 5, attrMultiplier: 2.0,  maxMartialSlots: 4, requirements: { stats: { physique: 90, comprehension: 85, willpower: 70 }, realmProgressMin: 90, resources: { silver: 5000, herbs: 1000 } } },
        { id: 'nascent',     name: '元婴', order: 6, attrMultiplier: 2.25, maxMartialSlots: 4, requirements: { stats: { physique: 100, comprehension: 95, willpower: 85 }, realmProgressMin: 90, resources: { silver: 10000, herbs: 2000 } } },
        { id: 'transcend',   name: '化神', order: 7, attrMultiplier: 2.5,  maxMartialSlots: 5, requirements: { stats: { physique: 120, comprehension: 110, willpower: 100 }, realmProgressMin: 95, resources: { silver: 25000, herbs: 5000 } } },
      ],
    },
    talents: {
      talents: [
        { grade: 'S', name: '天纵奇才', probability: 0.03, monthlyGrowthBonus: 3,  breakthroughBonus: 25, realmProgressBonus: 3  },
        { grade: 'A', name: '资质上佳', probability: 0.12, monthlyGrowthBonus: 2,  breakthroughBonus: 15, realmProgressBonus: 2  },
        { grade: 'B', name: '中等之资', probability: 0.35, monthlyGrowthBonus: 1,  breakthroughBonus: 8,  realmProgressBonus: 1  },
        { grade: 'C', name: '资质平平', probability: 0.35, monthlyGrowthBonus: 0,  breakthroughBonus: 0,  realmProgressBonus: 0  },
        { grade: 'D', name: '根骨愚钝', probability: 0.15, monthlyGrowthBonus: -1, breakthroughBonus: -8, realmProgressBonus: -1 },
      ],
    },
    tournament: {
      phases: [
        { id: 'announcement', name: '宣布召开', durationMonths: 0, description: '' },
        { id: 'gathering',    name: '群雄汇聚', durationMonths: 1, description: '' },
        { id: 'martial',      name: '武道比试', durationMonths: 1, description: '' },
        { id: 'debate',       name: '论道辩难', durationMonths: 1, description: '' },
        { id: 'politics',     name: '纵横结盟', durationMonths: 1, description: '' },
        { id: 'conclusion',   name: '盟主归属', durationMonths: 0, description: '' },
      ],
      rewards: {
        champion:    { title: '武林盟主', effects: [{ type: 'reputation_delta', delta: 500, reason: '武林盟主' }, { type: 'morale_delta', delta: 30, reason: '士气大振' }] },
        topThree:    { effects: [{ type: 'reputation_delta', delta: 200, reason: '大会前三' }] },
        participant: { effects: [{ type: 'reputation_delta', delta: 50,  reason: '大会参与' }] },
      },
      triggerCondition: { yearModulo: 4, month: 6 },
    },
  };
}

// ── Default initial GameState (mirrors GameManager.createInitialState) ────────

export function makeInitialState(seed = 42): GameState {
  return {
    monthIndex: 0,
    yearIndex: 0,
    rngSeed: seed,
    rngState: seed,
    resources: {
      silver: 1000,
      reputation: 100,
      inheritance: 0,
      inventories: { food: 500, wood: 300, stone: 200, herbs: 50 },
      debtMonths: 0,
      morale: 80,
      alignmentValue: 0,
    },
    grid: { width: 8, height: 8, placedBuildings: {} },
    disciples: [
      { id: 'd1', name: '张三', stats: { physique: 40, comprehension: 35, willpower: 30, agility: 50, charisma: 25 }, statuses: [], trainingProgress: {}, realm: 'mortal' as const, realmProgress: 0, breakthroughAttempts: 0, talentGrade: 'C' as const },
    ],
    missionsActive: [],
    recruitPool: [],
    missionsPool: [],
    martialArts: { unlocked: [], research: {} },
    factions: {},
    flags: {},
    unlocks: { systems: [], buildings: [], martials: [], features: [] },
    mainline: { currentChapter: 1, completedObjectives: [], unlockedScenes: ['scene_gate'] },
    story: {
      activeChapterId: 'story.ch1',
      chapters: [
        {
          id: 'story.ch1', title: '破败山门', monthRange: { start: 1, end: 6 },
          status: 'active',
          objectives: [{ id: 'obj.ch1_recruit_5', text: '招募5名弟子', current: 0, target: 5, done: false }],
          unlocks: [{ type: 'system', id: 'mission_dispatch', name: '任务派遣', unlocked: false }],
        },
        {
          id: 'story.ch2', title: '初入江湖', monthRange: { start: 7, end: 18 },
          status: 'locked',
          objectives: [{ id: 'obj.ch2_reputation_300', text: '名望达到300', current: 0, target: 300, done: false }],
          unlocks: [],
        },
        {
          id: 'story.ch3', title: '风云际会', monthRange: { start: 19, end: 30 },
          status: 'locked',
          objectives: [{ id: 'obj.ch3_master_disciple', text: '培养一名宗师弟子（任意属性≥80）', current: 0, target: 1, done: false }],
          unlocks: [],
        },
        {
          id: 'story.ch4', title: '群雄逐鹿', monthRange: { start: 31, end: 36 },
          status: 'locked',
          objectives: [{ id: 'obj.ch4_qualified', text: '获得武林大会参赛资格', current: 0, target: 1, done: false }],
          unlocks: [],
        },
        {
          id: 'story.ch5', title: '武林大会', monthRange: { start: 36, end: 36 },
          status: 'locked',
          objectives: [{ id: 'obj.ch5_win', text: '在武林大会中夺冠', current: 0, target: 1, done: false }],
          unlocks: [],
        },
      ],
    },
    history: { triggeredEvents: {}, annualChainProgress: {} },
    tournament: {
      active: false, year: 0, phase: 'announcement', phaseMonthsElapsed: 0,
      influence: 0, participants: [], rankings: [], events: [],
      selectedRepresentatives: [], results: { martialWins: 0, debateScore: 0, allianceScore: 0 },
      takenPrepActions: [],
    },
  };
}

// ── Real content DB (loaded from actual JSON files) ───────────────────────────

export function loadRealContentDB(): ContentDB {
  function load<T>(name: string): T {
    return JSON.parse(readFileSync(resolve(CONTENT_DIR, name), 'utf-8')) as T;
  }
  return {
    buildings:   load('buildings.json'),
    disciples:   load('disciples.json'),
    martialArts: load('martial_arts.json'),
    missions:    load('missions.json'),
    events:      load('events.json'),
    factions:    load('factions.json'),
    tournament:  load('tournament.json'),
    realms:      load('realms.json'),
    talents:     load('talents.json'),
  };
}
