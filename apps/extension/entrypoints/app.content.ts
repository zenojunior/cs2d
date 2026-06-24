import { defineContentScript } from '#imports'
import type { BlobReply } from '../utils/protocol'

// Bridge into the web app's 2D viewer. When the overlay opens a stored replay,
// the tab lands on the app with `#cs2dv=<matchId>`. We pull the .cs2dv from the
// extension (base64 over runtime, since raw bytes can't cross it), decode it
// here, and hand it to the page as a transferable ArrayBuffer via the app's
// `extensionBridge` protocol (window.postMessage survives the bytes intact).
const EXT = 'cs2dv-extension'
const APP = 'cs2dv-app'

export default defineContentScript({
  matches: ['*://cs2d.app/*', 'http://localhost/*'],
  main() {
    const matchId = new URLSearchParams(location.hash.slice(1)).get('cs2dv')
    if (!matchId) return

    let done = false
    async function deliver() {
      if (done) return
      done = true
      try {
        const reply = (await chrome.runtime.sendMessage({ target: 'background', type: 'GET_BLOB', matchId })) as BlobReply | null
        if (!reply) {
          post({ kind: 'download-error', message: 'replay not found in library' })
          return
        }
        const buffer = decode(reply.base64)
        post({ kind: 'download-start', total: buffer.byteLength })
        // Transfer the buffer to the page (no copy, no corruption).
        window.postMessage({ source: EXT, kind: 'ingest', fileName: reply.fileName, buffer }, location.origin, [buffer])
      } catch (err) {
        post({ kind: 'download-error', message: err instanceof Error ? err.message : String(err) })
      }
    }

    // The app announces `ready` on mount and also answers our `hello`. Either
    // way we deliver on the first `ready`; poll `hello` to cover load-order races.
    window.addEventListener('message', (e: MessageEvent) => {
      if (e.source !== window) return
      if (e.data?.source === APP && e.data?.kind === 'ready') void deliver()
    })
    let tries = 0
    const ping = setInterval(() => {
      if (done || tries++ > 20) return clearInterval(ping)
      post({ kind: 'hello' })
    }, 250)
    post({ kind: 'hello' })
  },
})

function post(msg: Record<string, unknown>) {
  window.postMessage({ source: EXT, ...msg }, location.origin)
}

/** base64 -> ArrayBuffer (mirror of the background's encode). */
function decode(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
