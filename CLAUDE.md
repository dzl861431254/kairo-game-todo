# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server (hot reload)
npm run build        # tsc + vite build → dist/
npm run test         # Run all smoke/regression tests (17 files, ~300+ assertions)
npm run validate     # Validate all public/assets/content/*.json
npm run simulate     # 10-year simulation → tools/output/10year_sim.json
```

Run a single test file:
```bash
npx tsx tests/smoke_engine.test.ts
npx tsx tests/smoke_events.test.ts
# etc.
```

Tests use Node's `assert/strict` — no test framework, just `npx tsx`. Tests are independent; run them in any order.

## Architecture Overview

Two distinct layers communicate only through `GameManager`:

### Runtime Layer (`src/runtime/`)
Pure TypeScript rules engine — **no Phaser dependency**. Testable in Node.

- **`TurnEngine`** (`turn_engine/engine_impl.ts`): Immutable monthly pipeline. Input: `GameState + ContentDB + PlayerOps`. Output: `{ nextState, report }`. Runs 10 fixed stages in order: `pre → building_passive → production → upkeep → training_research → mission_tick → mission_settlement → inner_event → visit_recruit → settlement_report`.
- **`EffectExecutor`** (`effect/executor_impl.ts`): **Only place that writes `GameState`**. All systems produce `Effect[]`; the executor applies them. Uses discriminated union `switch(effect.type)`.
- **`ConditionEvaluator`** (`condition/evaluator.ts`): Evaluates `Condition[]` against `GameState` for event triggers and mission unlock checks.
- **`ContentDB`** (`turn_engine/engine.ts`): Read-only content, loaded from JSON at boot and injected via `GameManager.loadContentDB()`. Never saved to localStorage.
- **Systems** (`runtime/systems/`): Each subsystem has `manager.ts` (pure logic), `validator.ts` (pre-checks), `types.ts`. Key subsystems: `building/`, `cultivation/`, `disciple/`, `event/`, `faction/`, `martial_art/`, `mission/`, `tournament/`, `mainline/`.

### Phaser Layer (`src/scenes/`, `src/game/`)
Rendering and input only. Communicates with Runtime via `GameManager`.

- **`GameManager`** (`game/GameManager.ts`): Singleton `Phaser.EventEmitter`. Holds Runtime `GameState` + `TurnEngine` instance. `endTurn()` calls `TurnEngine.executeTurn()`, then emits `stateChanged`. Stores last 12 settlement reports. Save/load uses `localStorage` key `kailuo_phaser_save` — serializes `GameState` only (not `ContentDB`).
- **`BootScene`**: Preloads all image assets + content JSONs; calls `GameManager.loadContentDB()` in `create()`.
- **`MainScene`**: 20×20 isometric grid (390×844px viewport), camera drag, NPC sprites, building ghosts, building highlight. Calls `gameManager.tickTime(delta)` each frame.
- **`UIScene`**: Resource bar, 5 tab panels (overview/build/disciples/missions/martial), scene nav buttons, speed controls. Listens to `GameManager` events: `stateChanged`, `timeChanged`, `toastError`, etc.
- **`SceneManager`** (`game/SceneManager.ts`): Virtual scene switching (`sect_gate`, `training_ground`, `jianghu_map`, `tournament_arena`) — changes bg color/grid visibility without switching Phaser scenes.
- **`TimeManager`** (`game/TimeManager.ts`): Real-time clock (10s = 1 game hour, 30 days/month). Speed: 0/1/2/4×. Month-end triggers `onMonthEnd` callback → `GameManager.endTurn()`.

## Key Invariants

1. **Only `EffectExecutor.apply()` writes `GameState`** — no system touches state directly.
2. **`TurnEngine.executeTurn()` is pure/immutable** — input state is never mutated; always returns new state.
3. **`ContentDB` is never saved** — always reloaded from JSON on boot; save/load only serializes `GameState`.
4. **Player queued operations flow as `PlayerOps`** — UI calls `GameManager.queueBuild/queueRecruit/etc.`, which accumulate into a `PlayerOps` object passed to `TurnEngine` at month-end.

## GameState Key Fields

```typescript
// Date
monthIndex: number       // 0-based; yearIndex = floor(monthIndex/12)

// Resources
resources: {
  silver, reputation, inheritance, morale, alignmentValue,
  inventories: { food, wood, stone, herbs, ... }
}

// Buildings
grid.placedBuildings: Record<string, PlacedBuilding>  // key = instance ID, use defId not templateId

// Disciples
disciples[].stats: Record<string, number>  // physique, comprehension, willpower, agility, charisma
disciples[].realm: RealmId                 // mortal → qi_sense → qi_gather → foundation → ...
disciples[].talentGrade: 'S'|'A'|'B'|'C'|'D'

// Progress tracking
flags: Record<string, number | boolean>
history: { triggeredEvents, annualChainProgress }
```

## Content JSON Authoring

All content JSONs live in `public/assets/content/`. After any edit, run `npm run validate` (zero errors required).

- IDs: `snake_case`, unique within type.
- Effect types: `currency_delta`, `inventory_delta`, `reputation_delta`, `alignment_delta`, `morale_delta`, `faction_relation_delta`, `disciple_status_add/remove`, `unlock`, `system_unlock`, `set_flag`, `roll`, `building_upgrade_start`, and cultivation/martial effects.
- Condition ops: `gte`, `lte`, `eq`, `neq`, `gt`, `lt`.
- See `docs/authoring_guide.md` for full schema reference.

## Test Fixtures

`tests/fixtures.ts` provides:
- `makeEmptyContentDB()` — minimal inline ContentDB for unit tests (no JSON loading)
- `makeInitialState(seed?)` — mirrors `GameManager.createInitialState()`; seed=42 by default
- `loadRealContentDB()` — loads actual JSON files from `public/assets/content/`

Integration tests that need real content use `loadRealContentDB()`; unit tests prefer `makeEmptyContentDB()`.

## TypeScript Strictness

`tsconfig.json` enforces: `strict`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (use `import type` for type-only imports), `moduleResolution: bundler`. All imports within `src/` use `.js` extension (bundler resolves to `.ts`). Tests are excluded from `tsconfig.json` — they run directly via `npx tsx`.
