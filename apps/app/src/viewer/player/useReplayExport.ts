// Exports the open replay as a shareable `.dca` archive (replay + voice +
// comments) and triggers a browser download. Split out of ViewerStage: it owns
// the in-flight / error state and the download plumbing, driven by getters so it
// stays decoupled from how the stage holds its props.
import { ref } from 'vue'
import type { Replay, ReplayComment, VoiceData } from '@/viewer/domain/schema'
import { exportArchive, archiveFileName } from '@/viewer/ingest/demoArchive'

interface ReplayExportOptions {
  fileName: () => string | undefined
  sourceLabel: () => string | undefined
  replay: () => Replay
  voice: () => VoiceData | null
  comments: () => ReplayComment[]
}

export function useReplayExport(opts: ReplayExportOptions) {
  const exporting = ref(false)
  const exportError = ref<string | null>(null)

  async function exportReplay() {
    if (exporting.value) return
    exporting.value = true
    exportError.value = null
    try {
      const name = opts.fileName() || opts.sourceLabel() || opts.replay().map
      const blob = await exportArchive({
        fileName: opts.fileName() || opts.sourceLabel() || `${opts.replay().map}.dem`,
        replay: opts.replay(),
        voice: opts.voice(),
        comments: opts.comments(),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = archiveFileName(name)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      exportError.value = err instanceof Error ? err.message : String(err)
      console.error('Replay export failed:', err)
    } finally {
      exporting.value = false
    }
  }

  return { exporting, exportError, exportReplay }
}
