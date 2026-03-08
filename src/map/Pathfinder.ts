/**
 * A* 寻路 — 纯函数，无 Phaser 依赖
 *
 * 移动代价按地块类型区分，优先走道路（代价=1），其次石地（代价=2），
 * 普通草地代价较高（5），水/山/树不可通行（Infinity）。
 * 启发函数使用曼哈顿距离，保证最优性。
 */

import type { TileData, TileType } from '../runtime/turn_engine/types.js';

// ── 移动代价表 ──

const TILE_COST: Record<TileType, number> = {
  road:     1,
  stone:    2,
  grass:    5,
  water:    Infinity,
  mountain: Infinity,
  tree:     Infinity,
};

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy:  0 },
  { dx: 0, dy:  1 },
  { dx: -1, dy: 0 },
] as const;

// ── MinHeap（最小优先队列） ──

interface HeapNode {
  f: number;   // fScore = gScore + h
  flat: number; // 格子平坦索引
}

class MinHeap {
  private readonly heap: HeapNode[] = [];

  get size(): number { return this.heap.length; }

  push(node: HeapNode): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent]!.f <= this.heap[i]!.f) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i]!, this.heap[parent]!];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l]!.f < this.heap[smallest]!.f) smallest = l;
      if (r < n && this.heap[r]!.f < this.heap[smallest]!.f) smallest = r;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i]!, this.heap[smallest]!];
      i = smallest;
    }
  }
}

// ── A* 主函数 ──

/**
 * 在 TileData[][] 地图上用 A* 算法，返回从 from 到 to 的路径（不含起点，含终点）。
 * - 返回空数组 = 不可达 或 from === to
 * - 目标格即使 !walkable（如建筑格）也允许进入（NPC 需要走进建筑）
 */
export function findPath(
  tiles: TileData[][],
  from: { x: number; y: number },
  to:   { x: number; y: number },
): Array<{ x: number; y: number }> {
  const rows = tiles.length;
  const cols = rows > 0 ? (tiles[0]?.length ?? 0) : 0;

  if (from.x === to.x && from.y === to.y) return [];

  const flat = (x: number, y: number) => y * cols + x;
  const h    = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);

  const startKey = flat(from.x, from.y);
  const goalKey  = flat(to.x, to.y);

  // gScore: 从起点到该格的实际代价
  const gScore = new Map<number, number>();
  gScore.set(startKey, 0);

  // parent map 用于路径回溯
  const parent = new Map<number, number>();
  parent.set(startKey, -1);

  const open = new MinHeap();
  open.push({ f: h(from.x, from.y), flat: startKey });

  // 已确认最优的节点集合
  const closed = new Set<number>();

  while (open.size > 0) {
    const { flat: curFlat } = open.pop()!;
    if (closed.has(curFlat)) continue;
    closed.add(curFlat);

    if (curFlat === goalKey) break;

    const cx = curFlat % cols;
    const cy = Math.floor(curFlat / cols);
    const curG = gScore.get(curFlat) ?? Infinity;

    for (const { dx, dy } of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

      const nFlat = flat(nx, ny);
      if (closed.has(nFlat)) continue;

      const tile = tiles[ny]?.[nx];
      if (!tile) continue;

      const isTarget = nFlat === goalKey;
      // 目标格即使不可行走也允许进入（走进建筑内部）
      if (!tile.walkable && !isTarget) continue;

      const tileCost = isTarget ? 1 : (TILE_COST[tile.type] ?? 5);
      if (tileCost === Infinity) continue;

      const tentativeG = curG + tileCost;
      if (tentativeG < (gScore.get(nFlat) ?? Infinity)) {
        gScore.set(nFlat, tentativeG);
        parent.set(nFlat, curFlat);
        open.push({ f: tentativeG + h(nx, ny), flat: nFlat });
      }
    }
  }

  if (!parent.has(goalKey) || parent.get(goalKey) === undefined) return [];
  // 确认终点可达（起点无父节点的情况已由 from===to 提前返回排除）
  if (!gScore.has(goalKey)) return [];

  // 从终点沿 parent 链回溯，重建路径
  const path: Array<{ x: number; y: number }> = [];
  let k = goalKey;
  while (k !== startKey) {
    path.unshift({ x: k % cols, y: Math.floor(k / cols) });
    const p = parent.get(k);
    if (p === undefined) return []; // 防御性检查
    k = p;
  }
  return path;
}
