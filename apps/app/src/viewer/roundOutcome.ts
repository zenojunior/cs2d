/**
 * Maps the round-end reason (raw CS2 `m_eRoundWinReason` code) to a design
 * system icon and a short label. Used in the round menu and the scoreboard's
 * round strip. Returns null for reasons without a dedicated icon.
 */
export interface RoundOutcome {
  /** Icon name in UiIcon. */
  icon: string
  /** i18n key for the label (translated in the component). */
  labelKey: string
}

export function roundOutcome(reason: string | null): RoundOutcome | null {
  switch (reason) {
    case '1':
      return { icon: 'flame', labelKey: 'outcome.bombExploded' }
    case '7':
      return { icon: 'shield', labelKey: 'outcome.bombDefused' }
    case '8':
    case '9':
      return { icon: 'target', labelKey: 'outcome.elimination' }
    case '12':
      return { icon: 'clock', labelKey: 'outcome.timeExpired' }
    default:
      return null
  }
}
