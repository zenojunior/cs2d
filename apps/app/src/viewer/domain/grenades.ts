import type { GrenadeKind } from '@/viewer/domain/schema'

/** Color per grenade type (data color, applied via :style). The label comes
 *  from i18n (`grenadeKind.<type>`). */
export const KIND_COLOR: Record<GrenadeKind, string> = {
  smoke: 'rgba(206, 211, 222, 0.95)',
  fire: 'rgba(255, 120, 30, 0.95)',
  he: 'rgba(255, 90, 60, 0.95)',
  flash: 'rgba(255, 238, 170, 0.95)',
  decoy: 'rgba(140, 150, 165, 0.95)',
}

/** Utility icon (white SVG under /public/weapons) per grenade type. */
export const KIND_ICON: Record<GrenadeKind, string> = {
  smoke: '/weapons/smoke.svg',
  fire: '/weapons/molotov.svg',
  he: '/weapons/he.svg',
  flash: '/weapons/flash.svg',
  decoy: '/weapons/decoy.svg',
}

/** Display order for grenade-type filters/legends. */
export const KIND_ORDER: GrenadeKind[] = ['smoke', 'flash', 'he', 'fire', 'decoy']

/** Inline CSS mask painting the single-color icon SVG in the kind's data color. */
export function grenadeIconStyle(kind: GrenadeKind) {
  const src = KIND_ICON[kind]
  return {
    maskImage: `url(${src})`,
    WebkitMaskImage: `url(${src})`,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    backgroundColor: KIND_COLOR[kind],
  }
}
