/**
 * Image/icon assets drawn on the 2D map: per-team mic indicators, weapon icons
 * and comment-kind glyphs. Images are preloaded once and a redraw is requested
 * (`onLoad`) as each finishes, so they appear without waiting for the next tick.
 *
 * The radar image stays in the component: it is bound to reactive props and the
 * mount/resize lifecycle, unlike these static assets.
 */

import { SIDE_COLOR } from '@/viewer/domain/colors'
import { WEAPON_LABELS, weaponIconPath } from '@/viewer/domain/weaponIcons'
import { commentKindMeta } from '@/viewer/comments/commentKinds'
import type { CommentKind, Side } from '@/viewer/domain/schema'

export interface ViewerAssets {
  /** Talking indicator, preloaded per team color. */
  micImgs: Record<Side, HTMLImageElement>
  /** Weapon icons keyed by weapon label (see WEAPON_LABELS). */
  weaponImgs: Map<string, HTMLImageElement>
  /** Cached Path2D glyphs for a comment kind (built lazily on first use). */
  kindIconPaths(kind: CommentKind | undefined): Path2D[]
}

export function useViewerAssets(onLoad: () => void): ViewerAssets {
  function makeMic(color: string) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>`
    const img = new Image()
    img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    img.onload = onLoad
    return img
  }
  const micImgs: Record<Side, HTMLImageElement> = {
    CT: makeMic(SIDE_COLOR.CT),
    T: makeMic(SIDE_COLOR.T),
  }

  const weaponImgs = new Map<string, HTMLImageElement>()
  for (const label of WEAPON_LABELS) {
    const path = weaponIconPath(label)
    if (!path) continue
    const img = new Image()
    img.src = path
    img.onload = onLoad
    weaponImgs.set(label, img)
  }

  const kindIconCache = new Map<string, Path2D[]>()
  function kindIconPaths(kind: CommentKind | undefined): Path2D[] {
    const meta = commentKindMeta(kind)
    let p = kindIconCache.get(meta.kind)
    if (!p) {
      p = meta.paths.map((d) => new Path2D(d))
      kindIconCache.set(meta.kind, p)
    }
    return p
  }

  return { micImgs, weaponImgs, kindIconPaths }
}
