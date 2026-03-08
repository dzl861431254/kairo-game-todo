import Phaser from 'phaser';

const MAX_QUEUE = 3;    // drop excess messages beyond this
const IN_MS     = 180;  // fade-in + slide-in duration
const HOLD_MS   = 2400; // how long the toast stays visible
const OUT_MS    = 300;  // fade-out duration

type Level = 'error' | 'warn' | 'success';

interface ToastItem { msg: string; level: Level }

/**
 * Lightweight queued toast for UIScene.
 *
 * Usage:
 *   const toast = new Toast(this);
 *   toast.show('银两不足');          // red
 *   toast.show('已加入队列', 'warn'); // amber
 */
export class Toast {
  private readonly scene: Phaser.Scene;
  private readonly queue: ToastItem[] = [];
  private active = false;

  // Layout constants — placed just below the resource bar
  private readonly CX = 195;
  private readonly CY = 87;
  private readonly W  = 340;
  private readonly H  = 36;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(msg: string, level: Level = 'error'): void {
    if (this.queue.length >= MAX_QUEUE) return; // drop overflow
    this.queue.push({ msg, level });
    if (!this.active) this.next();
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) { this.active = false; return; }
    this.active = true;

    const { msg, level } = item;
    const bgColor = level === 'error' ? 0xaa2222 : level === 'warn' ? 0x996600 : 0x227722;

    // Create objects at start-y (CY - 10) so tween slides them down
    const bg = this.scene.add
      .rectangle(this.CX, this.CY - 10, this.W, this.H, bgColor, 0.93)
      .setStrokeStyle(1, 0xffffff, 0.3)
      .setDepth(200)
      .setAlpha(0);

    const text = this.scene.add
      .text(this.CX, this.CY - 10, msg, {
        font: 'bold 12px Arial',
        color: '#ffffff',
        wordWrap: { width: this.W - 20 },
      })
      .setOrigin(0.5)
      .setDepth(201)
      .setAlpha(0);

    // Slide in + fade in
    this.scene.tweens.add({
      targets: [bg, text],
      alpha:   1,
      y:       this.CY,
      duration: IN_MS,
      ease:    'Quad.Out',
      onComplete: () => {
        // Hold, then fade out
        this.scene.time.delayedCall(HOLD_MS, () => {
          this.scene.tweens.add({
            targets:  [bg, text],
            alpha:    0,
            duration: OUT_MS,
            ease:     'Quad.In',
            onComplete: () => {
              bg.destroy();
              text.destroy();
              this.next();
            },
          });
        });
      },
    });
  }
}
