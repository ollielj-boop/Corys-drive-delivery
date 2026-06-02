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
  projecting?: boolean
  delivered?: boolean
  // projector knock animation
  knocked?: boolean
  knockAngle?: number
  knockTimer?: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: string
  type: "spark" | "shard"
  angle?: number
  len?: number
}

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
  const buildingsRef = useRef<Building[]>(generateBuildings())
  const particlesRef = useRef<Particle[]>([])
  const leaderboardRef = useRef<{name: string, score: number}[]>([])
  const [leaderboardLoaded, setLeaderboardLoaded] = useState(false)

  const JSONBIN_ID = "6a1dac23ddf5aa59f780b928"
  const JSONBIN_KEY = "$2a$10$R1A.gZKB76C.5eQ7Mq9h6O68el4D/RL3Es4vGgyX3Ya4ePgEHslv2"
  const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(JSONBIN_URL + "/latest", {
        headers: { "X-Access-Key": JSONBIN_KEY }
      })
      if (!res.ok) return
      const data = await res.json()
      leaderboardRef.current = Array.isArray(data.record?.scores) ? data.record.scores : []
      setLeaderboardLoaded(true)
    } catch(e) {}
  }, [JSONBIN_URL, JSONBIN_KEY])

  const saveScore = useCallback(async (name: string, score: number) => {
    try {
      // Fetch latest first
      const res = await fetch(JSONBIN_URL + "/latest", {
        headers: { "X-Access-Key": JSONBIN_KEY }
      })
      let scores: {name: string, score: number}[] = []
      if (res.ok) {
        const data = await res.json()
        scores = Array.isArray(data.record?.scores) ? data.record.scores : []
      }
      scores.push({ name: name.toUpperCase().trim().substring(0,8) || "ANON", score })
      scores.sort((a, b) => b.score - a.score)
      scores = scores.slice(0, 10)
      await fetch(JSONBIN_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Access-Key": JSONBIN_KEY },
        body: JSON.stringify({ scores })
      })
      leaderboardRef.current = scores
      setLeaderboardLoaded(true)
    } catch(e) {}
  }, [JSONBIN_URL, JSONBIN_KEY])

  const gameState = useRef({
    level: 0,
    state: "idle" as
      | "idle"
      | "arcing"         // drive flying toward projector (success path)
      | "falling"        // drive falling into gap
      | "projecting"     // projector lighting up
      | "miss_arc"       // drive flying but will miss (wrong position)
      | "shattering"     // drive hit floor (miss)
      | "knocking"       // drive hit projector wrong (near miss)
      | "miss"           // flash timer running
      | "crying"     // character on knees after miss
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
    // For miss arc — drive flies to floor
    missArcProgress: 0,
    missArcStartX: 0,
    missArcStartY: 0,
    missArcEndX: 0,
    missArcEndY: 0,
    flashTimer: 0,
    missArrowX: -1,
    totalDeliveries: 0,
    extraMode: false,
    projectTimer: 0,
    shelves: [] as Shelf[],
    characterThrowFrame: 0,
    shatterTimer: 0,
    knockTimer: 0,
    cryTimer: 0,
  })

  const nameEntryRef = useRef({ active: false, name: "", saved: false })
  const [nameEntryActive, setNameEntryActive] = useState(false)

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
      shelves.push({
        y: shelfY, gapLeft, gapRight: gapLeft + gw, side,
        projecting: false, delivered: false,
        knocked: false, knockAngle: 0, knockTimer: 0
      })
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

  const initLevel = useCallback((lv: number, keepTotal: boolean) => {
    const gs = gameState.current
    gs.level = lv
    gs.state = "idle"
    gs.characterThrowFrame = 0
    gs.flashTimer = 0
    gs.missArrowX = -1
    gs.driveVX = 0
    gs.driveVY = 0
    gs.arcProgress = 0
    gs.missArcProgress = 0
    gs.projectTimer = 0
    gs.shatterTimer = 0
    gs.knockTimer = 0
    gs.cryTimer = 0
    ;(gs as any).throwType = null
    particlesRef.current = []
    if (!keepTotal) {
      gs.totalDeliveries = 0
      gs.extraMode = false
      gs.shelves.forEach((s) => {
        s.projecting = false
        s.delivered = false
        s.knocked = false
        s.knockAngle = 0
        s.knockTimer = 0
      })
    }
    const s = gs.shelves[lv]
    gs.driveX = s.side === "left" ? 40 : CW - 40
    gs.driveY = s.y - DRIVE_H
    initArrow(lv)
  }, [initArrow])

  const spawnShatterParticles = useCallback((x: number, y: number) => {
    const ps = particlesRef.current
    // Shards of drive casing
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.5
      const speed = 1.5 + Math.random() * 2.5
      ps.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 40 + Math.random() * 20,
        maxLife: 60,
        color: "#888",
        type: "shard",
        angle: Math.random() * Math.PI * 2,
        len: 3 + Math.random() * 4,
      })
    }
    // Electric sparks
    for (let i = 0; i < 12; i++) {
      const angle = (Math.random() * Math.PI * 2)
      const speed = 0.5 + Math.random() * 3
      ps.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 15 + Math.random() * 15,
        maxLife: 30,
        color: Math.random() > 0.5 ? "#00d4ff" : "#ffff00",
        type: "spark",
      })
    }
  }, [])

  const spawnKnockParticles = useCallback((x: number, y: number) => {
    const ps = particlesRef.current
    // Sparks from sides of projector
    for (let i = 0; i < 16; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5
      const speed = 1 + Math.random() * 3
      ps.push({
        x: x + (Math.random() - 0.5) * 20,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 20 + Math.random() * 20,
        maxLife: 40,
        color: Math.random() > 0.3 ? "#00d4ff" : "#ffffff",
        type: "spark",
      })
    }
  }, [])

  const startGame = useCallback(() => {
    setScreen("game")
    buildLayout(false)
    initLevel(0, false)
    fetchLeaderboard()
  }, [buildLayout, initLevel, fetchLeaderboard])

  const onThrow = useCallback(() => {
    const gs = gameState.current
    if (gs.state !== "idle") return
    const s = gs.shelves[gs.level]
    const inGap = gs.arrowX >= s.gapLeft && gs.arrowX <= s.gapRight

    // Knock only triggers if arrow is strictly over the projector body itself (30px box beside the gap)
    const projBodyLeft = s.side === "left" ? s.gapRight + 5 : s.gapLeft - 35
    const projBodyRight = projBodyLeft + 30
    const nearProjector = gs.arrowX >= projBodyLeft && gs.arrowX <= projBodyRight && !inGap

    gs.characterThrowFrame = 1
    gs.missArrowX = gs.arrowX
    ;(gs as any).throwType = null

    if (inGap) {
      // Perfect throw — arc to projector gap
      gs.state = "arcing"
      gs.arcProgress = 0
      gs.arcStartX = gs.driveX
      gs.arcStartY = gs.driveY
      gs.arcEndX = (s.gapLeft + s.gapRight) / 2
      gs.arcEndY = s.y - DRIVE_H / 2
    } else if (nearProjector) {
      // Near miss — drive hits projector body and knocks it
      gs.state = "arcing"
      gs.arcProgress = 0
      gs.arcStartX = gs.driveX
      gs.arcStartY = gs.driveY
      // Aim at projector body
      const projX = s.side === "left" ? s.gapRight + 20 : s.gapLeft - 20
      gs.arcEndX = projX
      gs.arcEndY = s.y - 35
      // Mark this as a knock arc (we use missArrowX !== -1 and nearProjector combined)
      // We'll use a special flag
      ;(gs as any).throwType = "knock"
    } else {
      // Full miss — arc to floor in front of character
      gs.state = "miss_arc"
      gs.missArcProgress = 0
      gs.missArcStartX = gs.driveX
      gs.missArcStartY = gs.driveY
      // Land on the shelf surface short of the gap
      const landX = s.side === "left"
        ? gs.driveX + (s.gapLeft - gs.driveX) * 0.6
        : gs.driveX - (gs.driveX - s.gapRight) * 0.6
      gs.missArcEndX = landX
      gs.missArcEndY = s.y - DRIVE_H
      ;(gs as any).throwType = "miss"
    }
  }, [spawnShatterParticles, spawnKnockParticles])

  const doRetry = useCallback(() => {
    buildLayout(false)
    initLevel(0, false)
    buildingsRef.current = generateBuildings()
    particlesRef.current = []
    nameEntryRef.current = { active: false, name: "", saved: false }
    setNameEntryActive(false)
    fetchLeaderboard()
  }, [buildLayout, initLevel, fetchLeaderboard])

  // Instruction screen
  useEffect(() => {
    if (screen !== "instructions") return
    const c = instrCanvasRef.current
    if (!c) return
    const x = c.getContext("2d")
    if (!x) return

    x.fillStyle = COLORS.darkest; x.fillRect(0, 0, CW, CH)
    x.fillStyle = COLORS.dark; x.fillRect(20, 40, 320, 56)
    x.strokeStyle = COLORS.light; x.lineWidth = 3; x.strokeRect(20, 40, 320, 56)
    x.fillStyle = COLORS.lightest; x.font = '14px "Press Start 2P", monospace'
    x.textAlign = "center"; x.fillText("HOW TO PLAY", CW / 2, 76)

    x.fillStyle = COLORS.darkest; x.fillRect(20, 130, 320, 300)
    x.strokeStyle = COLORS.dark; x.lineWidth = 2; x.strokeRect(20, 130, 320, 300)

    x.fillStyle = COLORS.light
    x.beginPath(); x.moveTo(CW/2, 168); x.lineTo(CW/2-14, 148); x.lineTo(CW/2+14, 148)
    x.closePath(); x.fill()
    x.fillStyle = COLORS.lightest; x.font = '7px "Press Start 2P", monospace'
    x.fillText("AN ARROW SWEEPS", CW/2, 190); x.fillText("BACK AND FORTH", CW/2, 204)

    x.strokeStyle = COLORS.dark; x.lineWidth = 1
    x.beginPath(); x.moveTo(40, 218); x.lineTo(320, 218); x.stroke()

    x.fillStyle = COLORS.lightest; x.fillRect(CW/2-20, 228, 40, 12)
    x.fillStyle = "#00ff66"; x.fillRect(CW/2-18, 226, 36, 4)
    x.fillStyle = COLORS.lightest; x.font = '7px "Press Start 2P", monospace'
    x.fillText("STOP THE ARROW", CW/2, 256); x.fillText("OVER THE GREEN SLOT", CW/2, 270)

    x.beginPath(); x.moveTo(40, 284); x.lineTo(320, 284); x.stroke()

    x.fillStyle = COLORS.mid; x.fillRect(CW/2-10, 294, 20, 14)
    x.fillStyle = COLORS.lightest; x.fillRect(CW/2-8, 296, 6, 4)
    x.fillStyle = COLORS.lightest; x.font = '7px "Press Start 2P", monospace'
    x.fillText("CLICK THROW / SPACE", CW/2, 326); x.fillText("TO THROW DRIVE", CW/2, 340)

    x.beginPath(); x.moveTo(40, 354); x.lineTo(320, 354); x.stroke()

    x.fillStyle = COLORS.light; x.font = '7px "Press Start 2P", monospace'
    x.fillText("LAND THE DRIVE IN THE", CW/2, 376)
    x.fillText("PROJECTOR SLOT!", CW/2, 390)
    x.fillText("MISS = DRIVE SMASHES!", CW/2, 410)

    x.fillStyle = COLORS.lightest; x.font = '8px "Press Start 2P", monospace'
    x.fillText("TAP / CLICK TO START", CW/2, 480)
    x.fillStyle = COLORS.light
    x.fillRect(CW/2-12, 496, 6, 6); x.fillRect(CW/2-3, 496, 6, 6); x.fillRect(CW/2+6, 496, 6, 6)
    x.strokeStyle = COLORS.light; x.lineWidth = 4; x.strokeRect(4, 4, CW-8, CH-8)
    x.strokeStyle = COLORS.dark; x.lineWidth = 2; x.strokeRect(10, 10, CW-20, CH-20)
  }, [screen])

  // Main game loop
  useEffect(() => {
    if (screen !== "game") return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.width = CW; canvas.height = CH
    ctx.imageSmoothingEnabled = false

    let animationId: number

    const update = () => {
      const gs = gameState.current
      const ps = particlesRef.current

      // Update particles
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.x += p.vx; p.y += p.vy
        if (p.type === "shard") p.vy += 0.15 // gravity on shards
        if (p.type === "spark") p.vy += 0.05
        p.life--
        if (p.life <= 0) ps.splice(i, 1)
      }

      if (gs.state === "idle") {
        const s = gs.shelves[gs.level]
        const min = s.side === "left" ? gs.driveX : 4
        const max = s.side === "left" ? CW - 4 : gs.driveX
        gs.arrowX += gs.arrowDir * gs.arrowSpeed
        if (gs.arrowX >= max) { gs.arrowX = max; gs.arrowDir = -1 }
        if (gs.arrowX <= min) { gs.arrowX = min; gs.arrowDir = 1 }
      }

      // Success arc toward gap
      if (gs.state === "arcing") {
        gs.arcProgress += 0.035
        if (gs.arcProgress >= 1) {
          gs.arcProgress = 1
          gs.driveX = gs.arcEndX; gs.driveY = gs.arcEndY
          if ((gs as any).throwType === "knock") {
            // Drive hit projector — knock it over
            const s = gs.shelves[gs.level]
            s.knocked = true; s.knockAngle = 0; s.knockTimer = 0
            gs.state = "knocking"
            gs.knockTimer = 0
            spawnKnockParticles(gs.arcEndX, gs.arcEndY)
          } else {
            gs.state = "falling"
            gs.driveVY = 2; gs.driveVX = 0
          }
        } else {
          const t = gs.arcProgress
          gs.driveX = gs.arcStartX + (gs.arcEndX - gs.arcStartX) * t
          const arcHeight = -80 * Math.sin(t * Math.PI)
          gs.driveY = gs.arcStartY + (gs.arcEndY - gs.arcStartY) * t + arcHeight
        }
      }

      // Miss arc toward floor
      if (gs.state === "miss_arc") {
        gs.missArcProgress += 0.04
        if (gs.missArcProgress >= 1) {
          gs.missArcProgress = 1
          gs.driveX = gs.missArcEndX; gs.driveY = gs.missArcEndY
          gs.state = "shattering"
          gs.shatterTimer = 0
          spawnShatterParticles(gs.driveX, gs.driveY)
        } else {
          const t = gs.missArcProgress
          gs.driveX = gs.missArcStartX + (gs.missArcEndX - gs.missArcStartX) * t
          const arcHeight = -50 * Math.sin(t * Math.PI)
          gs.driveY = gs.missArcStartY + (gs.missArcEndY - gs.missArcStartY) * t + arcHeight
        }
      }

      // Drive shattering on floor → character cries
      if (gs.state === "shattering") {
        gs.shatterTimer++
        if (gs.shatterTimer > 40) {
          gs.state = "crying"
          gs.cryTimer = 0
        }
      }

      // Character crying on knees
      if (gs.state === "crying") {
        gs.cryTimer++
        if (gs.cryTimer > 90) {
          gs.state = "miss"
          gs.flashTimer = 60
        }
      }

      // Projector knocked over
      if (gs.state === "knocking") {
        gs.knockTimer++
        const s = gs.shelves[gs.level]
        // Animate projector falling — tilt it over
        if (gs.knockTimer < 30) {
          s.knockAngle = (gs.knockTimer / 30) * (Math.PI / 2)
        } else {
          s.knockAngle = Math.PI / 2
        }
        // Flicker sparks periodically
        if (gs.knockTimer % 8 === 0 && gs.knockTimer < 60) {
          const projX = s.side === "left" ? s.gapRight + 20 : s.gapLeft - 20
          spawnKnockParticles(projX, s.y - 20)
        }
        if (gs.knockTimer > 80) {
          gs.state = "crying"
          gs.cryTimer = 0
        }
      }

      if (gs.state === "falling") {
        gs.driveVY += 0.4
        gs.driveY += gs.driveVY; gs.driveX += gs.driveVX
        const s = gs.shelves[gs.level]
        if (gs.driveY >= s.y - DRIVE_H / 2) {
          gs.state = "projecting"
          gs.projectTimer = 0
          s.projecting = true
          gs.driveY = s.y - DRIVE_H / 2
        }
      }

      if (gs.state === "projecting") {
        gs.projectTimer++
        if (gs.projectTimer > 60) {
          const s = gs.shelves[gs.level]
          s.projecting = false; s.delivered = true
          gs.totalDeliveries++
          if (gs.level < 4) {
            gs.level++
            const ns = gs.shelves[gs.level]
            gs.driveX = ns.side === "left" ? 40 : CW - 40
            gs.driveY = ns.y - DRIVE_H
            gs.state = "idle"; gs.characterThrowFrame = 0
            initArrow(gs.level)
          } else {
            gs.extraMode = true
            buildLayout(true); initLevel(0, true)
          }
        }
      }

      if (gs.state === "miss") {
        if (gs.flashTimer > 0) gs.flashTimer--
        if (gs.flashTimer === 0) {
          gs.state = "gameover"
          gs.flashTimer = -1
          // Trigger name entry if score qualifies for top 10
          if (gs.totalDeliveries > 0) {
            const lb = leaderboardRef.current
            if (lb.length < 10 || gs.totalDeliveries > lb[lb.length - 1]?.score) {
              nameEntryRef.current = { active: true, name: "", saved: false }
              setNameEntryActive(true)
            }
          }
        }
      }
    }

    const drawShelves = () => {
      const gs = gameState.current
      for (let i = 0; i < 5; i++) {
        const s = gs.shelves[i]
        const gl = s.gapLeft, gr = s.gapRight
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
      const projH = 45, projW = 30
      const projX = s.side === "left" ? gr + 5 : gl - 35
      const projY = s.y - projH
      const isLit = s.projecting || s.delivered
      const isKnocked = s.knocked
      const knockAngle = s.knockAngle || 0

      ctx.save()

      if (isKnocked) {
        // Rotate projector about its base
        const pivotX = s.side === "left" ? projX : projX + projW
        const pivotY = s.y
        ctx.translate(pivotX, pivotY)
        // Fall direction away from character
        const fallDir = s.side === "left" ? 1 : -1
        ctx.rotate(fallDir * knockAngle)
        ctx.translate(-pivotX, -pivotY)
      }

      // Projector body
      ctx.fillStyle = COLORS.mid
      ctx.fillRect(projX, projY, projW, projH)
      ctx.fillStyle = COLORS.dark
      for (let vi = 0; vi < 3; vi++) {
        ctx.fillRect(projX + 4, projY + 6 + vi * 8, projW - 8, 2)
      }

      const tubeW = 12, tubeH = 18
      const tubeX = s.side === "left" ? projX - tubeW : projX + projW
      const tubeY = projY + 10

      ctx.fillStyle = COLORS.dark
      ctx.fillRect(tubeX, tubeY, tubeW, tubeH)

      // Lens — flicker if knocked
      let lensLit = isLit
      if (isKnocked && gs.knockTimer !== undefined) {
        lensLit = Math.floor(gs.knockTimer / 3) % 2 === 0
      }
      ctx.fillStyle = lensLit ? COLORS.lightest : COLORS.darkest
      ctx.fillRect(tubeX + 2, tubeY + 3, tubeW - 4, tubeH - 6)
      ctx.strokeStyle = COLORS.mid; ctx.lineWidth = 1
      ctx.strokeRect(tubeX, tubeY, tubeW, tubeH)

      // Beam — upward if knocked, sideways if delivered normally
      if (isKnocked && gs.knockTimer !== undefined && gs.knockTimer > 5) {
        // Beam pointing upward (projector fallen, lens now faces up)
        const beamLen = Math.min((gs.knockTimer - 5) * 5, 150)
        const bx = tubeX + tubeW / 2
        const by = tubeY
        ctx.save()
        const grad = ctx.createLinearGradient(bx, by, bx, by - beamLen)
        grad.addColorStop(0, "rgba(0,212,255,0.7)")
        grad.addColorStop(0.4, "rgba(0,212,255,0.4)")
        grad.addColorStop(1, "rgba(0,212,255,0)")
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(bx - 4, by); ctx.lineTo(bx + 4, by)
        ctx.lineTo(bx + 20, by - beamLen); ctx.lineTo(bx - 20, by - beamLen)
        ctx.closePath(); ctx.fill()
        ctx.restore()
      }

      if (isLit) {
        const maxBeamLen = 200
        const beamLen = s.delivered ? maxBeamLen : Math.min(gs.projectTimer * 4, maxBeamLen)
        const beamDir = s.side === "left" ? -1 : 1
        const bx = tubeX + (s.side === "left" ? 0 : tubeW)
        const by = tubeY + tubeH / 2
        ctx.save()
        const grad = ctx.createLinearGradient(bx, by, bx + beamDir * beamLen, by)
        grad.addColorStop(0, "rgba(0,212,255,0.8)")
        grad.addColorStop(0.3, "rgba(0,212,255,0.5)")
        grad.addColorStop(1, "rgba(0,212,255,0)")
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(bx, by - 6); ctx.lineTo(bx, by + 6)
        ctx.lineTo(bx + beamDir * beamLen, by + 30)
        ctx.lineTo(bx + beamDir * beamLen, by - 30)
        ctx.closePath(); ctx.fill()
        ctx.restore()
        ctx.fillStyle = "rgba(0,212,255,0.4)"
        ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill()
      }

      ctx.restore() // end of projector transform

      // Drive slot
      const isCurrentLevel = gs.level === index
      if (s.delivered) {
        ctx.fillStyle = COLORS.lightest
        ctx.fillRect(gl, s.y - 2, gr - gl, 2)
      } else if (!isKnocked) {
        const slotColor = isCurrentLevel ? COLORS.driveInput : COLORS.dark
        ctx.fillStyle = slotColor
        ctx.fillRect(gl, s.y - 8, gr - gl, 8)
        ctx.strokeStyle = isCurrentLevel ? COLORS.driveInput : COLORS.mid
        ctx.lineWidth = 2
        ctx.strokeRect(gl - 1, s.y - 9, gr - gl + 2, 10)
        if (index === 0 && gs.level === 0 && gs.totalDeliveries === 0 && !gs.extraMode) {
          ctx.fillStyle = COLORS.driveInput
          ctx.font = '5px "Press Start 2P", monospace'
          ctx.textAlign = "center"
          ctx.fillText("DRIVE INPUT", (gl + gr) / 2, s.y - 12)
        }
        if (gs.state === "idle" && gs.level === index) {
          ctx.fillStyle = "rgba(0,255,102,0.25)"
          ctx.fillRect(gl - 4, s.y - 12, gr - gl + 8, 16)
        }
      }
    }

    const drawParticles = () => {
      const ps = particlesRef.current
      for (const p of ps) {
        const alpha = p.life / p.maxLife
        ctx.globalAlpha = alpha
        if (p.type === "spark") {
          ctx.fillStyle = p.color
          ctx.fillRect(p.x - 1, p.y - 1, 2, 2)
          // Draw a little line in direction of travel
          ctx.strokeStyle = p.color
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3)
          ctx.stroke()
        } else if (p.type === "shard") {
          ctx.fillStyle = p.color
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate((p.angle || 0) + p.life * 0.1)
          ctx.fillRect(-(p.len || 3) / 2, -1, p.len || 3, 2)
          ctx.restore()
        }
        ctx.globalAlpha = 1
      }
    }

    const drawDrive = () => {
      const gs = gameState.current
      // Only show flying drive during arc states — idle drive is drawn IN the character's hand
      const showStates = ["arcing", "miss_arc", "falling"]
      if (!showStates.includes(gs.state)) return
      const x = Math.round(gs.driveX), y = Math.round(gs.driveY)
      ctx.fillStyle = "rgba(0,0,0,0.3)"
      ctx.fillRect(x - DRIVE_W / 2 + 2, y + DRIVE_H + 2, DRIVE_W, 4)
      ctx.fillStyle = COLORS.mid
      ctx.fillRect(x - DRIVE_W / 2, y, DRIVE_W, DRIVE_H)
      ctx.fillStyle = COLORS.lightest
      ctx.fillRect(x - DRIVE_W / 2 + 2, y + 2, 4, 3)
      ctx.fillStyle = COLORS.light
      ctx.fillRect(x - DRIVE_W / 2 + 7, y + 2, 5, 6)
      ctx.strokeStyle = COLORS.dark; ctx.lineWidth = 1
      ctx.strokeRect(x - DRIVE_W / 2, y, DRIVE_W, DRIVE_H)
    }

    const drawArrow = () => {
      const gs = gameState.current
      const s = gs.shelves[gs.level]
      const aw = 10, ah = 12

      if (gs.state === "idle") {
        ctx.fillStyle = "rgba(0,255,102,0.15)"
        ctx.fillRect(s.gapLeft, s.y - 20, s.gapRight - s.gapLeft, 20)
        const ax = Math.round(gs.arrowX), ay = s.y - 14
        ctx.fillStyle = COLORS.light
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax-aw, ay-ah); ctx.lineTo(ax+aw, ay-ah)
        ctx.closePath(); ctx.fill()
        ctx.strokeStyle = COLORS.lightest; ctx.lineWidth = 1; ctx.stroke()
      }

      if (gs.missArrowX >= 0 && ["miss_arc","shattering","knocking","arcing","crying","miss","gameover"].includes(gs.state)) {
        const ax = Math.round(gs.missArrowX), ay = s.y - 14
        ctx.globalAlpha = 0.4
        ctx.fillStyle = COLORS.dark
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax-aw, ay-ah); ctx.lineTo(ax+aw, ay-ah)
        ctx.closePath(); ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    const drawCharacter = () => {
      const gs = gameState.current
      if (gs.state === "gameover") return
      const s = gs.shelves[gs.level]
      const throwing = gs.characterThrowFrame === 1 &&
        ["arcing","miss_arc","shattering","knocking","falling","projecting"].includes(gs.state)
      const crying = ["crying","miss"].includes(gs.state)
      const holdingDrive = gs.state === "idle"
      const baseX = s.side === "left" ? 20 : CW - 20
      ctx.save()
      ctx.translate(baseX, s.y)
      if (s.side === "right") ctx.scale(-1, 1)
      if (crying) {
        drawCoryCrying()
      } else {
        drawCory(throwing, holdingDrive)
      }
      ctx.restore()
    }

    const drawCory = (throwing: boolean, holdingDrive: boolean = false) => {
      const D = COLORS.darkest, M = COLORS.mid, C = COLORS.lightest, W = "#e8f0f0"
      ctx.fillStyle = D
      ctx.fillRect(-8,-5,7,5); ctx.fillRect(1,-5,8,5)
      ctx.fillStyle = M
      ctx.fillRect(-8,-5,7,1); ctx.fillRect(1,-5,8,1)
      ctx.fillStyle = "#1a3050"
      ctx.fillRect(-7,-20,6,16); ctx.fillRect(1,-20,6,16); ctx.fillRect(-7,-22,14,4)
      ctx.fillStyle = "#2a4060"; ctx.fillRect(-5,-18,2,10)
      ctx.fillStyle = D; ctx.fillRect(-8,-23,16,3)
      ctx.fillStyle = M; ctx.fillRect(-1,-23,3,3)
      ctx.fillStyle = "#c0c0c0"; ctx.fillRect(-8,-38,16,16)
      ctx.fillStyle = "#e0e0e0"; ctx.fillRect(-2,-38,4,5)
      ctx.fillStyle = "#a0a0a0"; ctx.fillRect(-1,-37,2,4)
      ctx.fillStyle = "#808080"; ctx.fillRect(-7,-35,5,4)
      ctx.fillStyle = "#c0c0c0"; ctx.fillRect(-6,-34,3,2)
      ctx.fillStyle = "#e0e0e0"; ctx.fillRect(-4,-40,8,4)
      if (!throwing) {
        // Right arm down
        ctx.fillStyle = "#a0a0a0"; ctx.fillRect(6,-36,5,14)
        ctx.fillStyle = D; ctx.fillRect(6,-24,5,6)
        if (holdingDrive) {
          // Left arm raised, holding drive at chest height
          ctx.fillStyle = "#c0c0c0"; ctx.fillRect(-11,-36,5,10)
          ctx.fillStyle = W; ctx.fillRect(-11,-28,5,6)
          // Hand holding drive up near chest
          ctx.fillStyle = W; ctx.fillRect(-13,-30,5,5) // hand
          // Drive in hand
          ctx.fillStyle = COLORS.mid; ctx.fillRect(-15,-32,10,7)
          ctx.fillStyle = COLORS.lightest; ctx.fillRect(-14,-31,3,2)
          ctx.fillStyle = COLORS.light; ctx.fillRect(-9,-31,3,4)
          ctx.strokeStyle = COLORS.darkest; ctx.lineWidth = 0.5
          ctx.strokeRect(-15,-32,10,7)
        } else {
          // Left arm at side (after throw, no drive)
          ctx.fillStyle = "#c0c0c0"; ctx.fillRect(-11,-36,5,18)
          ctx.fillStyle = W; ctx.fillRect(-11,-26,5,8); ctx.fillRect(-11,-19,5,5)
          ctx.fillStyle = W; ctx.fillRect(-9,-19,3,3)
          ctx.fillStyle = D; ctx.fillRect(-12,-18,8,18)
          ctx.fillStyle = M; ctx.fillRect(-11,-16,6,14)
        }
      } else {
        ctx.fillStyle = "#c0c0c0"; ctx.fillRect(3,-40,5,14)
        ctx.fillStyle = W; ctx.fillRect(6,-34,5,10); ctx.fillRect(8,-26,4,6)
        ctx.fillStyle = "#c0c0c0"; ctx.fillRect(-2,-38,5,12)
        ctx.fillStyle = W; ctx.fillRect(0,-30,5,8); ctx.fillRect(2,-24,4,5)
        ctx.fillStyle = D; ctx.fillRect(-12,-18,8,18)
        ctx.fillStyle = M; ctx.fillRect(-11,-16,6,14)
      }
      ctx.fillStyle = W; ctx.fillRect(-3,-44,6,5)
      ctx.fillStyle = W
      ctx.fillRect(-9,-58,18,16); ctx.fillRect(-11,-55,3,8); ctx.fillRect(8,-55,3,8)
      ctx.fillStyle = D; ctx.fillRect(-10,-54,1,5); ctx.fillRect(9,-54,1,5)
      ctx.fillStyle = "#3a2a1a"
      ctx.fillRect(-9,-58,18,5); ctx.fillRect(-9,-58,3,12); ctx.fillRect(6,-58,3,8)
      ctx.fillStyle = "#4a3a2a"; ctx.fillRect(-5,-57,6,2)
      ctx.fillStyle = "#4a6a4a"
      ctx.fillRect(-9,-60,18,4); ctx.fillRect(-9,-60,20,2)
      ctx.fillRect(-7,-65,14,7); ctx.fillRect(-5,-68,10,5); ctx.fillRect(7,-60,6,3)
      ctx.fillStyle = "#5a7a5a"; ctx.fillRect(-6,-65,5,2)
      ctx.fillStyle = M
      ctx.fillRect(-7,-52,6,4); ctx.fillRect(1,-52,6,4); ctx.fillRect(-1,-51,2,1)
      ctx.fillStyle = C
      ctx.fillRect(-6,-51,4,2); ctx.fillRect(2,-51,4,2)
      ctx.fillStyle = D; ctx.fillRect(-5,-50,2,1); ctx.fillRect(3,-50,2,1)
      ctx.fillStyle = "#d0c0c0"; ctx.fillRect(-1,-48,2,3)
      ctx.fillStyle = D; ctx.fillRect(-3,-44,6,1)
    }

    const drawCoryCrying = () => {
      // Character on knees, head bowed, arms raised crying
      const D = COLORS.darkest, M = COLORS.mid, C = COLORS.lightest, W = "#e8f0f0"
      // Knees on floor — body is lower/compressed
      // Feet flat on ground
      ctx.fillStyle = D
      ctx.fillRect(-10, -8, 9, 6); ctx.fillRect(1, -8, 9, 6)
      ctx.fillStyle = M; ctx.fillRect(-10, -8, 9, 2); ctx.fillRect(1, -8, 9, 2)
      // Thighs going forward (kneeling)
      ctx.fillStyle = "#1a3050"
      ctx.fillRect(-8, -16, 7, 10); ctx.fillRect(1, -16, 7, 10)
      // Torso hunched forward
      ctx.fillStyle = "#c0c0c0"; ctx.fillRect(-7, -30, 14, 16)
      ctx.fillStyle = "#e0e0e0"; ctx.fillRect(-2, -30, 4, 5)
      // Arms raised up beside head (crying gesture)
      ctx.fillStyle = "#c0c0c0"
      ctx.fillRect(-13, -42, 5, 14) // left arm up
      ctx.fillRect(8, -42, 5, 14)  // right arm up
      ctx.fillStyle = W
      ctx.fillRect(-14, -44, 5, 5); ctx.fillRect(9, -44, 5, 5) // hands up
      // Neck
      ctx.fillStyle = W; ctx.fillRect(-3, -34, 6, 5)
      // Head bowed forward
      ctx.fillStyle = W
      ctx.fillRect(-9, -48, 18, 14)
      // Cap
      ctx.fillStyle = "#4a6a4a"
      ctx.fillRect(-9, -50, 18, 4); ctx.fillRect(-7, -55, 14, 7); ctx.fillRect(-5, -58, 10, 5)
      ctx.fillRect(7, -50, 6, 3)
      ctx.fillStyle = "#5a7a5a"; ctx.fillRect(-6, -55, 5, 2)
      // Hair
      ctx.fillStyle = "#3a2a1a"
      ctx.fillRect(-9, -48, 18, 4); ctx.fillRect(-9, -48, 3, 8); ctx.fillRect(6, -48, 3, 6)
      // Glasses
      ctx.fillStyle = M
      ctx.fillRect(-7, -42, 6, 4); ctx.fillRect(1, -42, 6, 4); ctx.fillRect(-1, -41, 2, 1)
      ctx.fillStyle = C
      ctx.fillRect(-6, -41, 4, 2); ctx.fillRect(2, -41, 4, 2)
      // Tears — animated dots falling
      const gs = gameState.current
      const tearOffset = (gs.cryTimer % 20) / 20
      ctx.fillStyle = COLORS.lightest
      ctx.globalAlpha = 0.9
      ctx.fillRect(-6, Math.round(-38 + tearOffset * 10), 2, 2) // left tear
      ctx.fillRect(4, Math.round(-36 + tearOffset * 10), 2, 2)  // right tear
      if (tearOffset > 0.4) {
        ctx.fillRect(-6, Math.round(-38 + (tearOffset - 0.4) * 10), 2, 2)
        ctx.fillRect(4, Math.round(-36 + (tearOffset - 0.4) * 10), 2, 2)
      }
      ctx.globalAlpha = 1
    }

    const drawCityBar = () => {
      const cityY = CH - BTN_H
      ctx.fillStyle = COLORS.dark; ctx.fillRect(0, cityY, CW, BTN_H)
      for (const b of buildingsRef.current) {
        ctx.fillStyle = COLORS.darkest
        ctx.fillRect(b.x, cityY - b.h + 15, b.w, b.h)
        for (const w of b.windows) {
          ctx.fillStyle = w.lit ? COLORS.lightest : COLORS.darkest
          ctx.fillRect(w.wx, w.wy, 3, 3)
        }
      }
      ctx.fillStyle = COLORS.light; ctx.fillRect(0, cityY, CW, 2)
    }

    const drawHUD = () => {
      const gs = gameState.current
      ctx.fillStyle = COLORS.darkest; ctx.fillRect(0, 0, CW, HUD_H)
      ctx.fillStyle = COLORS.light; ctx.font = '6px "Press Start 2P", monospace'
      ctx.textAlign = "left"; ctx.fillText("CORYS DRIVE", 6, 10); ctx.fillText("DELIVERY", 6, 20)
      ctx.fillStyle = COLORS.lightest; ctx.font = '9px "Press Start 2P", monospace'
      ctx.textAlign = "right"; ctx.fillText(gameState.current.totalDeliveries + " SITES", CW - 6, 19)
    }

    const drawOverlays = () => {
      const gs = gameState.current

      if (gs.state === "miss" && gs.flashTimer > 0) {
        const flash = Math.floor(gs.flashTimer / 6) % 2 === 0
        if (flash) { ctx.fillStyle = "rgba(255,45,149,0.25)"; ctx.fillRect(0, HUD_H, CW, GAME_H) }
        ctx.font = '14px "Press Start 2P", monospace'; ctx.textAlign = "center"
        ctx.fillStyle = flash ? COLORS.lightest : COLORS.light
        ctx.fillText("MISS!", CW / 2, CH / 2 - 30)
      }

      if (gs.state === "gameover") {
        ctx.fillStyle = "rgba(10,10,26,0.95)"; ctx.fillRect(0, 0, CW, CH)
        ctx.textAlign = "center"

        // Score box at top
        const bx = CW/2-130, by = 14, bw = 260, bh = 56
        ctx.fillStyle = COLORS.dark; ctx.fillRect(bx, by, bw, bh)
        ctx.strokeStyle = COLORS.light; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh)
        ctx.fillStyle = COLORS.lightest; ctx.font = '7px "Press Start 2P", monospace'
        ctx.fillText("DELIVERIES COMPLETED", CW/2, by + 16)
        ctx.fillStyle = COLORS.light; ctx.font = '22px "Press Start 2P", monospace'
        ctx.fillText(String(gs.totalDeliveries), CW/2, by + 46)

        // Name entry prompt if active
        const ne = nameEntryRef.current
        if (ne.active && !ne.saved) {
          ctx.fillStyle = COLORS.light; ctx.font = '8px "Press Start 2P", monospace'
          ctx.fillText("NEW HIGH SCORE!", CW/2, 88)
          ctx.fillStyle = COLORS.lightest; ctx.font = '6px "Press Start 2P", monospace'
          ctx.fillText("ENTER NAME BELOW & PRESS SUBMIT", CW/2, 102)
        }

        // Leaderboard
        const lb = leaderboardRef.current
        const lbY = ne.active && !ne.saved ? 116 : 88
        const lbH = 10 * 18 + 20
        ctx.fillStyle = COLORS.darkest; ctx.fillRect(20, lbY, CW-40, lbH)
        ctx.strokeStyle = COLORS.mid; ctx.lineWidth = 1; ctx.strokeRect(20, lbY, CW-40, lbH)
        ctx.fillStyle = COLORS.pink; ctx.font = '6px "Press Start 2P", monospace'
        ctx.fillStyle = COLORS.light; ctx.fillText("TOP 10 SCORES", CW/2, lbY + 12)
        if (lb.length === 0) {
          ctx.fillStyle = COLORS.mid; ctx.font = '6px "Press Start 2P", monospace'
          ctx.fillText("NO SCORES YET", CW/2, lbY + 30)
        } else {
          lb.slice(0,10).forEach((entry, i) => {
            const ey = lbY + 24 + i * 18
            const isPlayer = !ne.active && i === lb.findIndex(e => e.score === gs.totalDeliveries)
            ctx.fillStyle = i === 0 ? COLORS.light : isPlayer ? "#ffff00" : COLORS.lightest
            ctx.font = '6px "Press Start 2P", monospace'
            ctx.textAlign = "left"
            ctx.fillText(`${i+1}. ${(entry.name || "ANON").substring(0,8).padEnd(8," ")}`, 30, ey)
            ctx.textAlign = "right"
            ctx.fillText(String(entry.score), CW - 30, ey)
          })
          ctx.textAlign = "center"
        }

        // Try again button
        const btnY = lbY + lbH + 8
        const blink = Math.floor(Date.now() / 500) % 2
        const btnW = 160, btnH = 28, btnX = CW/2 - btnW/2
        ctx.fillStyle = blink ? COLORS.dark : COLORS.darkest; ctx.fillRect(btnX, btnY, btnW, btnH)
        ctx.strokeStyle = blink ? COLORS.light : COLORS.mid; ctx.lineWidth = 2
        ctx.strokeRect(btnX, btnY, btnW, btnH)
        ctx.fillStyle = blink ? COLORS.lightest : COLORS.mid
        ctx.font = '7px "Press Start 2P", monospace'
        ctx.fillText("TRY AGAIN", CW/2, btnY + btnH/2 + 3)
      }
    }

    const draw = () => {
      ctx.fillStyle = COLORS.darkest; ctx.fillRect(0, 0, CW, CH)
      drawCityBar()
      drawShelves()
      drawDrive()
      drawArrow()
      drawParticles()
      drawCharacter()
      drawHUD()
      drawOverlays()
    }

    const loop = () => { update(); draw(); animationId = requestAnimationFrame(loop) }
    loop()
    return () => cancelAnimationFrame(animationId)
  }, [screen, buildLayout, initLevel, initArrow, spawnShatterParticles, spawnKnockParticles])

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
        width: CW, height: CH,
        background: COLORS.darkest,
        border: `3px solid ${COLORS.dark}`,
        boxShadow: `0 0 0 3px ${COLORS.darkest}, 0 0 0 6px ${COLORS.light}, 0 0 40px rgba(255,45,149,0.25)`,
        transformOrigin: "top left",
      }}
    >
      {/* Home Screen */}
      {screen === "home" && (
        <div className="absolute inset-0" style={{ background: COLORS.darkest }}>
          <img
            src="/cory3.png"
            alt="Corys Drive Delivery Challenge"
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              objectFit: "cover",
              objectPosition: "center top",
              imageRendering: "auto",
            }}
          />
          <button
            onClick={() => setScreen("instructions")}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 px-9 py-3 text-base tracking-widest cursor-pointer whitespace-nowrap"
            style={{
              background: "rgba(10,10,26,0.85)",
              color: COLORS.light,
              border: `3px solid ${COLORS.light}`,
              fontFamily: '"Press Start 2P", monospace',
              boxShadow: `3px 3px 0 ${COLORS.dark}, 0 0 16px rgba(255,45,149,0.5)`,
              animation: "pulse 1s step-end infinite",
            }}
          >
            ▶ PLAY
          </button>
        </div>
      )}

      {/* Instruction Screen */}
      {screen === "instructions" && (
        <div className="absolute inset-0 cursor-pointer"
          onClick={() => startGame()}
          onKeyDown={(e) => { if (e.code === "Space" || e.code === "Enter") startGame() }}
          tabIndex={0} role="button" aria-label="Start game"
        >
          <canvas ref={instrCanvasRef} width={CW} height={CH} className="w-full h-full block" />
        </div>
      )}

      {/* Game Screen */}
      {screen === "game" && (
        <div className="absolute inset-0">
          <canvas ref={canvasRef} className="w-full h-full block" style={{ imageRendering: "pixelated" }} />
          <button
            onClick={() => { if (gameState.current.state === "gameover") doRetry(); else onThrow() }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 w-60 py-2.5 text-sm tracking-wide cursor-pointer whitespace-nowrap z-10"
            style={{
              background: COLORS.darkest, color: COLORS.light,
              border: `3px solid ${COLORS.light}`,
              fontFamily: '"Press Start 2P", monospace',
              boxShadow: `3px 3px 0 ${COLORS.dark}, 0 0 10px rgba(255,45,149,0.5)`,
            }}
          >
            THROW!
          </button>
          {/* Name entry overlay — shown when player qualifies for leaderboard */}
          {nameEntryActive && (
            <div className="absolute z-20 flex flex-col items-center gap-2"
              style={{ top: "42%", left: "50%", transform: "translateX(-50%)", width: 240 }}>
              <input
                autoFocus
                maxLength={8}
                placeholder="YOUR NAME"
                style={{
                  background: COLORS.darkest, color: COLORS.lightest,
                  border: `2px solid ${COLORS.lightest}`,
                  fontFamily: '"Press Start 2P", monospace', fontSize: 12,
                  padding: "6px 10px", width: "100%", textAlign: "center",
                  outline: "none", letterSpacing: 3,
                }}
                onChange={(e) => { nameEntryRef.current.name = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"") }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = nameEntryRef.current
                    if (n.name.trim()) { n.saved = true; setNameEntryActive(false); saveScore(n.name, gameState.current.totalDeliveries) }
                  }
                }}
              />
              <button
                style={{
                  background: COLORS.darkest, color: COLORS.light,
                  border: `2px solid ${COLORS.light}`,
                  fontFamily: '"Press Start 2P", monospace', fontSize: 9,
                  padding: "6px 20px", cursor: "pointer", letterSpacing: 2, width: "100%",
                }}
                onClick={() => {
                  const n = nameEntryRef.current
                  const name = n.name.trim() || "ANON"
                  n.saved = true
                  setNameEntryActive(false)
                  saveScore(name, gameState.current.totalDeliveries)
                }}
              >SUBMIT SCORE</button>
            </div>
          )}
        </div>
      )}

      {/* Scanlines */}
      <div className="absolute inset-0 pointer-events-none z-50" style={{
        background: "repeating-linear-gradient(to bottom, transparent 0px, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)",
      }} />
    </div>
  )
}
