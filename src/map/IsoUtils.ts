/**
 * 等距坐标转换工具
 *
 * 坐标系约定：
 *   格子坐标 (tileX, tileY)：整数，左上角为 (0,0)
 *   屏幕坐标 (screenX, screenY)：像素，相对于 Phaser 世界空间
 *
 * 等距投影公式：
 *   screenX = OFFSET_X + (tileX - tileY) * (TILE_W / 2)
 *   screenY = OFFSET_Y + (tileX + tileY) * (TILE_H / 2)
 *
 * 逆变换：
 *   tileX = floor((relX / (TILE_W/2) + relY / (TILE_H/2)) / 2)
 *   tileY = floor((relY / (TILE_H/2) - relX / (TILE_W/2)) / 2)
 */

export const TILE_WIDTH  = 64;  // 菱形格子宽度（水平轴跨度）
export const TILE_HEIGHT = 32;  // 菱形格子高度（垂直轴跨度）

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * 格子坐标 → 屏幕像素坐标（菱形中心顶点）
 */
export function tileToScreen(
  tileX: number,
  tileY: number,
  offsetX: number,
  offsetY: number,
): ScreenPoint {
  return {
    x: offsetX + (tileX - tileY) * (TILE_WIDTH / 2),
    y: offsetY + (tileX + tileY) * (TILE_HEIGHT / 2),
  };
}

/**
 * 屏幕像素坐标 → 格子坐标（向下取整，可能越界需调用方检查）
 */
export function screenToTile(
  screenX: number,
  screenY: number,
  offsetX: number,
  offsetY: number,
): { x: number; y: number } {
  const relX = screenX - offsetX;
  const relY = screenY - offsetY;
  return {
    x: Math.floor((relX / (TILE_WIDTH / 2) + relY / (TILE_HEIGHT / 2)) / 2),
    y: Math.floor((relY / (TILE_HEIGHT / 2) - relX / (TILE_WIDTH / 2)) / 2),
  };
}

/**
 * 返回格子菱形的四个顶点（顺时针：上→右→下→左），用于绘制轮廓
 */
export function tileDiamond(
  tileX: number,
  tileY: number,
  offsetX: number,
  offsetY: number,
): ScreenPoint[] {
  const top    = tileToScreen(tileX,     tileY,     offsetX, offsetY);
  const right  = tileToScreen(tileX + 1, tileY,     offsetX, offsetY);
  const bottom = tileToScreen(tileX + 1, tileY + 1, offsetX, offsetY);
  const left   = tileToScreen(tileX,     tileY + 1, offsetX, offsetY);
  return [top, right, bottom, left];
}

/**
 * 计算 N×N 等距地图居中于画布所需的 OFFSET_X / OFFSET_Y
 *
 * 地图原点在画布顶部中心（菱形尖端）
 *   offsetX = canvasWidth / 2
 *   offsetY = topPadding（给顶部 UI 留空）
 */
export function calcMapOffset(
  mapWidth: number,   // 格子列数
  mapHeight: number,  // 格子行数
  canvasWidth: number,
  topPadding: number,
): { offsetX: number; offsetY: number } {
  // 菱形原点（0,0）的顶顶点对齐水平中心
  const offsetX = canvasWidth / 2;
  // 向下偏移留出顶部 UI
  const offsetY = topPadding + (TILE_HEIGHT / 2);
  void mapWidth;
  void mapHeight;
  return { offsetX, offsetY };
}
