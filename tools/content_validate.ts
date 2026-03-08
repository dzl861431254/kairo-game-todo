#!/usr/bin/env node
/**
 * Content Validator — 内容文件校验器
 *
 * 校验 public/assets/content/ 下所有 JSON 文件：
 *   - 必填字段存在且类型正确
 *   - ID 唯一性
 *   - 跨引用完整性（eventCardIds → eventCards, eventId → events, prerequisites → martialArts）
 *   - Effect 结构合法性
 *   - Condition 表达式合法性
 *
 * 运行方式：
 *   npm run validate
 *   npx tsx tools/content_validate.ts
 */

import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, '../public/assets/content');

// ── Error collection ──────────────────────────────────────────────────────────

interface ValidationError {
  file: string;
  path: string;
  message: string;
}

const errors: ValidationError[] = [];
let currentFile = '';

function err(path: string, message: string): void {
  errors.push({ file: currentFile, path, message });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadJSON<T>(name: string): T {
  const p = join(CONTENT_DIR, name);
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T;
  } catch (e) {
    err('', `Cannot read/parse file: ${(e as Error).message}`);
    process.exit(1);
  }
}

type RawObj = Record<string, unknown>;

/** Check that obj[field] exists. Optionally verify its JS typeof. Returns true on success. */
function req(
  obj: RawObj,
  field: string,
  path: string,
  expectedType?: string,
): boolean {
  if (!(field in obj)) {
    err(`${path}.${field}`, 'Missing required field');
    return false;
  }
  if (expectedType !== undefined && typeof obj[field] !== expectedType) {
    err(`${path}.${field}`, `Expected ${expectedType}, got ${typeof obj[field]}`);
    return false;
  }
  return true;
}

// ── Condition validation ──────────────────────────────────────────────────────

const VALID_OPS = new Set(['gte', 'lte', 'eq', 'neq', 'gt', 'lt']);

function validateCondition(c: RawObj, path: string): void {
  req(c, 'field', path, 'string');
  req(c, 'op', path, 'string');
  if (!('value' in c)) err(`${path}.value`, 'Missing required field');
  if (c.op && !VALID_OPS.has(c.op as string)) {
    err(`${path}.op`, `Unknown op "${c.op}". Valid: ${[...VALID_OPS].join(', ')}`);
  }
}

function validateConditions(arr: unknown, path: string): void {
  if (!Array.isArray(arr)) { err(path, 'Expected array'); return; }
  (arr as RawObj[]).forEach((c, i) => validateCondition(c, `${path}[${i}]`));
}

// ── Effect validation ─────────────────────────────────────────────────────────

const KNOWN_EFFECT_TYPES = new Set([
  'currency_delta', 'inventory_delta', 'reputation_delta', 'alignment_delta',
  'morale_delta', 'faction_relation_delta',
  'disciple_status_add', 'disciple_status_remove',
  'disciple_recruit', 'disciple_dismiss', 'disciple_stat_delta',
  'disciple_assign_job', 'disciple_unassign_job', 'disciple_training_delta',
  'disciple_status_tick', 'set_recruit_pool',
  'building_place', 'building_upgrade', 'building_demolish',
  'martial_art_unlock', 'martial_art_assign', 'martial_art_unassign', 'martial_art_research_delta',
  'mission_dispatch', 'mission_tick', 'mission_event_resolve', 'mission_complete',
  'unlock', 'set_flag', 'if', 'roll',
]);

const CURRENCY_KEYS = new Set(['silver', 'reputation', 'inheritance', 'morale']);

function validateEffect(e: RawObj, path: string): void {
  if (!req(e, 'type', path, 'string')) return;
  const type = e.type as string;

  if (!KNOWN_EFFECT_TYPES.has(type)) {
    err(`${path}.type`, `Unknown effect type "${type}"`);
    return;
  }

  switch (type) {
    case 'currency_delta':
      req(e, 'key', path, 'string');
      req(e, 'delta', path, 'number');
      if (typeof e.key === 'string' && !CURRENCY_KEYS.has(e.key)) {
        err(`${path}.key`, `Invalid currency key "${e.key}". Valid: ${[...CURRENCY_KEYS].join(', ')}`);
      }
      break;

    case 'inventory_delta':
      req(e, 'key', path, 'string');
      req(e, 'delta', path, 'number');
      break;

    case 'reputation_delta':
    case 'alignment_delta':
    case 'morale_delta':
      req(e, 'delta', path, 'number');
      break;

    case 'faction_relation_delta':
      req(e, 'factionId', path, 'string');
      req(e, 'delta', path, 'number');
      break;

    case 'disciple_status_add':
      req(e, 'discipleId', path, 'string');
      req(e, 'statusId', path, 'string');
      req(e, 'durationMonths', path, 'number');
      break;

    case 'disciple_status_remove':
    case 'disciple_dismiss':
    case 'disciple_unassign_job':
      req(e, 'discipleId', path, 'string');
      break;

    case 'disciple_stat_delta':
      req(e, 'discipleId', path, 'string');
      req(e, 'statId', path, 'string');
      req(e, 'delta', path, 'number');
      break;

    case 'disciple_training_delta':
      req(e, 'discipleId', path, 'string');
      req(e, 'track', path, 'string');
      req(e, 'delta', path, 'number');
      break;

    case 'disciple_assign_job':
      req(e, 'discipleId', path, 'string');
      req(e, 'buildingInstanceId', path, 'string');
      req(e, 'slotIndex', path, 'number');
      break;

    case 'disciple_recruit':
      req(e, 'candidateId', path, 'string');
      req(e, 'name', path, 'string');
      req(e, 'stats', path);
      break;

    case 'set_flag':
      req(e, 'key', path, 'string');
      if (!('value' in e)) err(`${path}.value`, 'Missing required field');
      break;

    case 'unlock':
      req(e, 'target', path, 'string');
      break;

    case 'martial_art_unlock':
      req(e, 'artId', path, 'string');
      break;

    case 'martial_art_assign':
    case 'martial_art_unassign':
      req(e, 'discipleId', path, 'string');
      req(e, 'artId', path, 'string');
      break;

    case 'martial_art_research_delta':
      req(e, 'artId', path, 'string');
      req(e, 'delta', path, 'number');
      break;

    case 'if': {
      req(e, 'condition', path);
      req(e, 'then', path);
      if (e.condition && typeof e.condition === 'object') {
        validateCondition(e.condition as RawObj, `${path}.condition`);
      }
      validateEffectArray(e.then, `${path}.then`);
      if ('else' in e) validateEffectArray(e.else, `${path}.else`);
      break;
    }

    case 'roll': {
      req(e, 'chance', path, 'number');
      req(e, 'success', path);
      if (typeof e.chance === 'number' && (e.chance < 0 || e.chance > 1)) {
        err(`${path}.chance`, `chance must be in [0, 1], got ${e.chance}`);
      }
      validateEffectArray(e.success, `${path}.success`);
      if ('fail' in e) validateEffectArray(e.fail, `${path}.fail`);
      break;
    }
    // No-field effects
    case 'disciple_status_tick':
    case 'mission_tick':
    case 'building_upgrade':
    case 'building_demolish':
      break;

    case 'building_place':
      req(e, 'instanceId', path, 'string');
      req(e, 'defId', path, 'string');
      req(e, 'x', path, 'number');
      req(e, 'y', path, 'number');
      break;

    case 'mission_dispatch':
      req(e, 'missionId', path, 'string');
      req(e, 'templateId', path, 'string');
      req(e, 'partyDiscipleIds', path);
      req(e, 'durationMonths', path, 'number');
      break;

    case 'mission_event_resolve':
      req(e, 'missionId', path, 'string');
      req(e, 'eventCardId', path, 'string');
      req(e, 'success', path, 'boolean');
      break;

    case 'mission_complete':
      req(e, 'missionId', path, 'string');
      break;

    case 'set_recruit_pool':
      req(e, 'candidates', path);
      break;
  }
}

function validateEffectArray(arr: unknown, path: string): void {
  if (!Array.isArray(arr)) { err(path, 'Expected array of effects'); return; }
  (arr as RawObj[]).forEach((e, i) => validateEffect(e, `${path}[${i}]`));
}

// ── buildings.json ────────────────────────────────────────────────────────────

function validateBuildings(): void {
  currentFile = 'buildings.json';
  console.log(`  Checking ${currentFile}…`);
  const data = loadJSON<{ buildings: RawObj[] }>(currentFile);

  if (!Array.isArray(data.buildings)) { err('buildings', 'Expected array'); return; }

  const ids = new Set<string>();

  data.buildings.forEach((b, bi) => {
    const p = `buildings[${bi}]`;
    req(b, 'id', p, 'string');
    req(b, 'name', p, 'string');
    req(b, 'category', p, 'string');
    req(b, 'description', p, 'string');
    req(b, 'maxLevel', p, 'number');
    req(b, 'buildCost', p);
    req(b, 'levels', p);

    const id = b.id as string;
    if (id) {
      if (ids.has(id)) err(`${p}.id`, `Duplicate ID "${id}"`);
      ids.add(id);
    }

    if (!Array.isArray(b.levels)) return;
    const levels = b.levels as RawObj[];

    if (typeof b.maxLevel === 'number' && levels.length !== b.maxLevel) {
      err(`${p}.levels`, `maxLevel=${b.maxLevel} but levels array has ${levels.length} entries`);
    }

    levels.forEach((lv, li) => {
      const lp = `${p}.levels[${li}]`;
      req(lv, 'level', lp, 'number');
      req(lv, 'workSlots', lp, 'number');
      req(lv, 'effectsStatic', lp);
      req(lv, 'productionFlat', lp);
      req(lv, 'workerEffects', lp);
      req(lv, 'upkeep', lp);

      // level field must equal 1-based index
      if (typeof lv.level === 'number' && lv.level !== li + 1) {
        err(`${lp}.level`, `Expected ${li + 1}, got ${lv.level} (levels must be consecutive from 1)`);
      }

      validateEffectArray(lv.effectsStatic, `${lp}.effectsStatic`);
      validateEffectArray(lv.productionFlat, `${lp}.productionFlat`);
      validateEffectArray(lv.upkeep, `${lp}.upkeep`);

      // workerEffects have a distinct schema (not standard Effect)
      if (Array.isArray(lv.workerEffects)) {
        const VALID_WE_TYPES = new Set(['training', 'stat_delta']);
        (lv.workerEffects as RawObj[]).forEach((we, wi) => {
          const wp = `${lp}.workerEffects[${wi}]`;
          req(we, 'effectType', wp, 'string');
          req(we, 'delta', wp, 'number');
          if (typeof we.effectType === 'string' && !VALID_WE_TYPES.has(we.effectType)) {
            err(`${wp}.effectType`, `Unknown effectType "${we.effectType}". Valid: ${[...VALID_WE_TYPES].join(', ')}`);
          }
          if (we.effectType === 'training')   req(we, 'track', wp, 'string');
          if (we.effectType === 'stat_delta') req(we, 'statId', wp, 'string');
        });
      }
    });
  });
}

// ── missions.json ─────────────────────────────────────────────────────────────

function validateMissions(): void {
  currentFile = 'missions.json';
  console.log(`  Checking ${currentFile}…`);
  const data = loadJSON<{ templates: RawObj[]; eventCards: RawObj[] }>(currentFile);

  // Collect eventCard IDs first for cross-reference
  const cardIds = new Set<string>();
  if (Array.isArray(data.eventCards)) {
    data.eventCards.forEach((c, ci) => {
      const p = `eventCards[${ci}]`;
      req(c, 'id', p, 'string');
      req(c, 'name', p, 'string');
      req(c, 'description', p, 'string');
      req(c, 'baseSuccessRate', p, 'number');
      req(c, 'successEffects', p);
      req(c, 'failEffects', p);

      const id = c.id as string;
      if (id) {
        if (cardIds.has(id)) err(`${p}.id`, `Duplicate eventCard ID "${id}"`);
        cardIds.add(id);
      }

      if (typeof c.baseSuccessRate === 'number' && (c.baseSuccessRate < 0 || c.baseSuccessRate > 1)) {
        err(`${p}.baseSuccessRate`, `Must be in [0, 1], got ${c.baseSuccessRate}`);
      }

      validateEffectArray(c.successEffects, `${p}.successEffects`);
      validateEffectArray(c.failEffects, `${p}.failEffects`);
    });
  } else {
    err('eventCards', 'Missing or not an array');
  }

  if (!Array.isArray(data.templates)) { err('templates', 'Missing or not an array'); return; }

  const templateIds = new Set<string>();
  data.templates.forEach((t, ti) => {
    const p = `templates[${ti}]`;
    req(t, 'id', p, 'string');
    req(t, 'name', p, 'string');
    req(t, 'description', p, 'string');
    req(t, 'category', p, 'string');
    req(t, 'durationMonths', p, 'number');
    req(t, 'minPartySize', p, 'number');
    req(t, 'recommendedPower', p, 'number');
    req(t, 'rewards', p);
    req(t, 'failPenalty', p);
    req(t, 'eventCardIds', p);

    const id = t.id as string;
    if (id) {
      if (templateIds.has(id)) err(`${p}.id`, `Duplicate template ID "${id}"`);
      templateIds.add(id);
    }

    if (typeof t.durationMonths === 'number' && t.durationMonths < 1) {
      err(`${p}.durationMonths`, `Must be >= 1, got ${t.durationMonths}`);
    }
    if (typeof t.minPartySize === 'number' && t.minPartySize < 1) {
      err(`${p}.minPartySize`, `Must be >= 1, got ${t.minPartySize}`);
    }

    validateEffectArray(t.rewards, `${p}.rewards`);
    validateEffectArray(t.failPenalty, `${p}.failPenalty`);

    // T-B2: unlockCondition / completionFlag
    if ('unlockCondition' in t) {
      validateConditions(t.unlockCondition, `${p}.unlockCondition`);
    }
    if ('completionFlag' in t && typeof t.completionFlag !== 'string') {
      err(`${p}.completionFlag`, `Expected string, got ${typeof t.completionFlag}`);
    }

    if (Array.isArray(t.eventCardIds)) {
      (t.eventCardIds as string[]).forEach((cid, i) => {
        if (!cardIds.has(cid)) {
          err(`${p}.eventCardIds[${i}]`, `References unknown eventCard ID "${cid}"`);
        }
      });
      if ((t.eventCardIds as string[]).length === 0) {
        err(`${p}.eventCardIds`, 'Should have at least one event card (empty missions have no events)');
      }
    }
  });
}

// ── events.json ───────────────────────────────────────────────────────────────

function validateEvents(): void {
  currentFile = 'events.json';
  console.log(`  Checking ${currentFile}…`);
  const data = loadJSON<{ events: RawObj[]; annualChains?: RawObj[]; factionThresholdEvents?: RawObj[] }>(currentFile);

  const eventIds = new Set<string>();

  if (!Array.isArray(data.events)) { err('events', 'Missing or not an array'); return; }

  data.events.forEach((ev, ei) => {
    const p = `events[${ei}]`;
    req(ev, 'id', p, 'string');
    req(ev, 'name', p, 'string');
    req(ev, 'description', p, 'string');
    req(ev, 'weight', p, 'number');
    req(ev, 'cooldownMonths', p, 'number');
    req(ev, 'once', p, 'boolean');
    req(ev, 'options', p);

    const id = ev.id as string;
    if (id) {
      if (eventIds.has(id)) err(`${p}.id`, `Duplicate event ID "${id}"`);
      eventIds.add(id);
    }

    if (typeof ev.weight === 'number' && ev.weight < 0) {
      err(`${p}.weight`, `weight must be >= 0, got ${ev.weight}`);
    }
    if (typeof ev.cooldownMonths === 'number' && ev.cooldownMonths < 0) {
      err(`${p}.cooldownMonths`, `cooldownMonths must be >= 0, got ${ev.cooldownMonths}`);
    }

    if (Array.isArray(ev.conditions)) validateConditions(ev.conditions, `${p}.conditions`);

    if (Array.isArray(ev.options)) {
      if (ev.options.length === 0) {
        err(`${p}.options`, 'Event must have at least one option');
      }
      const optIds = new Set<string>();
      (ev.options as RawObj[]).forEach((opt, oi) => {
        const op = `${p}.options[${oi}]`;
        req(opt, 'id', op, 'string');
        req(opt, 'text', op, 'string');
        req(opt, 'effects', op);

        const optId = opt.id as string;
        if (optId) {
          if (optIds.has(optId)) err(`${op}.id`, `Duplicate option ID "${optId}"`);
          optIds.add(optId);
        }

        validateEffectArray(opt.effects, `${op}.effects`);

        if (opt.roll) {
          const roll = opt.roll as RawObj;
          const rp   = `${op}.roll`;
          req(roll, 'chance', rp, 'number');
          req(roll, 'successEffects', rp);
          req(roll, 'failEffects', rp);
          if (typeof roll.chance === 'number' && (roll.chance < 0 || roll.chance > 1)) {
            err(`${rp}.chance`, `Must be in [0, 1], got ${roll.chance}`);
          }
          validateEffectArray(roll.successEffects, `${rp}.successEffects`);
          validateEffectArray(roll.failEffects, `${rp}.failEffects`);
        }
      });
    }
  });

  // Annual chains
  if (Array.isArray(data.annualChains)) {
    const chainIds = new Set<string>();
    data.annualChains.forEach((chain, ci) => {
      const p = `annualChains[${ci}]`;
      req(chain, 'id', p, 'string');
      req(chain, 'name', p, 'string');
      req(chain, 'description', p, 'string');
      req(chain, 'triggerMonth', p, 'number');
      req(chain, 'stages', p);

      const id = chain.id as string;
      if (id) {
        if (chainIds.has(id)) err(`${p}.id`, `Duplicate annualChain ID "${id}"`);
        chainIds.add(id);
      }

      if (typeof chain.triggerMonth === 'number' && (chain.triggerMonth < 0 || chain.triggerMonth > 11)) {
        err(`${p}.triggerMonth`, `Must be in [0, 11] (0=Month1 … 11=Month12), got ${chain.triggerMonth}`);
      }

      if (Array.isArray(chain.stages)) {
        (chain.stages as RawObj[]).forEach((stage, si) => {
          const sp = `${p}.stages[${si}]`;
          req(stage, 'stageIndex', sp, 'number');
          req(stage, 'eventId', sp, 'string');

          if (typeof stage.eventId === 'string' && !eventIds.has(stage.eventId)) {
            err(`${sp}.eventId`, `References unknown event ID "${stage.eventId}"`);
          }
          if (typeof stage.stageIndex === 'number' && stage.stageIndex !== si) {
            err(`${sp}.stageIndex`, `Expected ${si}, got ${stage.stageIndex} (must be sequential from 0)`);
          }
          if (Array.isArray(stage.conditions)) validateConditions(stage.conditions, `${sp}.conditions`);
          // T-B1: stageFlag
          if ('stageFlag' in stage && typeof stage.stageFlag !== 'string') {
            err(`${sp}.stageFlag`, `Expected string, got ${typeof stage.stageFlag}`);
          }
        });
      }

      // T-B1: completionEffects / completionFlag
      if ('completionEffects' in chain) {
        validateEffectArray(chain.completionEffects, `${p}.completionEffects`);
      }
      if ('completionFlag' in chain && typeof chain.completionFlag !== 'string') {
        err(`${p}.completionFlag`, `Expected string, got ${typeof chain.completionFlag}`);
      }
    });
  }

  // T-B3: factionThresholdEvents
  const VALID_COMPARISONS = new Set(['gte', 'lte']);
  if (Array.isArray(data.factionThresholdEvents)) {
    data.factionThresholdEvents.forEach((def, di) => {
      const p = `factionThresholdEvents[${di}]`;
      req(def, 'factionId', p, 'string');
      req(def, 'threshold', p, 'number');
      req(def, 'comparison', p, 'string');
      req(def, 'eventId', p, 'string');
      req(def, 'cooldownMonths', p, 'number');

      if (typeof def.comparison === 'string' && !VALID_COMPARISONS.has(def.comparison)) {
        err(`${p}.comparison`, `Must be "gte" or "lte", got "${def.comparison}"`);
      }
      if (typeof def.eventId === 'string' && !eventIds.has(def.eventId)) {
        err(`${p}.eventId`, `References unknown event ID "${def.eventId}"`);
      }
      if (typeof def.cooldownMonths === 'number' && def.cooldownMonths < 0) {
        err(`${p}.cooldownMonths`, `Must be >= 0, got ${def.cooldownMonths}`);
      }
    });
  }
}

// ── martial_arts.json ─────────────────────────────────────────────────────────

function validateMartialArts(): void {
  currentFile = 'martial_arts.json';
  console.log(`  Checking ${currentFile}…`);
  const data = loadJSON<{ maxEquipSlots: number; categories: string[]; martialArts: RawObj[] }>(currentFile);

  const root = data as unknown as RawObj;
  req(root, 'maxEquipSlots', '', 'number');
  req(root, 'categories', '');
  req(root, 'martialArts', '');

  if (!Array.isArray(data.martialArts)) return;

  // Collect all IDs first for prerequisite cross-reference
  const artIds = new Set<string>();
  data.martialArts.forEach(a => { if (typeof a.id === 'string') artIds.add(a.id); });

  data.martialArts.forEach((a, ai) => {
    const p = `martialArts[${ai}]`;
    req(a, 'id', p, 'string');
    req(a, 'name', p, 'string');
    req(a, 'category', p, 'string');
    req(a, 'description', p, 'string');
    req(a, 'conflictGroup', p, 'string');
    req(a, 'researchCost', p, 'number');
    req(a, 'prerequisites', p);
    req(a, 'trainingBonus', p);
    req(a, 'power', p, 'number');

    if (typeof a.researchCost === 'number' && a.researchCost <= 0) {
      err(`${p}.researchCost`, `Must be > 0, got ${a.researchCost}`);
    }
    if (typeof a.power === 'number' && a.power < 0) {
      err(`${p}.power`, `Must be >= 0, got ${a.power}`);
    }

    if (typeof a.category === 'string' && Array.isArray(data.categories)) {
      if (!data.categories.includes(a.category)) {
        err(`${p}.category`, `Unknown category "${a.category}". Valid: ${data.categories.join(', ')}`);
      }
    }

    if (Array.isArray(a.prerequisites)) {
      (a.prerequisites as string[]).forEach((pid, pi) => {
        if (!artIds.has(pid)) {
          err(`${p}.prerequisites[${pi}]`, `References unknown art ID "${pid}"`);
        }
        if (pid === (a.id as string)) {
          err(`${p}.prerequisites[${pi}]`, 'Art cannot be its own prerequisite');
        }
      });
    }

    if (Array.isArray(a.trainingBonus)) {
      (a.trainingBonus as RawObj[]).forEach((b, bi) => {
        const bp = `${p}.trainingBonus[${bi}]`;
        req(b, 'track', bp, 'string');
        req(b, 'delta', bp, 'number');
        if (typeof b.delta === 'number' && b.delta === 0) {
          err(`${bp}.delta`, 'delta should not be 0 (it would have no effect)');
        }
      });
    }
  });
}

// ── disciples.json ────────────────────────────────────────────────────────────

function validateDisciples(): void {
  currentFile = 'disciples.json';
  console.log(`  Checking ${currentFile}…`);
  const data = loadJSON<RawObj>(currentFile);

  req(data, 'namePools', '', 'object');
  req(data, 'statDefs', '');
  req(data, 'recruitPool', '', 'object');
  req(data, 'maxDiscipleCount', '', 'number');

  if (data.namePools && typeof data.namePools === 'object') {
    const np = data.namePools as RawObj;
    req(np, 'surnames', 'namePools');
    req(np, 'givenNames', 'namePools');
    if (Array.isArray(np.surnames) && (np.surnames as unknown[]).length === 0) {
      err('namePools.surnames', 'Surnames list is empty');
    }
    if (Array.isArray(np.givenNames) && (np.givenNames as unknown[]).length === 0) {
      err('namePools.givenNames', 'Given-names list is empty');
    }
  }

  if (Array.isArray(data.statDefs)) {
    const statIds = new Set<string>();
    (data.statDefs as RawObj[]).forEach((s, si) => {
      const p = `statDefs[${si}]`;
      req(s, 'id', p, 'string');
      req(s, 'name', p, 'string');
      req(s, 'min', p, 'number');
      req(s, 'max', p, 'number');

      const id = s.id as string;
      if (id) {
        if (statIds.has(id)) err(`${p}.id`, `Duplicate stat ID "${id}"`);
        statIds.add(id);
      }
      if (typeof s.min === 'number' && typeof s.max === 'number' && s.min >= s.max) {
        err(p, `min (${s.min}) must be less than max (${s.max})`);
      }
    });
  } else {
    err('statDefs', 'Missing or not an array');
  }

  if (data.recruitPool && typeof data.recruitPool === 'object') {
    const rp = data.recruitPool as RawObj;
    req(rp, 'baseSize', 'recruitPool', 'number');
    req(rp, 'maxSize', 'recruitPool', 'number');
    if (typeof rp.baseSize === 'number' && typeof rp.maxSize === 'number' && rp.baseSize > rp.maxSize) {
      err('recruitPool', `baseSize (${rp.baseSize}) must be <= maxSize (${rp.maxSize})`);
    }
  }

  if (typeof data.maxDiscipleCount === 'number' && data.maxDiscipleCount < 1) {
    err('maxDiscipleCount', `Must be >= 1, got ${data.maxDiscipleCount}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('\n🔍 Content Validator — public/assets/content/\n');

validateBuildings();
validateMissions();
validateEvents();
validateMartialArts();
validateDisciples();

console.log('');

if (errors.length === 0) {
  console.log('✅  All content files valid — 0 errors found.\n');
  process.exit(0);
} else {
  const byFile: Record<string, ValidationError[]> = {};
  errors.forEach(e => {
    (byFile[e.file] ??= []).push(e);
  });

  for (const [file, errs] of Object.entries(byFile)) {
    console.log(`❌  ${file} — ${errs.length} error(s):`);
    errs.forEach(({ path, message }) => {
      const loc = path ? `    ${path}` : '    (root)';
      console.log(loc);
      console.log(`      → ${message}`);
    });
    console.log('');
  }

  console.log(`Total: ${errors.length} error(s) across ${Object.keys(byFile).length} file(s).\n`);
  process.exit(1);
}
