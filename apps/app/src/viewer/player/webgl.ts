// WebGL availability for the 3D view. Browsers without it (GPU on a blocklist,
// WebGL disabled, hardware acceleration off with no software fallback) can't
// create a context, so the 3D switch must not be offered there.
let supported: boolean | undefined

export function webglSupported(): boolean {
  if (supported !== undefined) return supported
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ??
      document.createElement('canvas').getContext('webgl')
    supported = !!gl
    // Hand the probe context back so it doesn't count against the page's cap.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    supported = false
  }
  return supported
}
