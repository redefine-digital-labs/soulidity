import { Container, Graphics, Text, TextStyle } from 'pixi.js';

export const SCROLL_W = 24;
export const SCROLL_H = 16;

const MOVE_SPEED = 200; // px/sec
const GLOW_FADE_RATE = 2; // alpha/sec
const SNAP_THRESHOLD = 2; // px

export class NewsScroll extends Container {
  articleId: string;
  isMoving = false;
  onArrived?: () => void;

  private glow: Graphics;
  private targetX: number | null = null;

  constructor(articleId: string, titleZh: string) {
    super();
    this.articleId = articleId;

    // --- Glow graphic: circle radius 16, hidden by default ---
    this.glow = new Graphics();
    this.glow.circle(0, SCROLL_H / 2, 16);
    this.glow.fill({ color: 0xffffaa, alpha: 1 });
    this.glow.alpha = 0;
    this.addChild(this.glow);

    // --- Scroll body: rounded rect ---
    const body = new Graphics();
    body.roundRect(0, 0, SCROLL_W, SCROLL_H, 3);
    body.fill(0xfff8dc);
    this.addChild(body);

    // --- Top roll ---
    const topRoll = new Graphics();
    topRoll.rect(0, 0, SCROLL_W, 3);
    topRoll.fill(0xe8d8a8);
    this.addChild(topRoll);

    // --- Bottom roll ---
    const bottomRoll = new Graphics();
    bottomRoll.rect(0, SCROLL_H - 3, SCROLL_W, 3);
    bottomRoll.fill(0xe8d8a8);
    this.addChild(bottomRoll);

    // --- Text lines (3 tiny dark lines to look like writing) ---
    const lines = new Graphics();
    for (let i = 0; i < 3; i++) {
      const ly = 5 + i * 3;
      lines.rect(4, ly, SCROLL_W - 8, 1);
    }
    lines.fill(0xbbaa88);
    this.addChild(lines);

    // --- Tiny title label: first 4 chars, positioned right of scroll ---
    const label = new Text({
      text: titleZh.slice(0, 4),
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 8,
        fill: 0x666666,
      }),
    });
    label.x = SCROLL_W + 2;
    label.y = (SCROLL_H - label.height) / 2;
    this.addChild(label);
  }

  /** Start moving toward targetX. Calls onArrived when reached. */
  moveTo(x: number, onArrived?: () => void): void {
    this.targetX = x;
    this.isMoving = true;
    this.onArrived = onArrived;
  }

  /** Flash the glow effect to full visibility. */
  flashGlow(): void {
    this.glow.alpha = 1;
  }

  /** Called each frame. delta is in seconds (Ticker v2 style) or fractional frames. */
  update(delta: number): void {
    // --- Move toward targetX ---
    if (this.targetX !== null && this.isMoving) {
      const dx = this.targetX - this.x;
      if (Math.abs(dx) < SNAP_THRESHOLD) {
        this.x = this.targetX;
        this.isMoving = false;
        this.targetX = null;
        this.onArrived?.();
      } else {
        const step = Math.sign(dx) * MOVE_SPEED * delta;
        // Don't overshoot
        if (Math.abs(step) > Math.abs(dx)) {
          this.x = this.targetX;
          this.isMoving = false;
          this.targetX = null;
          this.onArrived?.();
        } else {
          this.x += step;
        }
      }
    }

    // --- Fade glow ---
    if (this.glow.alpha > 0) {
      this.glow.alpha = Math.max(0, this.glow.alpha - delta * GLOW_FADE_RATE);
    }
  }
}
