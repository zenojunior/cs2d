<script setup lang="ts">
import { ref } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import UiIcon from '@/ui/UiIcon.vue'
import { useI18n } from '@/app/i18n'

/**
 * Small toast for the service worker lifecycle. `offlineReady` shows once the
 * app shell and assets are cached (it then works without a network); `needRefresh`
 * prompts the user to reload when a new build is available. We use `prompt`
 * registration (not autoUpdate) so an update never reloads mid-analysis.
 */
const { t } = useI18n()
const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW()

const reloading = ref(false)

async function reload() {
  if (reloading.value) return
  reloading.value = true
  try {
    await updateServiceWorker(true)
  } catch {
    // Fallback below still forces a reload.
  }
  // Force a reload if controllerchange never fires, so the click is never a no-op.
  window.setTimeout(() => window.location.reload(), 3000)
}

function dismiss() {
  offlineReady.value = false
  needRefresh.value = false
}
</script>

<template>
  <Transition name="pwa-toast">
    <div
      v-if="offlineReady || needRefresh"
      class="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-white/10 bg-[#11141d] px-4 py-3 text-sm text-white shadow-lg"
      role="status"
    >
      <span>{{ needRefresh ? t('pwa.updateAvailable') : t('pwa.offlineReady') }}</span>
      <button
        v-if="needRefresh"
        class="flex items-center gap-1.5 rounded-md bg-[#FDAC1A] px-3 py-1 font-medium text-black transition hover:brightness-110 disabled:cursor-default disabled:opacity-80 disabled:hover:brightness-100"
        :disabled="reloading"
        @click="reload"
      >
        <UiIcon v-if="reloading" name="loader" class="h-3.5 w-3.5 animate-spin" />
        {{ reloading ? t('pwa.reloading') : t('pwa.reload') }}
      </button>
      <button
        v-if="!reloading"
        class="rounded-md px-2 py-1 text-white/60 transition hover:text-white"
        @click="dismiss"
      >
        {{ t('pwa.dismiss') }}
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.pwa-toast-enter-active,
.pwa-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.pwa-toast-enter-from,
.pwa-toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
