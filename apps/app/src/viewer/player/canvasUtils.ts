/**
 * Small, stateless canvas helpers shared by the 2D map renderer. Every function
 * takes the target 2D context explicitly so it stays decoupled from the
 * component's reactive state.
 */

/** Clamps `v` into the inclusive range [a, b]. */
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Red "X" marking a kill location. */
export function drawKill(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number) {
  const r = 7
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = '#ff4d5e'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x - r, y - r)
  ctx.lineTo(x + r, y + r)
  ctx.moveTo(x + r, y - r)
  ctx.lineTo(x - r, y + r)
  ctx.stroke()
  ctx.restore()
}

/** Traces a rounded rectangle path (does not fill/stroke; caller decides). */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Wraps `text` to at most `maxWidth` px, capping at `maxLines` (ellipsis).
 *  Uses the context's current font for measurement, so set it before calling. */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
      if (lines.length === maxLines) break
    } else {
      line = test
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.join(' ').length < text.replace(/\s+/g, ' ').trim().length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/\s*\S*$/, '')}…`
  }
  return lines
}
