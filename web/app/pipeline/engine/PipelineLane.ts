import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { RoleStation, ROLE_DEFS, type RoleAnimState } from './RoleStation'
import { LANE_START_X, LANE_END_X } from './NewsroomScene'
import type { ProcessLog } from '../store/pipeline-store'

/* ------------------------------------------------------------------ */
/*  Status → anim-state mapping                                        */
/* ------------------------------------------------------------------ */

const LOG_STATUS_TO_ANIM: Record<string, RoleAnimState> = {
  pending:   'idle',
  running:   'working',
  completed: 'done',
  failed:    'failed',
}

/* ------------------------------------------------------------------ */
/*  PipelineLane                                                       */
/* ------------------------------------------------------------------ */

export class PipelineLane extends Container {
  public readonly laneIndex: number
  public readonly stations: RoleStation[] = []
  public articleId: string | null = null

  private readonly trackW: number

  constructor(laneIndex: number) {
    super()
    this.laneIndex = laneIndex
    this.trackW = LANE_END_X - LANE_START_X

    const stationSpacing = this.trackW / 4

    // ----- Track: horizontal gray rail -----
    const track = new Graphics()
    track.rect(0, 40, this.trackW, 6)
    track.fill({ color: 0x555566 })
    this.addChild(track)

    // ----- Station dots: circles along the track -----
    const dots = new Graphics()
    for (let i = 0; i < 5; i++) {
      const cx = i * stationSpacing
      dots.circle(cx, 43, 5)
      dots.fill({ color: 0x666688 })
    }
    this.addChild(dots)

    // ----- Lane label -----
    const labelStyle = new TextStyle({
      fontFamily: '"Press Start 2P", monospace',
      fontSize: 8,
      fill: 0x888888,
    })
    const label = new Text({
      text: `LINE ${laneIndex + 1}`,
      style: labelStyle,
    })
    label.x = -60
    label.y = 34
    this.addChild(label)

    // ----- 5 RoleStations -----
    for (let i = 0; i < ROLE_DEFS.length; i++) {
      const def = ROLE_DEFS[i]
      const station = new RoleStation(def.name)
      station.x = i * stationSpacing - 32 // centred on station dot
      station.y = -50
      this.stations.push(station)
      this.addChild(station)
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Public helpers                                                   */
  /* ---------------------------------------------------------------- */

  /** Returns the x position (in lane-local coords) for a station by role index. */
  getStationX(roleIndex: number): number {
    const stationSpacing = this.trackW / 4
    return roleIndex * stationSpacing
  }

  /**
   * Map each station's visual state from the article's process logs.
   *   pending   → idle
   *   running   → working
   *   completed → done
   *   failed    → failed
   */
  syncFromArticle(processLogs: ProcessLog[]): void {
    const logMap = new Map(processLogs.map((l) => [l.role.name, l]))

    for (const station of this.stations) {
      const log = logMap.get(station.roleName)
      const status = log?.status ?? 'pending'
      const animState = LOG_STATUS_TO_ANIM[status] ?? 'idle'
      station.setState(animState)
    }
  }

  /** Reset lane to empty / idle state. */
  clear(): void {
    this.articleId = null
    for (const station of this.stations) {
      station.setState('idle')
    }
  }

  /** Per-frame update — delegates to all stations. `delta` in seconds. */
  update(delta: number): void {
    for (const station of this.stations) {
      station.update(delta)
    }
  }
}
