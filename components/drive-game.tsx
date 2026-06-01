"use client"

import { useEffect, useRef, useState, useCallback } from "react"

const COLORS = {
  darkest: "#0a0a1a",
  dark: "#1a1a3a",
  mid: "#3a3a6a",
  light: "#ff2d95",
  lightest: "#00d4ff",
  accent: "#ff6b9d",
  glow: "#ff2d95",
  projectorBeam: "#00d4ff",
  white: "#ffffff",
  driveInput: "#00ff66",
}

const CW = 360
const CH = 640

const LEVEL_GAPS = [80, 62, 46, 38, 32]
const DRIVE_W = 14
const DRIVE_H = 10
const SHELF_H = 18
const HUD_H = 28
const BTN_H = 68
const GAME_H = CH - HUD_H - BTN_H
const ARROW_SPEED_BASE = 3.0
const THROW_SPEED = 5.5

interface Shelf {
  y: number
  gapLeft: number
  gapRight: number
  side: "left" | "right"
  projecting?: boolean   // beam currently animating
  delivered?: boolean    // permanently lit after delivery
}

// Pre-generate city buildings once so they don't flicker
interface Building {
  x: number
  w: number
  h: number
  windows: { wx: number; wy: number; lit: boolean }[]
}

function generateBuildings(): Building[] {
  const cityY = CH - BTN_H
  const buildings: Building[] = []
  for (let x = 0; x < CW; x += 25) {
    const h = 15 + Math.floor(Math.random() * 20)
    const windows: { wx: number; wy: number; lit: boolean }[] = []
    for (let wy = cityY - h + 18; wy < cityY + 10; wy += 6) {
      for (let wx = x + 3; wx < x + 17; wx += 5) {
        windows.push({ wx, wy, lit: Math.random() > 0.3 })
      }
    }
    buildings.push({ x, w: 20, h, windows })
  }
  return buildings
}

export default function DriveGame() {
  const shellRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instrCanvasRef = useRef<HTMLCanvasElement>(null)
  const [screen, setScreen] = useState<"home" | "instructions" | "game">("home")

  // Pre-generated static city buildings
  const buildingsRef = useRef<Building[]>(generateBuildings())

  const gameState = useRef({
    level: 0,
    state: "idle" as
      | "idle"
      | "throwing"
      | "arcing"
      | "falling"
      | "projecting"
      | "miss"
      | "gameover",
    arrowX: 0,
    arrowDir: 1,
    arrowSpeed: ARROW_SPEED_BASE,
    driveX: 0,
    driveY: 0,
    driveVX: 0,
    driveVY: 0,
    arcProgress: 0,
    arcStartX: 0,
    arcStartY: 0,
    arcEndX: 0,
    arcEndY: 0,
    flashTimer: 0,
    missArrowX: -1,
    totalDeliveries: 0,
    extraMode: false,
    projectTimer: 0,
    shelves: [] as Shelf[],
    characterThrowFrame: 0,
  })

  const scaleShell = useCallback(() => {
    const shell = shellRef.current
    if (!shell) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const scale = Math.min(vw / CW, vh / CH)
    const scaledW = CW * scale
    const scaledH = CH * scale
    const offsetX = Math.round((vw - scaledW) / 2)
    const offsetY = Math.round((vh - scaledH) / 2)
    shell.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
  }, [])

  useEffect(() => {
    scaleShell()
    window.addEventListener("resize", scaleShell)
    return () => window.removeEventListener("resize", scaleShell)
  }, [scaleShell])

  const buildLayout = useCallback((extra: boolean) => {
    const shelves: Shelf[] = []
    const slotH = GAME_H / 5
    for (let i = 0; i < 5; i++) {
      const shelfY = Math.round(HUD_H + slotH * (i + 1) - SHELF_H)
      const gw = extra ? LEVEL_GAPS[4] : LEVEL_GAPS[i]
      const parity = extra ? (i % 2 === 0 ? "right" : "left") : i % 2 === 0 ? "left" : "right"
      const side = parity as "left" | "right"
      let gapLeft: number
      if (extra) {
        const minX = Math.round(CW * 0.2)
        const maxX = Math.round(CW * 0.8) - gw
        gapLeft = minX + Math.floor(Math.random() * Math.max(1, maxX - minX))
      } else if (i === 4) {
        gapLeft = side === "left" ? Math.round(CW * 0.7) - gw : Math.round(CW * 0.3)
      } else {
        gapLeft = side === "left" ? CW - gw - 26 : 26
      }
      shelves.push({ y: shelfY, gapLeft, gapRight: gapLeft + gw, side, projecting: false, delivered: false })
    }
    gameState.current.shelves = shelves
  }, [])

  const initArrow = useCallback((lv: number) => {
    const gs = gameState.current
    const s = gs.shelves[lv]
    gs.arrowX = gs.driveX
    gs.arrowDir = s.side === "left" ? 1 : -1
    gs.arrowSpeed = ARROW_SPEED_BASE + (gs.extraMode ? 4 : lv) * 0.9
  }, [])

  const initLevel = useCallback(
    (lv: number, keepTotal: boolean) => {
      const gs = gameState.current
      gs.level = lv
      gs.state = "idle"
      gs.characterThrowFrame = 0
      gs.flashTimer = 0
      gs.missArrowX = -1
      gs.driveVX = 0
      gs.driveVY = 0
      gs.arcProgress = 0
      gs.projectTimer = 0
      if (!keepTotal) {
        gs.totalDeliveries = 0
        gs.extraMode = false
        // Full reset — clear all delivery/projecting state
        gs.shelves.forEach((shelf) => {
          shelf.projecting = false
          shelf.delivered = false
        })
      }
      const s = gs.shelves[lv]
      gs.driveX = s.side === "left" ? 40 : CW - 40
      gs.driveY = s.y - DRIVE_H
      initArrow(lv)
    },
    [initArrow]
  )

  const startGame = useCallback(() => {
    setScreen("game")
    buildLayout(false)
    initLevel(0, false)
  }, [buildLayout, initLevel])

  const onThrow = useCallback(() => {
    const gs = gameState.current
    if (gs.state !== "idle") return
    const s = gs.shelves[gs.level]
    const inGap = gs.arrowX >= s.gapLeft && gs.arrowX <= s.gapRight
    gs.characterThrowFrame = 1

    if (inGap) {
      gs.state = "arcing"
      gs.arcProgress = 0
      gs.arcStartX = gs.driveX
      gs.arcStartY = gs.driveY
      gs.arcEndX = (s.gapLeft + s.gapRight) / 2
      gs.arcEndY = s.y - DRIVE_H / 2
      gs.missArrowX = -1
    } else {
      gs.state = "miss"
      gs.flashTimer = 80
      gs.missArrowX = gs.arrowX
      gs.driveVX = s.side === "left" ? THROW_SPEED * 0.3 : -THROW_SPEED * 0.3
    }
  }, [])

  const doRetry = useCallback(() => {
    buildLayout(false)
    initLevel(0, false)
    buildingsRef.current = generateBuildings()
  }, [buildLayout, initLevel])

  // Instruction screen
  useEffect(() => {
    if (screen !== "instructions") return
    const c = instrCanvasRef.current
    if (!c) return
    const x = c.getContext("2d")
    if (!x) return

    x.fillStyle = COLORS.darkest
    x.fillRect(0, 0, CW, CH)

    x.fillStyle = COLORS.dark
    x.fillRect(20, 40, 320, 56)
    x.strokeStyle = COLORS.light
    x.lineWidth = 3
    x.strokeRect(20, 40, 320, 56)
    x.fillStyle = COLORS.lightest
    x.font = '14px "Press Start 2P", monospace'
    x.textAlign = "center"
    x.fillText("HOW TO PLAY", CW / 2, 76)

    x.fillStyle = COLORS.darkest
    x.fillRect(20, 130, 320, 280)
    x.strokeStyle = COLORS.dark
    x.lineWidth = 2
    x.strokeRect(20, 130, 320, 280)

    x.fillStyle = COLORS.light
    x.beginPath()
    x.moveTo(CW / 2, 168)
    x.lineTo(CW / 2 - 14, 148)
    x.lineTo(CW / 2 + 14, 148)
    x.closePath()
    x.fill()
    x.fillStyle = COLORS.lightest
    x.font = '7px "Press Start 2P", monospace'
    x.fillText("AN ARROW SWEEPS", CW / 2, 190)
    x.fillText("BACK AND FORTH", CW / 2, 204)

    x.strokeStyle = COLORS.dark
    x.lineWidth = 1
    x.beginPath(); x.moveTo(40, 218); x.lineTo(320, 218); x.stroke()

    x.fillStyle = COLORS.lightest
    x.fillRect(CW / 2 - 20, 228, 40, 12)
    x.fillStyle = "#00ff66"
    x.fillRect(CW / 2 - 18, 226, 36, 4)
    x.fillStyle = "#00ff66"
    x.font = '5px "Press Start 2P", monospace'
    x.fillText("DRIVE INPUT", CW / 2, 224)
    x.fillStyle = COLORS.lightest
    x.font = '7px "Press Start 2P", monospace'
    x.fillText("STOP THE ARROW", CW / 2, 256)
    x.fillText("OVER THE GREEN SLOT", CW / 2, 270)

    x.beginPath(); x.moveTo(40, 284); x.lineTo(320, 284); x.stroke()

    x.fillStyle = COLORS.mid
    x.fillRect(CW / 2 - 10, 294, 20, 14)
    x.fillStyle = COLORS.lightest
    x.fillRect(CW / 2 - 8, 296, 6, 4)
    x.fillStyle = COLORS.lightest
    x.font = '7px "Press Start 2P", monospace'
    x.fillText("CLICK THROW / SPACE", CW / 2, 326)
    x.fillText("TO THROW DRIVE", CW / 2, 340)

    x.beginPath(); x.moveTo(40, 354); x.lineTo(320, 354); x.stroke()

    x.fillStyle = COLORS.light
    x.font = '7px "Press Start 2P", monospace'
    x.fillText("THROW THE HARD DRIVE", CW / 2, 376)
    x.fillText("INTO THE DRIVE INPUT", CW / 2, 390)
    x.fillText("TO ADVANCE!", CW / 2, 404)

    x.fillStyle = COLORS.lightest
    x.font = '8px "Press Start 2P", monospace'
    x.fillText("TAP / CLICK TO START", CW / 2, 480)

    x.fillStyle = COLORS.light
    x.fillRect(CW / 2 - 12, 496, 6, 6)
    x.fillRect(CW / 2 - 3, 496, 6, 6)
    x.fillRect(CW / 2 + 6, 496, 6, 6)

    x.strokeStyle = COLORS.light
    x.lineWidth = 4
    x.strokeRect(4, 4, CW - 8, CH - 8)
    x.strokeStyle = COLORS.dark
    x.lineWidth = 2
    x.strokeRect(10, 10, CW - 20, CH - 20)
  }, [screen])

  // Main game loop
  useEffect(() => {
    if (screen !== "game") return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.width = CW
    canvas.height = CH
    ctx.imageSmoothingEnabled = false

    let animationId: number

    const update = () => {
      const gs = gameState.current

      if (gs.state === "idle") {
        const s = gs.shelves[gs.level]
        const min = s.side === "left" ? gs.driveX : 4
        const max = s.side === "left" ? CW - 4 : gs.driveX
        gs.arrowX += gs.arrowDir * gs.arrowSpeed
        if (gs.arrowX >= max) { gs.arrowX = max; gs.arrowDir = -1 }
        if (gs.arrowX <= min) { gs.arrowX = min; gs.arrowDir = 1 }
      }

      if (gs.state === "arcing") {
        gs.arcProgress += 0.035
        if (gs.arcProgress >= 1) {
          gs.arcProgress = 1
          gs.state = "falling"
          gs.driveX = gs.arcEndX
          gs.driveY = gs.arcEndY
          gs.driveVY = 2
          gs.driveVX = 0
        } else {
          const t = gs.arcProgress
          gs.driveX = gs.arcStartX + (gs.arcEndX - gs.arcStartX) * t
          const arcHeight = -80 * Math.sin(t * Math.PI)
          gs.driveY = gs.arcStartY + (gs.arcEndY - gs.arcStartY) * t + arcHeight
        }
      }

      if (gs.state === "falling") {
        gs.driveVY += 0.4
        gs.driveY += gs.driveVY
        gs.driveX += gs.driveVX
        const s = gs.shelves[gs.level]
        if (gs.driveY >= s.y - DRIVE_H / 2) {
          gs.state = "projecting"
          gs.projectTimer = 0
          s.projecting = true   // start beam animation
          gs.driveY = s.y - DRIVE_H / 2
        }
      }

      if (gs.state === "projecting") {
        gs.projectTimer++
        if (gs.projectTimer > 60) {
          // Mark this shelf as permanently delivered (keeps beam on)
          const s = gs.shelves[gs.level]
          s.projecting = false
          s.delivered = true

          gs.totalDeliveries++
          if (gs.level < 4) {
            gs.level++
            const ns = gs.shelves[gs.level]
            gs.driveX = ns.side === "left" ? 40 : CW - 40
            gs.driveY = ns.y - DRIVE_H
            gs.state = "idle"
            gs.characterThrowFrame = 0
            initArrow(gs.level)
          } else {
            gs.extraMode = true
            buildLayout(true)
            initLevel(0, true)
          }
        }
      }

      if (gs.state === "miss") {
        gs.driveX += gs.driveVX
        gs.driveVX *= 0.88
        if (gs.flashTimer > 0) gs.flashTimer--
        if (gs.flashTimer === 0) {
          gs.state = "gameover"
          gs.flashTimer = -1
        }
      }
    }

    const drawShelves = () => {
      const gs = gameState.current
      for (let i = 0; i < 5; i++) {
        const s = gs.shelves[i]
        const gl = s.gapLeft
        const gr = s.gapRight

        ctx.fillStyle = COLORS.dark
        ctx.fillRect(0, s.y, gl, SHELF_H)
        ctx.fillRect(gr, s.y, CW - gr, SHELF_H)

        ctx.fillStyle = COLORS.mid
        ctx.fillRect(0, s.y, gl, 2)
        ctx.fillRect(gr, s.y, CW - gr, 2)

        drawProjector(s, gl, gr, i)
      }
    }

    const drawProjector = (s: Shelf, gl: number, gr: number, index: number) => {
      const gs = gameState.current
      const projH = 45
      const projW = 30
      const projX = s.side === "left" ? gr + 5 : gl - 35
      const projY = s.y - projH

      // Is this projector active (either animating or permanently on)?
      const isLit = s.projecting || s.delivered

      // Projector body
      ctx.fillStyle = COLORS.mid
      ctx.fillRect(projX, projY, projW, projH)
      ctx.fillStyle = COLORS.dark
      for (let vi = 0; vi < 3; vi++) {
        ctx.fillRect(projX + 4, projY + 6 + vi * 8, projW - 8, 2)
      }

      // Tube/lens housing
      const tubeW = 12
      const tubeH = 18
      const tubeX = s.side === "left" ? projX - tubeW : projX + projW
      const tubeY = projY + 10

      ctx.fillStyle = COLORS.dark
      ctx.fillRect(tubeX, tubeY, tubeW, tubeH)
      // Lens colour — lit when delivered or projecting
      ctx.fillStyle = isLit ? COLORS.lightest : COLORS.darkest
      ctx.fillRect(tubeX + 2, tubeY + 3, tubeW - 4, tubeH - 6)
      ctx.strokeStyle = COLORS.mid
      ctx.lineWidth = 1
      ctx.strokeRect(tubeX, tubeY, tubeW, tubeH)

      // Drive slot
      const isCurrentLevel = gs.level === index
      if (s.delivered) {
        // Slot flush / closed after delivery
        ctx.fillStyle = COLORS.lightest
        ctx.fillRect(gl, s.y - 2, gr - gl, 2)
      } else {
        const slotColor = isCurrentLevel ? COLORS.driveInput : COLORS.dark
        ctx.fillStyle = slotColor
        ctx.fillRect(gl, s.y - 8, gr - gl, 8)
        ctx.strokeStyle = isCurrentLevel ? COLORS.driveInput : COLORS.mid
        ctx.lineWidth = 2
        ctx.strokeRect(gl - 1, s.y - 9, gr - gl + 2, 10)

        if (index === 0 && gs.level === 0) {
          ctx.fillStyle = COLORS.driveInput
          ctx.font = '5px "Press Start 2P", monospace'
          ctx.textAlign = "center"
          ctx.fillText("DRIVE INPUT", (gl + gr) / 2, s.y - 12)
        }

        if (gs.state === "idle" && gs.level === index) {
          ctx.fillStyle = "rgba(0, 255, 102, 0.25)"
          ctx.fillRect(gl - 4, s.y - 12, gr - gl + 8, 16)
        }
      }

      // Projector beam — animate while projecting, stay full-length once delivered
      if (isLit) {
        const maxBeamLength = 200
        let beamLength: number
        if (s.delivered) {
          // Permanently at full length
          beamLength = maxBeamLength
        } else {
          // Animating growth during projectTimer
          beamLength = Math.min(gs.projectTimer * 4, maxBeamLength)
        }

        const beamDir = s.side === "left" ? -1 : 1
        const beamStartX = tubeX + (s.side === "left" ? 0 : tubeW)
        const beamStartY = tubeY + tubeH / 2

        ctx.save()
        const gradient = ctx.createLinearGradient(
          beamStartX, beamStartY,
          beamStartX + beamDir * beamLength, beamStartY
        )
        gradient.addColorStop(0, "rgba(0, 212, 255, 0.8)")
        gradient.addColorStop(0.3, "rgba(0, 212, 255, 0.5)")
        gradient.addColorStop(1, "rgba(0, 212, 255, 0)")
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(beamStartX, beamStartY - 6)
        ctx.lineTo(beamStartX, beamStartY + 6)
        ctx.lineTo(beamStartX + beamDir * beamLength, beamStartY + 30)
        ctx.lineTo(beamStartX + beamDir * beamLength, beamStartY - 30)
        ctx.closePath()
        ctx.fill()
        ctx.restore()

        // Lens glow
        ctx.fillStyle = "rgba(0, 212, 255, 0.4)"
        ctx.beginPath()
        ctx.arc(beamStartX, beamStartY, 10, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const drawDrive = () => {
      const gs = gameState.current
      if (gs.state === "gameover") return
      // Hide the held drive once it's in flight or delivered
      if (gs.state === "projecting" || gs.state === "falling") return
      const x = Math.round(gs.driveX)
      const y = Math.round(gs.driveY)

      ctx.fillStyle = "rgba(0,0,0,0.3)"
      ctx.fillRect(x - DRIVE_W / 2 + 2, y + DRIVE_H + 2, DRIVE_W, 4)
      ctx.fillStyle = COLORS.mid
      ctx.fillRect(x - DRIVE_W / 2, y, DRIVE_W, DRIVE_H)
      ctx.fillStyle = COLORS.lightest
      ctx.fillRect(x - DRIVE_W / 2 + 2, y + 2, 4, 3)
      ctx.fillStyle = COLORS.light
      ctx.fillRect(x - DRIVE_W / 2 + 7, y + 2, 5, 6)
      ctx.strokeStyle = COLORS.dark
      ctx.lineWidth = 1
      ctx.strokeRect(x - DRIVE_W / 2, y, DRIVE_W, DRIVE_H)
    }

    const drawArcDrive = () => {
      const gs = gameState.current
      if (gs.state !== "arcing") return
      const x = Math.round(gs.driveX)
      const y = Math.round(gs.driveY)
      ctx.fillStyle = COLORS.mid
      ctx.fillRect(x - DRIVE_W / 2, y, DRIVE_W, DRIVE_H)
      ctx.fillStyle = COLORS.lightest
      ctx.fillRect(x - DRIVE_W / 2 + 2, y + 2, 4, 3)
      ctx.fillStyle = COLORS.light
      ctx.fillRect(x - DRIVE_W / 2 + 7, y + 2, 5, 6)
      ctx.strokeStyle = COLORS.dark
      ctx.lineWidth = 1
      ctx.strokeRect(x - DRIVE_W / 2, y, DRIVE_W, DRIVE_H)
    }

    const drawArrow = () => {
      const gs = gameState.current
      const s = gs.shelves[gs.level]
      const aw = 10, ah = 12

      if (gs.state === "idle") {
        ctx.fillStyle = "rgba(0, 255, 102, 0.15)"
        ctx.fillRect(s.gapLeft, s.y - 20, s.gapRight - s.gapLeft, 20)
      }

      if (gs.state === "idle") {
        const ax = Math.round(gs.arrowX)
        const ay = s.y - 14
        ctx.fillStyle = COLORS.light
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax - aw, ay - ah)
        ctx.lineTo(ax + aw, ay - ah)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = COLORS.lightest
        ctx.lineWidth = 1
        ctx.stroke()
      }

      if ((gs.state === "miss" || gs.state === "arcing") && gs.missArrowX >= 0) {
        const ax = Math.round(gs.missArrowX)
        const ay = s.y - 14
        ctx.globalAlpha = 0.5
        ctx.fillStyle = COLORS.dark
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(ax - aw, ay - ah)
        ctx.lineTo(ax + aw, ay - ah)
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    const drawCharacter = () => {
      const gs = gameState.current
      if (gs.state === "gameover") return
      const s = gs.shelves[gs.level]
      const throwing = gs.characterThrowFrame === 1 && gs.state === "arcing"
      const baseX = s.side === "left" ? 20 : CW - 20

      ctx.save()
      ctx.translate(baseX, s.y)
      if (s.side === "right") ctx.scale(-1, 1)
      drawCory(throwing)
      ctx.restore()
    }

    const drawCory = (throwing: boolean) => {
      const D = COLORS.darkest
      const M = COLORS.mid
      const C = COLORS.lightest
      const W = "#e8f0f0"

      ctx.fillStyle = D
      ctx.fillRect(-8, -5, 7, 5); ctx.fillRect(1, -5, 8, 5)
      ctx.fillStyle = M
      ctx.fillRect(-8, -5, 7, 1); ctx.fillRect(1, -5, 8, 1)

      ctx.fillStyle = "#1a3050"
      ctx.fillRect(-7, -20, 6, 16); ctx.fillRect(1, -20, 6, 16)
      ctx.fillRect(-7, -22, 14, 4)
      ctx.fillStyle = "#2a4060"
      ctx.fillRect(-5, -18, 2, 10)

      ctx.fillStyle = D
      ctx.fillRect(-8, -23, 16, 3)
      ctx.fillStyle = M
      ctx.fillRect(-1, -23, 3, 3)

      ctx.fillStyle = "#c0c0c0"
      ctx.fillRect(-8, -38, 16, 16)
      ctx.fillStyle = "#e0e0e0"
      ctx.fillRect(-2, -38, 4, 5)
      ctx.fillStyle = "#a0a0a0"
      ctx.fillRect(-1, -37, 2, 4)
      ctx.fillStyle = "#808080"
      ctx.fillRect(-7, -35, 5, 4)
      ctx.fillStyle = "#c0c0c0"
      ctx.fillRect(-6, -34, 3, 2)
      ctx.fillStyle = "#e0e0e0"
      ctx.fillRect(-4, -40, 8, 4)

      if (!throwing) {
        ctx.fillStyle = "#c0c0c0"
        ctx.fillRect(-11, -36, 5, 18)
        ctx.fillStyle = W
        ctx.fillRect(-11, -26, 5, 8); ctx.fillRect(-11, -19, 5, 5)
        ctx.fillStyle = "#a0a0a0"
        ctx.fillRect(6, -36, 5, 14)
        ctx.fillStyle = D
        ctx.fillRect(6, -24, 5, 6)
        ctx.fillStyle = W
        ctx.fillRect(-9, -19, 3, 3)
        ctx.fillStyle = D
        ctx.fillRect(-12, -18, 8, 18)
        ctx.fillStyle = M
        ctx.fillRect(-11, -16, 6, 14)
      } else {
        ctx.fillStyle = "#c0c0c0"
        ctx.fillRect(3, -40, 5, 14)
        ctx.fillStyle = W
        ctx.fillRect(6, -34, 5, 10); ctx.fillRect(8, -26, 4, 6)
        ctx.fillStyle = "#c0c0c0"
        ctx.fillRect(-2, -38, 5, 12)
        ctx.fillStyle = W
        ctx.fillRect(0, -30, 5, 8); ctx.fillRect(2, -24, 4, 5)
        ctx.fillStyle = D
        ctx.fillRect(-12, -18, 8, 18)
        ctx.fillStyle = M
        ctx.fillRect(-11, -16, 6, 14)
      }

      ctx.fillStyle = W
      ctx.fillRect(-3, -44, 6, 5)

      ctx.fillStyle = W
      ctx.fillRect(-9, -58, 18, 16)
      ctx.fillRect(-11, -55, 3, 8); ctx.fillRect(8, -55, 3, 8)
      ctx.fillStyle = D
      ctx.fillRect(-10, -54, 1, 5); ctx.fillRect(9, -54, 1, 5)

      ctx.fillStyle = "#3a2a1a"
      ctx.fillRect(-9, -58, 18, 5); ctx.fillRect(-9, -58, 3, 12); ctx.fillRect(6, -58, 3, 8)
      ctx.fillStyle = "#4a3a2a"
      ctx.fillRect(-5, -57, 6, 2)

      ctx.fillStyle = "#4a6a4a"
      ctx.fillRect(-9, -60, 18, 4); ctx.fillRect(-9, -60, 20, 2)
      ctx.fillRect(-7, -65, 14, 7); ctx.fillRect(-5, -68, 10, 5)
      ctx.fillRect(7, -60, 6, 3)
      ctx.fillStyle = "#5a7a5a"
      ctx.fillRect(-6, -65, 5, 2)

      ctx.fillStyle = M
      ctx.fillRect(-7, -52, 6, 4); ctx.fillRect(1, -52, 6, 4)
      ctx.fillRect(-1, -51, 2, 1)
      ctx.fillStyle = C
      ctx.fillRect(-6, -51, 4, 2); ctx.fillRect(2, -51, 4, 2)

      ctx.fillStyle = D
      ctx.fillRect(-5, -50, 2, 1); ctx.fillRect(3, -50, 2, 1)

      ctx.fillStyle = "#d0c0c0"
      ctx.fillRect(-1, -48, 2, 3)

      ctx.fillStyle = D
      ctx.fillRect(-3, -44, 6, 1)
    }

    const drawCityBar = () => {
      const cityY = CH - BTN_H
      ctx.fillStyle = COLORS.dark
      ctx.fillRect(0, cityY, CW, BTN_H)

      const buildings = buildingsRef.current
      for (const b of buildings) {
        ctx.fillStyle = COLORS.darkest
        ctx.fillRect(b.x, cityY - b.h + 15, b.w, b.h)
        for (const w of b.windows) {
          ctx.fillStyle = w.lit ? COLORS.lightest : COLORS.darkest
          ctx.fillRect(w.wx, w.wy, 3, 3)
        }
      }

      ctx.fillStyle = COLORS.light
      ctx.fillRect(0, cityY, CW, 2)
    }

    const drawHUD = () => {
      const gs = gameState.current
      ctx.fillStyle = COLORS.darkest
      ctx.fillRect(0, 0, CW, HUD_H)

      ctx.fillStyle = COLORS.light
      ctx.font = '6px "Press Start 2P", monospace'
      ctx.textAlign = "left"
      ctx.fillText("CORYS DRIVE", 6, 10)
      ctx.fillText("DELIVERY", 6, 20)

      ctx.fillStyle = COLORS.lightest
      ctx.font = '9px "Press Start 2P", monospace'
      ctx.textAlign = "right"
      ctx.fillText(gs.totalDeliveries + " SITES", CW - 6, 19)
    }

    const drawOverlays = () => {
      const gs = gameState.current

      if (gs.state === "miss" && gs.flashTimer > 0) {
        const flash = Math.floor(gs.flashTimer / 6) % 2 === 0
        if (flash) {
          ctx.fillStyle = "rgba(255, 45, 149, 0.25)"
          ctx.fillRect(0, HUD_H, CW, GAME_H)
        }
        ctx.font = '14px "Press Start 2P", monospace'
        ctx.textAlign = "center"
        ctx.fillStyle = flash ? COLORS.lightest : COLORS.light
        ctx.fillText("MISS!", CW / 2, CH / 2 - 30)
      }

      if (gs.state === "gameover") {
        ctx.fillStyle = "rgba(10, 10, 26, 0.92)"
        ctx.fillRect(0, 0, CW, CH)
        ctx.textAlign = "center"

        const boxX = CW / 2 - 140, boxY = 120, boxW = 280, boxH = 70
        ctx.fillStyle = COLORS.dark
        ctx.fillRect(boxX, boxY, boxW, boxH)
        ctx.strokeStyle = COLORS.light
        ctx.lineWidth = 3
        ctx.strokeRect(boxX, boxY, boxW, boxH)
        ctx.fillStyle = COLORS.lightest
        ctx.font = '9px "Press Start 2P", monospace'
        ctx.fillText("DELIVERIES COMPLETED", CW / 2, boxY + 24)
        ctx.fillStyle = COLORS.light
        ctx.font = '26px "Press Start 2P", monospace'
        ctx.fillText(String(gs.totalDeliveries), CW / 2, boxY + 58)

        ctx.fillStyle = COLORS.lightest
        ctx.font = '18px "Press Start 2P", monospace'
        ctx.fillText("MISS!", CW / 2, CH / 2 - 30)
        ctx.font = '7px "Press Start 2P", monospace'
        ctx.fillStyle = COLORS.mid
        ctx.fillText("YOU FAILED TO", CW / 2, CH / 2)
        ctx.fillText("DELIVER THE DRIVE!", CW / 2, CH / 2 + 14)

        const btnY = CH / 2 + 40
        const btnW = 170, btnH = 32
        const btnX = CW / 2 - btnW / 2
        const blink = Math.floor(Date.now() / 500) % 2
        ctx.fillStyle = blink ? COLORS.dark : COLORS.darkest
        ctx.fillRect(btnX, btnY, btnW, btnH)
        ctx.strokeStyle = blink ? COLORS.light : COLORS.mid
        ctx.lineWidth = 2
        ctx.strokeRect(btnX, btnY, btnW, btnH)
        ctx.fillStyle = blink ? COLORS.lightest : COLORS.mid
        ctx.font = '8px "Press Start 2P", monospace'
        ctx.fillText("TRY AGAIN", CW / 2, btnY + btnH / 2 + 4)
      }
    }

    const draw = () => {
      ctx.fillStyle = COLORS.darkest
      ctx.fillRect(0, 0, CW, CH)
      drawCityBar()
      drawShelves()
      drawDrive()
      drawArcDrive()
      drawArrow()
      drawCharacter()
      drawHUD()
      drawOverlays()
    }

    const loop = () => {
      update()
      draw()
      animationId = requestAnimationFrame(loop)
    }

    loop()
    return () => cancelAnimationFrame(animationId)
  }, [screen, buildLayout, initLevel, initArrow])

  // Event handlers
  useEffect(() => {
    if (screen !== "game") return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault()
        if (gameState.current.state === "gameover") doRetry()
        else onThrow()
      }
    }

    const handleCanvasClick = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      const gs = gameState.current
      if (gs.state === "gameover") doRetry()
      else if (gs.state === "idle") onThrow()
    }

    document.addEventListener("keydown", handleKeyDown)
    const canvas = canvasRef.current
    canvas?.addEventListener("click", handleCanvasClick)
    canvas?.addEventListener("touchend", handleCanvasClick)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      canvas?.removeEventListener("click", handleCanvasClick)
      canvas?.removeEventListener("touchend", handleCanvasClick)
    }
  }, [screen, doRetry, onThrow])

  return (
    <div
      ref={shellRef}
      className="fixed top-0 left-0 overflow-hidden"
      style={{
        width: CW,
        height: CH,
        background: COLORS.darkest,
        border: `3px solid ${COLORS.dark}`,
        boxShadow: `0 0 0 3px ${COLORS.darkest}, 0 0 0 6px ${COLORS.light}, 0 0 40px rgba(255, 45, 149, 0.25)`,
        transformOrigin: "top left",
      }}
    >
      {/* Home Screen — image cropped/zoomed to focus on Cory */}
      {screen === "home" && (
        <div className="absolute inset-0 flex flex-col items-center justify-end" style={{ background: COLORS.darkest }}>
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ background: COLORS.darkest }}
          >
            <img
              src="/CoryDrive.png"
              alt="Corys Drive Delivery Challenge"
              style={{
                position: "absolute",
                // Zoom in ~1.4x and shift up slightly to crop bottom/sides
                // and focus on Cory's face/upper body
                width: "140%",
                height: "140%",
                objectFit: "cover",
                objectPosition: "center 30%",
                left: "-20%",
                top: "-5%",
                imageRendering: "auto",
              }}
            />
          </div>
          <button
            onClick={() => setScreen("instructions")}
            className="relative z-10 mb-6 px-9 py-3 text-base tracking-widest cursor-pointer whitespace-nowrap animate-pulse"
            style={{
              background: COLORS.darkest,
              color: COLORS.light,
              border: `3px solid ${COLORS.light}`,
              fontFamily: '"Press Start 2P", monospace',
              boxShadow: `3px 3px 0 ${COLORS.dark}, 0 0 16px rgba(255,45,149,0.5)`,
            }}
          >
            ▶ PLAY
          </button>
        </div>
      )}

      {/* Instruction Screen */}
      {screen === "instructions" && (
        <div
          className="absolute inset-0 cursor-pointer"
          onClick={() => startGame()}
          onKeyDown={(e) => { if (e.code === "Space" || e.code === "Enter") startGame() }}
          tabIndex={0}
          role="button"
          aria-label="Start game"
        >
          <canvas ref={instrCanvasRef} width={CW} height={CH} className="w-full h-full block" />
        </div>
      )}

      {/* Game Screen */}
      {screen === "game" && (
        <div className="absolute inset-0">
          <canvas ref={canvasRef} className="w-full h-full block" style={{ imageRendering: "pixelated" }} />
          <button
            onClick={() => {
              if (gameState.current.state === "gameover") doRetry()
              else onThrow()
            }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 w-60 py-2.5 text-sm tracking-wide cursor-pointer whitespace-nowrap z-10"
            style={{
              background: COLORS.darkest,
              color: COLORS.light,
              border: `3px solid ${COLORS.light}`,
              fontFamily: '"Press Start 2P", monospace',
              boxShadow: `3px 3px 0 ${COLORS.dark}, 0 0 10px rgba(255, 45, 149, 0.5)`,
            }}
          >
            THROW!
          </button>
        </div>
      )}

      {/* Scanlines */}
      <div
        className="absolute inset-0 pointer-events-none z-50"
        style={{
          background:
            "repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)",
        }}
      />
    </div>
  )
}
