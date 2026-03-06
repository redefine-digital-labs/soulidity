import { Container, Graphics } from 'pixi.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParticleConfig {
  colors: number[]
  sizeMin: number
  sizeMax: number
  spreadX: number
  spreadY: number
  speedMin: number
  speedMax: number
  angleMin: number
  angleMax: number
  lifeMin: number
  lifeMax: number
  spawnInterval: number
  maxCount: number
}

interface Particle {
  graphic: Graphics
  vx: number
  vy: number
  life: number
  maxLife: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UP = -Math.PI / 2

const PARTICLE_CONFIGS: Record<string, ParticleConfig> = {
  scout: {
    colors: [0x4a90d9, 0xa8d4ff, 0x6bb3f0],
    sizeMin: 1,
    sizeMax: 3,
    spreadX: 20,
    spreadY: 10,
    speedMin: 20,
    speedMax: 50,
    angleMin: UP - 0.5,
    angleMax: UP + 0.5,
    lifeMin: 0.3,
    lifeMax: 0.8,
    spawnInterval: 0.08,
    maxCount: 15,
  },
  reporter: {
    colors: [0x2a3a6a, 0x1a2a50, 0x3a4a7a],
    sizeMin: 1,
    sizeMax: 4,
    spreadX: 16,
    spreadY: 8,
    speedMin: 30,
    speedMax: 80,
    angleMin: UP - 1.0,
    angleMax: UP + 1.0,
    lifeMin: 0.2,
    lifeMax: 0.6,
    spawnInterval: 0.06,
    maxCount: 20,
  },
  analyst: {
    colors: [0xc0e0ff, 0xd8f0ff, 0x88b8e8, 0xe8f4ff],
    sizeMin: 1,
    sizeMax: 2,
    spreadX: 24,
    spreadY: 24,
    speedMin: 10,
    speedMax: 30,
    angleMin: 0,
    angleMax: Math.PI * 2,
    lifeMin: 0.5,
    lifeMax: 1.2,
    spawnInterval: 0.1,
    maxCount: 20,
  },
  editor: {
    colors: [0xffd54a, 0xffb830, 0xffe080, 0xffcc40],
    sizeMin: 1,
    sizeMax: 3,
    spreadX: 12,
    spreadY: 8,
    speedMin: 40,
    speedMax: 100,
    angleMin: UP - 0.8,
    angleMax: UP + 0.8,
    lifeMin: 0.15,
    lifeMax: 0.5,
    spawnInterval: 0.05,
    maxCount: 25,
  },
  publisher: {
    colors: [0xffe080, 0xffd060, 0xffe880],
    sizeMin: 2,
    sizeMax: 3,
    spreadX: 30,
    spreadY: 10,
    speedMin: 15,
    speedMax: 40,
    angleMin: UP - 0.3,
    angleMax: UP + 0.3,
    lifeMin: 0.6,
    lifeMax: 1.0,
    spawnInterval: 0.12,
    maxCount: 12,
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Random float in [min, max] */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Pick a random element from an array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// RoleParticles
// ---------------------------------------------------------------------------

export class RoleParticles extends Container {
  private config: ParticleConfig
  private particles: Particle[] = []
  private active = false
  private spawnTimer = 0

  constructor(roleName: string) {
    super()
    const cfg = PARTICLE_CONFIGS[roleName]
    if (!cfg) {
      throw new Error(`[RoleParticles] Unknown role: "${roleName}"`)
    }
    this.config = cfg
  }

  /** Activate particle spawning. */
  start(): void {
    this.active = true
    this.spawnTimer = 0
  }

  /** Deactivate spawning (existing particles continue until they die). */
  stop(): void {
    this.active = false
  }

  /** Stop spawning and destroy all living particles immediately. */
  clear(): void {
    this.stop()
    for (const p of this.particles) {
      p.graphic.destroy()
    }
    this.particles = []
  }

  /** Per-frame update. `delta` is in seconds. */
  update(delta: number): void {
    const cfg = this.config

    // --- Spawn ---
    if (this.active) {
      this.spawnTimer += delta
      while (
        this.spawnTimer >= cfg.spawnInterval &&
        this.particles.length < cfg.maxCount
      ) {
        this.spawnTimer -= cfg.spawnInterval
        this.spawnParticle()
      }
      // If at max count, just reset the timer so it doesn't accumulate
      if (this.particles.length >= cfg.maxCount) {
        this.spawnTimer = 0
      }
    }

    // --- Update living particles ---
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= delta

      if (p.life <= 0) {
        p.graphic.destroy()
        this.particles.splice(i, 1)
        continue
      }

      // Move
      p.graphic.x += p.vx * delta
      p.graphic.y += p.vy * delta

      // Fade based on remaining life
      p.graphic.alpha = p.life / p.maxLife
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private spawnParticle(): void {
    const cfg = this.config

    const size = rand(cfg.sizeMin, cfg.sizeMax)
    const color = pick(cfg.colors)
    const angle = rand(cfg.angleMin, cfg.angleMax)
    const speed = rand(cfg.speedMin, cfg.speedMax)
    const life = rand(cfg.lifeMin, cfg.lifeMax)

    const g = new Graphics()
    g.rect(0, 0, size, size)
    g.fill(color)

    g.x = rand(-cfg.spreadX / 2, cfg.spreadX / 2)
    g.y = rand(-cfg.spreadY / 2, cfg.spreadY / 2)

    this.addChild(g)

    this.particles.push({
      graphic: g,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
    })
  }
}
