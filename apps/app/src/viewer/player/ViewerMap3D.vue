<script setup lang="ts">
// Experimental 3D view of the replay (three.js): the map's simplified collision
// mesh (from the /map-export skill) coloured per surface material, with the radar
// draped over the up-facing surfaces, and the players as capsules with name
// labels. Mouse: left drag = pan, right drag = rotate/tilt, wheel = zoom.
// It only mirrors the player positions: comments, coach tools, grenades and the
// other 2D overlays are not drawn here yet.
import { onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AmbientLight,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  MOUSE,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  type Texture,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { PlayerMeta, PlayerState, Round } from '@/viewer/domain/schema'
import type { MapCalibration } from '@/viewer/domain/calibration'
import { SIDE_COLOR } from '@/viewer/domain/colors'
import { RADAR_PX, buildGeometries, loadMapMesh, type MapMesh } from '@/viewer/player/map3dGeometry'
import { useMapEffects3D } from '@/viewer/player/useMapEffects3D'

const props = defineProps<{
  players: PlayerState[]
  playersById: Map<string, PlayerMeta>
  calibration: MapCalibration
  /** Active floor radar (multi-level maps). Falls back to the calibration radar. */
  radarSrc?: string
  /** URL of the map's `.mesh.bin.gz`; nothing but the players is drawn without it. */
  meshSrc?: string
  /** Z range of the active floor: geometry and players outside it are hidden. */
  levelRange?: { minZ: number; maxZ: number } | null
  /** Current round and playback time: drive tracers, grenades, kills and the C4. */
  round?: Round | null
  currentT?: number
  /** Blink phase of the planted C4. */
  bombBlink?: boolean
}>()
const emit = defineEmits<{
  /** The WebGL context couldn't be created: the stage falls back to 2D. */
  unsupported: []
}>()

const BODY_H = 64
const BODY_R = 16
/** Default cutaway height above the local floor (game units). */
const CUT_DEFAULT = 280
const CUT_MAX = 600

const wrap = ref<HTMLDivElement | null>(null)
const cut = ref(CUT_DEFAULT)
let renderer: WebGLRenderer | null = null
let camera: PerspectiveCamera | null = null
let controls: OrbitControls | null = null
const scene = new Scene()
scene.background = new Color('#0b0d12')
scene.add(new AmbientLight(0xfff3e4, 1.2))
const sun = new DirectionalLight(0xffdfae, 1.8)
sun.position.set(-0.5, 1, 0.6)
scene.add(sun)

// Uniforms shared by the map materials (see `patch`).
const uniforms = {
  uRadar: { value: null as Texture | null },
  uOrigin: { value: [0, 0] as [number, number] },
  uSpan: { value: 1 },
  uCut: { value: CUT_DEFAULT },
  uZRange: { value: [-1e6, 1e6] as [number, number] },
}

/** Adds the radar drape (up-facing surfaces) and the cutaway (discard anything
 *  higher than `uCut` above its own walkable floor, or outside the active floor's
 *  Z range) to a lit material. */
function patch(mat: MeshLambertMaterial) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vMat;\nvarying float vH;\nattribute float aMat;\nattribute float aH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvMat = aMat;\nvH = aH;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying float vMat;
varying float vH;
uniform sampler2D uRadar;
uniform vec2 uOrigin;
uniform float uSpan;
uniform float uCut;
uniform vec2 uZRange;

// --- procedural surface textures (no game assets): value noise + per-material patterns
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * vn(p) + 0.3 * vn(p * 2.07) + 0.15 * vn(p * 4.3); }
// 1 on a thin line at the cell border of a repeating coordinate, antialiased
float seam(vec2 b, float w) {
  vec2 fb = fract(b);
  vec2 aa = fwidth(b);
  vec2 e = min(fb, 1.0 - fb);
  float lx = 1.0 - smoothstep(w, w + aa.x + 0.02, e.x);
  float ly = 1.0 - smoothstep(w, w + aa.y + 0.02, e.y);
  return max(lx, ly);
}
float surface(float kind, vec2 q, bool wall, float detail) {
  float s = 1.0;
  if (kind < 0.5) {
    // plaster / concrete: large stains, fine grain and faint stone courses on walls
    float st = fbm(q / 70.0);
    s *= 0.68 + 0.55 * st;
    s *= 1.0 + (vn(q / 4.0) - 0.5) * 0.30 * detail;
    if (wall) {
      float row = floor(q.y / 22.0);
      vec2 b = vec2(q.x / 54.0 + mod(row, 2.0) * 0.5, q.y / 22.0);
      // each stone gets its own tone, with dark mortar between them
      float tone = h21(floor(b) + 13.0);
      s *= 0.88 + 0.24 * tone;
      s *= 1.0 - 0.38 * seam(b, 0.045) * (0.35 + 0.65 * detail);
    }
  } else if (kind < 1.5) {
    // wood: planks with grain along them
    float plank = floor(q.x / 15.0);
    s *= 0.62 + 0.55 * vn(vec2(q.x * 0.9 + plank * 7.3, q.y * 0.045));
    s *= 0.9 + 0.2 * h21(vec2(plank, 3.0));
    s *= 1.0 - 0.45 * seam(vec2(q.x / 15.0, 0.5), 0.06) * (0.35 + 0.65 * detail);
  } else if (kind < 2.5) {
    // metal: brushed streaks and panel seams
    s *= 0.8 + 0.32 * vn(vec2(q.x * 0.025, q.y * 1.6));
    s *= 1.0 - 0.3 * seam(q / 56.0, 0.03) * (0.35 + 0.65 * detail);
  } else if (kind < 3.5) {
    // terrain (rock, dirt, sand): rough multi-scale noise
    s *= 0.58 + 0.75 * fbm(q / 34.0);
    s *= 1.0 + (vn(q / 3.5) - 0.5) * 0.32 * detail;
  } else {
    s *= 0.92 + 0.16 * vn(q / 8.0);
  }
  return s;
}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
if (vWPos.y < uZRange.x || vWPos.y >= uZRange.y) discard;
// vH = height above the walkable floor beneath this point (baked by /map-export)
if (vH > uCut) discard;
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
  vec2 ruv = vec2((vWPos.x - uOrigin.x) / uSpan, 1.0 - (uOrigin.y + vWPos.z) / uSpan);
  bool ruvIn = ruv.x >= 0.0 && ruv.y >= 0.0 && ruv.x <= 1.0 && ruv.y <= 1.0;
  if (fn.y > 0.6 && ruvIn) {
    vec4 r = texture2D(uRadar, ruv);
    diffuseColor.rgb = mix(diffuseColor.rgb, r.rgb, r.a * 0.92);
  } else if (fn.y <= 0.6) {
    // walls: darker near the floor, a cheap ambient-occlusion look
    float ao = clamp(vH / 160.0, 0.0, 1.0);
    diffuseColor.rgb *= mix(0.6, 1.0, ao);
  }
  bool wall = abs(fn.y) <= 0.6;
  vec2 q = wall ? vec2(abs(fn.x) > abs(fn.z) ? vWPos.z : vWPos.x, vWPos.y) : vWPos.xz;
  float detail = 1.0 - smoothstep(900.0, 3200.0, length(cameraPosition - vWPos));
  float tex = surface(vMat, q, wall, detail);
  // radar-covered floors keep most of the radar's look; the rest takes the full texture
  diffuseColor.rgb *= (ruvIn && fn.y > 0.6) ? mix(1.0, tex, 0.35) : tex;
}`,
      )
  }
  mat.customProgramCacheKey = () => 'map3d'
}

const solidMat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
const glassMat = new MeshLambertMaterial({
  vertexColors: true,
  side: DoubleSide,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
})
patch(solidMat)
patch(glassMat)
let solidMesh: Mesh | null = null
let glassMesh: Mesh | null = null
const playersGroup = new Group()
scene.add(playersGroup)

// Tracers, grenade arcs/effects, kill markers and the C4 (see useMapEffects3D).
const effects = useMapEffects3D({
  scene,
  round: () => props.round ?? null,
  players: () => props.players,
  levelRange: () => props.levelRange ?? null,
  bombBlink: () => !!props.bombBlink,
  blastRadius: () => props.calibration.blastRadius,
  requestRender: () => requestRender(),
})

// --- rendering (on demand) ---
let raf = 0
function requestRender() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    if (renderer && camera) renderer.render(scene, camera)
  })
}

function span() {
  return props.calibration.scale * RADAR_PX
}
function center() {
  const s = span()
  return { x: props.calibration.posX + s / 2, z: -props.calibration.posY + s / 2 }
}
function syncOrigin() {
  uniforms.uOrigin.value = [props.calibration.posX, props.calibration.posY]
  uniforms.uSpan.value = span()
}

let frameY = 0
function frameCamera() {
  if (!camera || !controls) return
  const s = span()
  const c = center()
  controls.target.set(c.x, frameY, c.z)
  camera.position.set(c.x, frameY + s * 0.8, c.z + s * 0.7)
  camera.far = s * 10
  camera.updateProjectionMatrix()
  controls.update()
  requestRender()
}

// --- radar texture ---
const loader = new TextureLoader()
let radarTex: Texture | null = null
function loadRadar() {
  const src = props.radarSrc ?? props.calibration.radar
  loader.load(src, (tex) => {
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1
    radarTex?.dispose()
    radarTex = tex
    uniforms.uRadar.value = tex
    requestRender()
  })
}

// --- map mesh ---
let meshToken = 0
function clearMesh() {
  for (const m of [solidMesh, glassMesh]) {
    if (!m) continue
    scene.remove(m)
    m.geometry.dispose()
  }
  solidMesh = glassMesh = null
}
function applyMesh(mesh: MapMesh) {
  frameY = mesh.header.focusZ

  const { solid, glass } = buildGeometries(mesh)
  solidMesh = new Mesh(solid, solidMat)
  scene.add(solidMesh)
  if (glass) {
    glassMesh = new Mesh(glass, glassMat)
    glassMesh.renderOrder = 5
    scene.add(glassMesh)
  }
}
async function loadMesh() {
  const token = ++meshToken
  const mesh = props.meshSrc ? await loadMapMesh(props.meshSrc) : null
  if (token !== meshToken) return
  clearMesh()
  if (mesh) applyMesh(mesh)
  frameCamera()
}

// --- players ---
interface Marker {
  group: Group
  label: Sprite
  name: string
  side: string
}
const markers = new Map<string, Marker>()
const bodyGeo = new CylinderGeometry(BODY_R, BODY_R, BODY_H, 16)
const noseGeo = new ConeGeometry(BODY_R * 0.55, BODY_R * 1.6, 12)
const mats = {
  CT: new MeshBasicMaterial({ color: SIDE_COLOR.CT }),
  T: new MeshBasicMaterial({ color: SIDE_COLOR.T }),
}

function makeLabel(text: string): Sprite {
  const cv = document.createElement('canvas')
  cv.width = 256
  cv.height = 64
  const g = cv.getContext('2d')!
  g.font = '600 30px Inter, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 6
  g.strokeStyle = 'rgba(0,0,0,0.85)'
  g.strokeText(text, 128, 34)
  g.fillStyle = '#fff'
  g.fillText(text, 128, 34)
  const tex = new CanvasTexture(cv)
  tex.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  sprite.scale.set(150, 37.5, 1)
  sprite.renderOrder = 10
  return sprite
}

function makeMarker(name: string, side: 'CT' | 'T'): Marker {
  const group = new Group()
  const body = new Mesh(bodyGeo, mats[side])
  body.position.y = BODY_H / 2
  const nose = new Mesh(noseGeo, mats[side])
  nose.rotation.x = Math.PI / 2 // cone tip toward +Z, turned by the group's yaw
  nose.position.set(0, BODY_H * 0.62, BODY_R * 1.5)
  const label = makeLabel(name)
  label.position.y = BODY_H + 34
  group.add(body, nose, label)
  playersGroup.add(group)
  return { group, label, name, side }
}

function disposeMarker(m: Marker) {
  playersGroup.remove(m.group)
  const mat = m.label.material as SpriteMaterial
  mat.map?.dispose()
  mat.dispose()
}

function syncPlayers() {
  const seen = new Set<string>()
  const lvl = props.levelRange
  for (const p of props.players) {
    seen.add(p.steamId)
    const name = props.playersById.get(p.steamId)?.name ?? ''
    let m = markers.get(p.steamId)
    // Sides swap at halftime: rebuild the marker when the name/side changes.
    if (m && (m.name !== name || m.side !== p.side)) {
      disposeMarker(m)
      markers.delete(p.steamId)
      m = undefined
    }
    if (!m) {
      m = makeMarker(name, p.side)
      markers.set(p.steamId, m)
    }
    const onLevel = !lvl || (p.z >= lvl.minZ && p.z < lvl.maxZ)
    m.group.visible = p.alive && onLevel
    // Scene Y is the game Z (feet), scene Z is -game Y.
    m.group.position.set(p.x, p.z, -p.y)
    // Game yaw is CCW from +X in the XY plane; scene Z is -Y, so rotation.Y = yaw + 90°.
    m.group.rotation.y = (p.yaw * Math.PI) / 180 + Math.PI / 2
  }
  for (const [id, m] of markers) {
    if (!seen.has(id)) {
      disposeMarker(m)
      markers.delete(id)
    }
  }
  requestRender()
}

// --- lifecycle ---
let ro: ResizeObserver | null = null
function resize() {
  const el = wrap.value
  if (!el || !renderer || !camera) return
  const w = el.clientWidth || 1
  const h = el.clientHeight || 1
  renderer.setSize(w, h, false)
  effects.setResolution(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  requestRender()
}

onMounted(() => {
  const el = wrap.value
  if (!el) return
  try {
    renderer = new WebGLRenderer({ antialias: true })
  } catch {
    renderer = null
    emit('unsupported')
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  el.appendChild(renderer.domElement)
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'
  camera = new PerspectiveCamera(45, 1, 10, 100000)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.maxPolarAngle = Math.PI * 0.39 // keeps the camera above the map's ragged underside
  controls.enableDamping = false
  // Left drag pans the map, right drag rotates/tilts it, the wheel zooms.
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
  controls.addEventListener('change', requestRender)
  ro = new ResizeObserver(resize)
  ro.observe(el)
  syncOrigin()
  syncLevel()
  loadRadar()
  void loadMesh()
  resize()
  frameCamera()
  effects.rebuild()
  effects.update(props.currentT ?? 0)
  syncPlayers()
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  controls?.dispose()
  for (const m of markers.values()) disposeMarker(m)
  markers.clear()
  effects.dispose()
  clearMesh()
  radarTex?.dispose()
  // Give the GPU context back right away: browsers cap how many WebGL contexts a page
  // can hold, and every 2D<->3D switch creates a fresh renderer.
  renderer?.forceContextLoss()
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
})

function syncLevel() {
  const l = props.levelRange
  uniforms.uZRange.value = l ? [l.minZ, l.maxZ] : [-1e6, 1e6]
  requestRender()
}

watch(() => props.players, () => {
  effects.update(props.currentT ?? 0)
  syncPlayers()
})
watch(() => props.currentT, (t) => {
  effects.update(t ?? 0)
  requestRender()
})
watch(() => props.round, () => {
  effects.rebuild()
  effects.update(props.currentT ?? 0)
  requestRender()
})
watch(() => props.bombBlink, () => {
  effects.update(props.currentT ?? 0)
  requestRender()
})
watch(() => props.levelRange, () => {
  syncLevel()
  syncPlayers()
}, { deep: true })
watch(() => props.playersById, syncPlayers)
watch(() => [props.radarSrc, props.calibration.radar], loadRadar)
watch(() => props.meshSrc, () => void loadMesh())
watch(() => props.calibration, () => {
  syncOrigin()
  frameCamera()
})
watch(cut, (v) => {
  uniforms.uCut.value = v >= CUT_MAX ? 1e6 : v
  requestRender()
})
</script>

<template>
  <div ref="wrap" class="absolute inset-0 overflow-hidden bg-ink-950" data-viewer-3d>
    <label
      class="absolute right-4 top-1/2 z-10 flex -translate-y-1/2 items-center gap-2 rounded-md bg-ink-950/70 px-3 py-1.5 text-xs text-white/80 backdrop-blur"
    >
      {{ $t('viewer.cutHeight') }}
      <input v-model.number="cut" type="range" min="60" :max="CUT_MAX" step="10" class="w-28" />
    </label>
  </div>
</template>
