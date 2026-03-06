import { Container, Graphics, Text, TextStyle } from 'pixi.js';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type RoleAnimState = 'idle' | 'working' | 'done' | 'failed';

export interface RoleDef {
  name: string;
  label: string;
  color: number;
  deskColor: number;
}

export const ROLE_DEFS: readonly RoleDef[] = [
  { name: 'scout', label: 'SCOUT', color: 0x4a90d9, deskColor: 0x8b5e3c },
  { name: 'reporter', label: 'SCRIBE', color: 0xdce4f8, deskColor: 0x6b5a48 },
  { name: 'analyst', label: 'SEER', color: 0x6898c8, deskColor: 0x8a7560 },
  { name: 'editor', label: 'SMITH', color: 0x8a8e96, deskColor: 0x7a5835 },
  { name: 'publisher', label: 'HERALD', color: 0xe0b040, deskColor: 0xc89028 },
] as const;

export const STATION_W = 64;
export const STATION_H = 80;

// State → indicator colour mapping
const STATE_COLORS: Record<RoleAnimState, number> = {
  idle: 0x888888,
  working: 0xffcc00,
  done: 0x44ff44,
  failed: 0xff4444,
};

// ---------------------------------------------------------------------------
// RoleStation
// ---------------------------------------------------------------------------

export class RoleStation extends Container {
  public readonly roleName: string;

  // internal references
  private character: Container;
  private indicator: Graphics;
  private state: RoleAnimState = 'idle';

  // animation bookkeeping
  private elapsed = 0;
  /** timestamp (in elapsed-seconds) when state last changed */
  private stateStartTime = 0;
  /** baseline character Y before any animation offset */
  private characterBaseY: number;
  /** baseline character X before any animation offset */
  private characterBaseX: number;

  constructor(roleName: string) {
    super();
    this.roleName = roleName;

    const def = ROLE_DEFS.find((r) => r.name === roleName);
    const bodyColor = def?.color ?? 0xaaaaaa;
    const deskColor = def?.deskColor ?? 0x8b5e3c;
    const label = def?.label ?? roleName.toUpperCase();

    // ----- Desk (bottom portion of station) -----
    const desk = new Graphics();
    desk.roundRect(8, STATION_H - 20, STATION_W - 16, 16, 3);
    desk.fill({ color: deskColor });
    // Desk surface highlight
    desk.roundRect(10, STATION_H - 20, STATION_W - 20, 3, 1);
    desk.fill({ color: deskColor, alpha: 0.6 });
    this.addChild(desk);

    // ----- Character (pixel figure) -----
    this.character = new Container();

    // Head: 8×8 centered at station middle
    const head = new Graphics();
    head.rect(-4, 0, 8, 8);
    head.fill({ color: bodyColor });
    this.character.addChild(head);

    // Eyes: two 2×2 dark pixels
    const eyes = new Graphics();
    eyes.rect(-3, 2, 2, 2);
    eyes.fill({ color: 0x222222 });
    eyes.rect(1, 2, 2, 2);
    eyes.fill({ color: 0x222222 });
    this.character.addChild(eyes);

    // Body: 12×16 centered
    const body = new Graphics();
    body.rect(-6, 8, 12, 16);
    body.fill({ color: bodyColor });
    this.character.addChild(body);

    // Legs: two 4×8 blocks
    const legs = new Graphics();
    // Left leg
    legs.rect(-5, 24, 4, 8);
    legs.fill({ color: bodyColor, alpha: 0.85 });
    // Right leg
    legs.rect(1, 24, 4, 8);
    legs.fill({ color: bodyColor, alpha: 0.85 });
    this.character.addChild(legs);

    // Position character — centred horizontally, sitting above the desk
    this.character.x = STATION_W / 2;
    this.character.y = STATION_H - 20 - 32; // 32px tall figure, bottom at desk top
    this.characterBaseX = this.character.x;
    this.characterBaseY = this.character.y;
    this.addChild(this.character);

    // ----- Status indicator (coloured circle, top-right) -----
    this.indicator = new Graphics();
    this.drawIndicator(STATE_COLORS.idle);
    this.indicator.x = STATION_W - 10;
    this.indicator.y = 4;
    this.addChild(this.indicator);

    // ----- Name label -----
    const style = new TextStyle({
      fontFamily: '"Press Start 2P", monospace',
      fontSize: 7,
      fill: 0xffffff,
      align: 'center',
    });
    const nameLabel = new Text({ text: label, style });
    nameLabel.anchor.set(0.5, 0);
    nameLabel.x = STATION_W / 2;
    nameLabel.y = STATION_H - 2;
    this.addChild(nameLabel);
  }

  // -- Public API -----------------------------------------------------------

  setState(newState: RoleAnimState): void {
    if (newState === this.state) return;
    this.state = newState;
    this.stateStartTime = this.elapsed;
    this.drawIndicator(STATE_COLORS[newState]);

    // Reset character position when switching states
    this.character.x = this.characterBaseX;
    this.character.y = this.characterBaseY;
  }

  getState(): RoleAnimState {
    return this.state;
  }

  /**
   * Per-frame update.  `delta` is in **seconds** (Pixi v8 Ticker style).
   */
  update(delta: number): void {
    this.elapsed += delta;
    const t = this.elapsed;
    const dt = t - this.stateStartTime; // time since state change

    switch (this.state) {
      case 'idle': {
        // Gentle sine bob: amplitude 1.5 px, frequency 1.5 Hz
        this.character.y =
          this.characterBaseY + Math.sin(t * Math.PI * 2 * 1.5) * 1.5;
        this.character.x = this.characterBaseX;
        break;
      }

      case 'working': {
        // Faster bob (freq 6 Hz) + horizontal shake (freq 8 Hz)
        this.character.y =
          this.characterBaseY + Math.sin(t * Math.PI * 2 * 6) * 1.5;
        this.character.x =
          this.characterBaseX + Math.sin(t * Math.PI * 2 * 8) * 1.0;
        break;
      }

      case 'done': {
        if (dt < 0.5) {
          // Jump up: quick upward arc peaking at 0.25s
          const progress = dt / 0.5;
          const arc = Math.sin(progress * Math.PI); // 0 → 1 → 0
          this.character.y = this.characterBaseY - arc * 8;
        } else {
          // Settle back to gentle idle bob
          this.character.y =
            this.characterBaseY +
            Math.sin(t * Math.PI * 2 * 1.5) * 1.5;
        }
        this.character.x = this.characterBaseX;
        break;
      }

      case 'failed': {
        if (dt < 0.4) {
          // Horizontal shake, decaying
          const decay = 1 - dt / 0.4;
          this.character.x =
            this.characterBaseX +
            Math.sin(dt * Math.PI * 2 * 12) * 3 * decay;
          this.character.y = this.characterBaseY;
        } else {
          // Slump: shift down by 2 px
          this.character.x = this.characterBaseX;
          this.character.y = this.characterBaseY + 2;
        }
        break;
      }
    }
  }

  // -- Internals ------------------------------------------------------------

  private drawIndicator(color: number): void {
    this.indicator.clear();
    this.indicator.circle(0, 0, 4);
    this.indicator.fill({ color });
  }
}
