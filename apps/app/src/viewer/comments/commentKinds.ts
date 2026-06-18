/**
 * Comment feedback types (coach-style). Each has a UiIcon name for the HTML
 * selectors, an accent color, and the raw 24x24 SVG stroke paths used to draw the
 * icon on the canvas bubble (the viewer can't mount a Vue icon there).
 */
import type { CommentKind } from '@/viewer/domain/schema'

export type { CommentKind }

export interface CommentKindMeta {
  kind: CommentKind
  icon: string
  color: string
  paths: string[]
}

export const DEFAULT_COMMENT_KIND: CommentKind = 'note'

export const COMMENT_KINDS: CommentKindMeta[] = [
  {
    kind: 'note',
    icon: 'message',
    color: '#9ca3af',
    paths: ['M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l2-5.6A8.5 8.5 0 1 1 21 11.5z'],
  },
  {
    kind: 'good',
    icon: 'thumbs-up',
    color: '#22c55e',
    paths: [
      'M7 10v12',
      'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z',
    ],
  },
  {
    kind: 'bad',
    icon: 'thumbs-down',
    color: '#ef4444',
    paths: [
      'M17 14V2',
      'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z',
    ],
  },
  {
    kind: 'warning',
    icon: 'alert-triangle',
    color: '#f59e0b',
    paths: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z', 'M12 9v4', 'M12 17h.01'],
  },
  {
    kind: 'idea',
    icon: 'lightbulb',
    color: '#eab308',
    paths: [
      'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
      'M9 18h6',
      'M10 22h4',
    ],
  },
]

/** Metadata for a kind (falls back to `note`). */
export function commentKindMeta(kind?: CommentKind): CommentKindMeta {
  return COMMENT_KINDS.find((k) => k.kind === kind) ?? COMMENT_KINDS[0]
}
