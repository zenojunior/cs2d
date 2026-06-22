/**
 * Grenade visual effects (smoke clouds, fire areas, scorch marks) for the 2D map.
 *
 * Smoke/fire are the most expensive things the viewer paints: blur filters, many
 * radial gradients and additive blending. Rebuilding them from scratch every
 * frame blows the per-frame budget on weak machines the moment a grenade goes
 * off. So each effect is baked once into an offscreen canvas and just blitted
 * (drawImage) every frame, regenerating only a few times per second to keep the
 * subtle wobble/flicker. The blit scales the sprite to the current zoom radius,
 * so it stays correct without re-rasterizing the gradients.
 *
 * `createGrenadeEffects()` owns the per-instance sprite cache; all painters take
 * the target 2D context plus screen-space coordinates, so this module stays
 * decoupled from the component's transform/reactive state.
 */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

// Deterministic per-position noise, so an effect's shape is stable across frames.
function effectRand(seed: number) {
  return (n: number) => {
    const v = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
    return v - Math.floor(v)
  }
}

const SPRITE_REF_R = 150 // radius (px) the effect is baked at inside the sprite
const SPRITE_PAD = 1.3 // extra canvas margin so blur/wobble isn't clipped
const EFFECT_ANIM_FPS = 12 // how often the baked sprite is refreshed for animation
type EffectSprite = { canvas: HTMLCanvasElement; bucket: number }

export interface GrenadeEffects {
  /** Paints a smoke cloud body (puffy irregular disc) centered at (x, y). */
  paintSmoke(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    R: number,
    t: number,
    seed: number,
  ): void
  /** Paints a fire area (base glow + flickering flame blobs) centered at (x, y). */
  paintFire(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    R: number,
    t: number,
    seed: number,
  ): void
  /** Darkened patch left where a molotov burned or an HE detonated. Reuses the
   *  effect's seeded irregular outline so the mark matches the affected area. */
  paintScorch(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    R: number,
    seed: number,
  ): void
  /** Drops every cached sprite (call when the round changes). */
  clear(): void
}

export function createGrenadeEffects(): GrenadeEffects {
  const cache = new Map<string, EffectSprite>()

  /** Returns the offscreen canvas for an effect, (re)baking it when the
   *  animation bucket advances. Keyed by kind+seed, so memory stays bounded by
   *  the number of distinct grenades in the round. */
  function sprite(kind: 'smoke' | 'fire', seed: number, t: number): HTMLCanvasElement {
    const bucket = Math.floor(t * EFFECT_ANIM_FPS)
    const key = `${kind}|${seed.toFixed(4)}`
    let entry = cache.get(key)
    if (!entry || entry.bucket !== bucket) {
      // Safety net: callers clear on round change, but bound it in case of long
      // sessions so distinct grenades can't grow the map unboundedly.
      if (!entry && cache.size > 96) cache.clear()
      const dim = Math.ceil(SPRITE_REF_R * 2 * SPRITE_PAD)
      const canvas = entry?.canvas ?? document.createElement('canvas')
      if (canvas.width !== dim) {
        canvas.width = dim
        canvas.height = dim
      }
      const c = canvas.getContext('2d')
      if (c) {
        c.clearRect(0, 0, dim, dim)
        const mid = dim / 2
        if (kind === 'smoke') paintSmokeRaw(c, mid, mid, SPRITE_REF_R, t, seed)
        else paintFireRaw(c, mid, mid, SPRITE_REF_R, t, seed)
      }
      entry = { canvas, bucket }
      cache.set(key, entry)
    }
    return entry.canvas
  }

  /** Blits a cached smoke/fire sprite, centered at (x, y) and scaled so the baked
   *  reference radius maps to the requested radius R. */
  function blit(
    ctx: CanvasRenderingContext2D,
    kind: 'smoke' | 'fire',
    x: number,
    y: number,
    R: number,
    t: number,
    seed: number,
  ) {
    const half = R * SPRITE_PAD
    ctx.drawImage(sprite(kind, seed, t), x - half, y - half, half * 2, half * 2)
  }

  return {
    paintSmoke: (ctx, x, y, R, t, seed) => blit(ctx, 'smoke', x, y, R, t, seed),
    paintFire: (ctx, x, y, R, t, seed) => blit(ctx, 'fire', x, y, R, t, seed),
    paintScorch,
    clear: () => cache.clear(),
  }
}

// --- Raw effect painters (draw into the offscreen sprite canvas) -------------
function paintSmokeRaw(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  t: number,
  seed: number,
) {
  const rand = effectRand(seed)
  const verts = 34
  const ring: { x: number; y: number }[] = []
  for (let i = 0; i < verts; i++) {
    const ang = (i / verts) * Math.PI * 2
    const wob = 0.86 + 0.12 * rand(i + 7) + 0.03 * Math.sin(t * 1.8 + i * 0.5 + seed)
    ring.push({ x: x + Math.cos(ang) * R * wob, y: y + Math.sin(ang) * R * wob })
  }
  const tracePath = () => {
    c.beginPath()
    c.moveTo(ring[0].x, ring[0].y)
    for (let i = 1; i < ring.length; i++) c.lineTo(ring[i].x, ring[i].y)
    c.closePath()
  }
  c.save()
  c.filter = `blur(${clamp(R * 0.06, 2, 7)}px)`
  const grad = c.createRadialGradient(x, y, R * 0.1, x, y, R)
  grad.addColorStop(0, 'rgba(220, 224, 232, 0.46)')
  grad.addColorStop(0.7, 'rgba(208, 213, 224, 0.34)')
  grad.addColorStop(1, 'rgba(206, 211, 222, 0.04)')
  c.fillStyle = grad
  tracePath()
  c.fill()
  const puffs = 7
  for (let i = 0; i < puffs; i++) {
    const ang = rand(i + 50) * Math.PI * 2 + t * 0.12
    const dist = R * (0.1 + 0.42 * rand(i + 80))
    const px = x + Math.cos(ang) * dist
    const py = y + Math.sin(ang) * dist
    const pr = R * (0.28 + 0.22 * rand(i + 90))
    const pg = c.createRadialGradient(px, py, 0, px, py, pr)
    pg.addColorStop(0, 'rgba(230, 234, 242, 0.2)')
    pg.addColorStop(1, 'rgba(220, 224, 232, 0)')
    c.fillStyle = pg
    c.beginPath()
    c.arc(px, py, pr, 0, Math.PI * 2)
    c.fill()
  }
  c.filter = 'blur(1.5px)'
  c.strokeStyle = 'rgba(228, 232, 240, 0.4)'
  c.lineWidth = 1.5
  tracePath()
  c.stroke()
  c.restore()
}

function paintFireRaw(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  t: number,
  seed: number,
) {
  const rand = effectRand(seed)
  c.save()
  const base = c.createRadialGradient(x, y, R * 0.1, x, y, R)
  base.addColorStop(0, 'rgba(255, 120, 30, 0.28)')
  base.addColorStop(0.7, 'rgba(220, 70, 20, 0.16)')
  base.addColorStop(1, 'rgba(180, 40, 10, 0)')
  c.fillStyle = base
  c.beginPath()
  c.arc(x, y, R, 0, Math.PI * 2)
  c.fill()
  c.globalCompositeOperation = 'lighter'
  const blobs = 12
  for (let i = 0; i < blobs; i++) {
    const ang = rand(i + 1) * Math.PI * 2
    const dist = R * (0.12 + 0.62 * rand(i + 31))
    const fx = x + Math.cos(ang) * dist
    const fy = y + Math.sin(ang) * dist
    const flick = 0.55 + 0.45 * Math.sin(t * 9 + i * 1.7 + seed)
    const fr = R * (0.16 + 0.13 * flick)
    const g = c.createRadialGradient(fx, fy, 0, fx, fy, fr)
    g.addColorStop(0, `rgba(255, 235, 130, ${0.5 * flick})`)
    g.addColorStop(0.45, `rgba(255, 140, 40, ${0.38 * flick})`)
    g.addColorStop(1, 'rgba(200, 50, 10, 0)')
    c.fillStyle = g
    c.beginPath()
    c.arc(fx, fy, fr, 0, Math.PI * 2)
    c.fill()
  }
  c.restore()
}

// Scorch marks are cheap (a single seeded path + one gradient) and persist for
// the rest of the round, so they are painted directly rather than cached.
function paintScorch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  seed: number,
) {
  const rand = effectRand(seed)
  ctx.save()
  ctx.globalAlpha = 0.5
  const verts = 30
  ctx.beginPath()
  for (let i = 0; i < verts; i++) {
    const ang = (i / verts) * Math.PI * 2
    const wob = 0.82 + 0.14 * rand(i + 101)
    const px = x + Math.cos(ang) * R * wob
    const py = y + Math.sin(ang) * R * wob
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  const grad = ctx.createRadialGradient(x, y, R * 0.1, x, y, R)
  grad.addColorStop(0, 'rgba(16, 11, 8, 0.9)')
  grad.addColorStop(1, 'rgba(28, 18, 12, 0.4)')
  ctx.fillStyle = grad
  ctx.fill()
  ctx.restore()
}
