#!/usr/bin/env node
/**
 * 10年模拟工具 — simulate_10years.ts
 *
 * 从默认初始状态快进 120 个月（10年），输出关键统计数据。
 * 结果写入 tools/output/10year_sim.json（供 CI/回归对比使用）。
 *
 * 运行方式：
 *   npx tsx tools/simulate_10years.ts
 *   npx tsx tools/simulate_10years.ts --seed=42 --months=60
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import type { GameState } from '../src/runtime/turn_engine/types.js';
import type { ContentDB } from '../src/runtime/turn_engine/engine.js';
import { fastForward, summarizeSimulation } from '../src/runtime/debug/fast_forward.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, '../public/assets/content');
const OUTPUT_DIR = resolve(__dirname, 'output');

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): { seed: number; months: number } {
  let seed = 42;
  let months = 120;
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) {
      if (m[1] === 'seed') seed = parseInt(m[2], 10);
      if (m[1] === 'months') months = parseInt(m[2], 10);
    }
  }
  return { seed, months };
}

// ── Content loading ───────────────────────────────────────────────────────────

function loadJSON<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(CONTENT_DIR, name), 'utf-8')) as T;
}

function loadContentDB(): ContentDB {
  return {
    buildings:  loadJSON('buildings.json'),
    disciples:  loadJSON('disciples.json'),
    martialArts: loadJSON('martial_arts.json'),
    missions:   loadJSON('missions.json'),
    events:     loadJSON('events.json'),
  };
}

// ── Initial state (mirrors GameManager.createInitialState) ───────────────────

function createInitialState(seed: number): GameState {
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
    grid: {
      width: 8,
      height: 8,
      placedBuildings: {
        b1: { id: 'b1', defId: 'scripture_library',   x: 3, y: 3, level: 1 },
        b2: { id: 'b2', defId: 'meditation_chamber',  x: 4, y: 2, level: 1 },
        b3: { id: 'b3', defId: 'training_ground',     x: 2, y: 4, level: 1 },
      },
    },
    disciples: [
      { id: 'd1', name: '张三', stats: { physique: 40, comprehension: 35, willpower: 30, agility: 50, charisma: 25 }, statuses: [], trainingProgress: {} },
      { id: 'd2', name: '李四', stats: { physique: 30, comprehension: 50, willpower: 45, agility: 35, charisma: 40 }, statuses: [], trainingProgress: {} },
      { id: 'd3', name: '王五', stats: { physique: 60, comprehension: 25, willpower: 55, agility: 60, charisma: 20 }, statuses: [], trainingProgress: {} },
    ],
    missionsActive: [],
    recruitPool: [],
    martialArts: { unlocked: [], research: {} },
    factions: {},
    flags: {},
    history: { triggeredEvents: {}, annualChainProgress: {} },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const { seed, months } = parseArgs();
console.log(`\n⚡ 10-Year Simulation  seed=${seed}  months=${months}\n`);

const contentDB = loadContentDB();
const initialState = createInitialState(seed);

const t0 = Date.now();
const result = fastForward(initialState, contentDB, months, seed);
const elapsed = Date.now() - t0;

const summary = summarizeSimulation(result);

// ── Console output ────────────────────────────────────────────────────────────

const { finalResources: res } = summary;

console.log('── Final Resources ─────────────────────────────────────');
console.log(`  Silver       : ${res.silver}`);
console.log(`  Reputation   : ${res.reputation}`);
console.log(`  Inheritance  : ${res.inheritance}`);
console.log(`  Morale       : ${res.morale}`);
console.log(`  AlignValue   : ${res.alignmentValue}`);
for (const [k, v] of Object.entries(res.inventories)) {
  console.log(`  ${k.padEnd(13)}: ${v}`);
}

console.log('\n── Simulation Stats ────────────────────────────────────');
console.log(`  Months simulated  : ${summary.months}`);
console.log(`  Events triggered  : ${summary.totalEventsTriggered}`);
console.log(`  Missions completed: ${summary.totalMissionsCompleted}`);
console.log(`  Flag changes total: ${summary.totalFlagChanges}`);
console.log(`  Chains completed  : ${summary.annualChainsCompleted.join(', ') || '(none)'}`);
console.log(`  Elapsed           : ${elapsed}ms`);

if (Object.keys(summary.netResourcesOverall).length > 0) {
  console.log('\n── Net Resource Change (all months) ────────────────────');
  for (const [k, v] of Object.entries(summary.netResourcesOverall)) {
    console.log(`  ${k.padEnd(15)}: ${v >= 0 ? '+' : ''}${v}`);
  }
}

if (Object.keys(summary.finalFactions).length > 0) {
  console.log('\n── Final Faction Relations ──────────────────────────────');
  for (const [id, rel] of Object.entries(summary.finalFactions)) {
    console.log(`  ${id.padEnd(20)}: ${rel}`);
  }
}

// ── JSON output ───────────────────────────────────────────────────────────────

mkdirSync(OUTPUT_DIR, { recursive: true });
const outPath = resolve(OUTPUT_DIR, '10year_sim.json');

const output = {
  meta: { seed, months, elapsed_ms: elapsed, generated: new Date().toISOString() },
  summary,
  finalState: result.finalState,
  reports: result.reports,
};

writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`\n✅ Report written to ${outPath}\n`);
