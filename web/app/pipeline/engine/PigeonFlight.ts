import { Container, Graphics } from 'pixi.js'

// TODO: Import from NewsroomScene once constants are exported there
// import { WINDOW_X, WINDOW_Y, WINDOW_W, WINDOW_H } from './NewsroomScene'
const WINDOW_X = 700
const WINDOW_Y = 40
const WINDOW_W = 80
const WINDOW_H = 60

/** A trail particle: tiny yellow rect that fades and shrinks. */
interface TrailParticle {
  gfx: Graphics
  alpha: number
}

/**
 * When a news article completes all pipeline stages the scroll transforms
 * into a pixel pigeon that flies toward the newsroom window along a
 * parabolic arc, leaving a star trail behind it.
 */
export class PigeonFlight extends Container {
  isComplete = false
  onComplete?: () => void

  private readonly targetX: number
  private readonly targetY: number
  private readonly startX: number
  private readonly startY: number
  private readonly duration = 1.5 // seconds

  private progress = 0
  private trailTimer = 0

  private readonly pigeon: Container
  private readonly wing: Graphics
  private readonly trail: TrailParticle[] = []

  constructor(startX: number, startY: number) {
    super()

    this.startX = startX
    this.startY = startY
    this.targetX = WINDOW_X + WINDOW_W / 2
    this.targetY = WINDOW_Y + WINDOW_H / 2

    // --- Build pixel pigeon ---
    this.pigeon = new Container()

    // Body: 10x6
    const body = new Graphics()
    body.rect(0, 0, 10, 6).fill(0xdddddd)
    this.pigeon.addChild(body)

    // Head: 4x4 (to the right of the body)
    const head = new Graphics()
    head.rect(10, -1, 4, 4).fill(0xcccccc)
    this.pigeon.addChild(head)

    // Eye: 1x1
    const eye = new Graphics()
    eye.rect(12, 0, 1, 1).fill(0x111111)
    this.pigeon.addChild(eye)

    // Beak: 2x1
    const beak = new Graphics()
    beak.rect(14, 1, 2, 1).fill(0xffaa00)
    this.pigeon.addChild(beak)

    // Wing: 6x3 (on top of the body, will flap)
    this.wing = new Graphics()
    this.wing.rect(2, -3, 6, 3).fill(0xeeeeee)
    this.pigeon.addChild(this.wing)

    // Tail: 3x3 (behind the body)
    const tail = new Graphics()
    tail.rect(-3, 0, 3, 3).fill(0xbbbbbb)
    this.pigeon.addChild(tail)

    this.pigeon.x = startX
    this.pigeon.y = startY
    this.addChild(this.pigeon)
  }

  update(delta: number): void {
    if (this.isComplete) return

    // Advance progress (delta is in seconds)
    this.progress += delta / this.duration

    if (this.progress >= 1) {
      this.progress = 1
      this.isComplete = true
      this.onComplete?.()
      return
    }

    const t = this.progress

    // Eased position: quadratic ease-in (t*t)
    const eased = t * t

    // Linear interpolation with easing
    const linearX = this.startX + (this.targetX - this.startX) * eased
    const linearY = this.startY + (this.targetY - this.startY) * eased

    // Arc path: parabolic arc offset (peaks at midpoint)
    const arcHeight = -120
    const arcOffset = arcHeight * 4 * t * (1 - t)

    // Wing flap: sin wave on y (frequency 12*PI)
    const wingFlap = Math.sin(12 * Math.PI * t)

    this.pigeon.x = linearX
    this.pigeon.y = linearY + arcOffset
    this.wing.y = wingFlap * 2 // flap amplitude

    // --- Star trail ---
    this.trailTimer += delta
    if (this.trailTimer >= 0.05) {
      this.trailTimer -= 0.05
      this.spawnTrailParticle()
    }

    // Update existing trail particles
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i]
      p.alpha -= delta * 2
      p.gfx.alpha = Math.max(0, p.alpha)
      p.gfx.scale.set(p.gfx.scale.x * (1 - delta * 2))

      if (p.alpha <= 0) {
        this.removeChild(p.gfx)
        p.gfx.destroy()
        this.trail.splice(i, 1)
      }
    }
  }

  private spawnTrailParticle(): void {
    const size = 1 + Math.random() * 2 // 1-3px
    const gfx = new Graphics()
    gfx.rect(0, 0, size, size).fill(0xffdd44) // yellow

    // Spawn at pigeon position with small random offset
    gfx.x = this.pigeon.x + (Math.random() - 0.5) * 8
    gfx.y = this.pigeon.y + (Math.random() - 0.5) * 8

    const particle: TrailParticle = { gfx, alpha: 1 }
    this.trail.push(particle)
    this.addChild(gfx)
  }
}
