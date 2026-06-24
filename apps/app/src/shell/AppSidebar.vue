<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import Cs2Mark from '@/shell/Cs2Mark.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip'
import { useSidebar } from '@/shell/useSidebar'
import { useI18n } from '@/i18n'

// Compact, collapsible primary nav (VS Code activity-bar style). The collapse
// state is shared (useSidebar) so the top-bar button drives it; when collapsed
// only the icons show and hovering an item reveals its label as a tooltip.
// On mobile the sidebar is an off-canvas drawer (driven by `mobileOpen`) and
// always shows full labels, so it's only ever icon-only on desktop.
const { t } = useI18n()
const route = useRoute()
const { collapsed, mobileOpen } = useSidebar()
const isDesktop = useMediaQuery('(min-width: 640px)')
const iconOnly = computed(() => isDesktop.value && collapsed.value)

// Top: the core tool navigation. The analyzer route ('demoviewer') backs both the
// upload home and the open viewer; the showcase bracket sits alongside them.
const NAV_TOP = [
  { name: 'demoviewer', to: '/', icon: 'upload', label: 'shell.upload' },
  { name: 'library', to: '/library', icon: 'library', label: 'shell.library' },
  { name: 'major', to: '/cologne-major-2026', icon: 'trophy', label: 'shell.major' },
] as const

// Minor links: low-key text links (project + privacy) sat side by side pinned to
// the bottom; collapse to small icons when the sidebar is collapsed.
const MINOR_LINKS = [
  { name: 'about', to: '/project', icon: 'book', label: 'shell.project' },
  { name: 'privacy', to: '/privacy', icon: 'shield', label: 'shell.privacy' },
] as const

function itemClass(name: string) {
  return [
    iconOnly.value ? 'justify-center px-0' : 'px-3',
    route.name === name
      ? 'bg-ink-800 text-ink-50'
      : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
  ]
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-52 shrink-0 flex-col border-r border-ink-800/80 bg-ink-950 p-2 transition-transform duration-200 sm:static sm:z-auto sm:translate-x-0 sm:bg-ink-950/80 sm:transition-[width]"
    :class="[mobileOpen ? 'translate-x-0' : '-translate-x-full', collapsed ? 'sm:w-14' : 'sm:w-52']"
  >
    <!-- Brand: icon always visible, title hidden when collapsed -->
    <RouterLink
      to="/"
      :aria-label="t('shell.home')"
      class="flex h-10 items-center gap-2 rounded-md px-1 text-ink-200 transition-colors hover:bg-ink-800"
      :class="iconOnly ? 'justify-center' : ''"
    >
      <Cs2Mark size="sm" />
      <span v-if="!iconOnly" class="truncate text-sm font-medium">CS Demo Analyzer</span>
    </RouterLink>

    <TooltipProvider>
      <!-- Primary tool navigation -->
      <nav class="mt-2 flex flex-col gap-1">
        <Tooltip v-for="item in NAV_TOP" :key="item.name">
          <TooltipTrigger as-child>
            <RouterLink
              :to="item.to"
              :aria-label="t(item.label)"
              class="flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors"
              :class="itemClass(item.name)"
            >
              <UiIcon :name="item.icon" class="h-4 w-4 shrink-0" />
              <span v-if="!iconOnly" class="truncate">{{ t(item.label) }}</span>
            </RouterLink>
          </TooltipTrigger>
          <TooltipContent v-if="iconOnly">{{ t(item.label) }}</TooltipContent>
        </Tooltip>
      </nav>

      <!-- Footer: minor links (project + privacy) pinned to the bottom -->
      <nav class="mt-auto">
        <div
          class="flex items-center justify-center"
          :class="iconOnly ? 'gap-2' : 'gap-3 px-3'"
        >
          <template v-for="(item, i) in MINOR_LINKS" :key="item.name">
            <span v-if="!iconOnly && i > 0" class="text-ink-700">·</span>
            <Tooltip>
              <TooltipTrigger as-child>
                <RouterLink
                  :to="item.to"
                  :aria-label="t(item.label)"
                  class="transition-colors"
                  :class="
                    route.name === item.name
                      ? 'text-ink-300'
                      : 'text-ink-500 hover:text-ink-300'
                  "
                >
                  <UiIcon v-if="iconOnly" :name="item.icon" class="h-3.5 w-3.5" />
                  <span v-else class="text-xs">{{ t(item.label) }}</span>
                </RouterLink>
              </TooltipTrigger>
              <TooltipContent v-if="iconOnly">{{ t(item.label) }}</TooltipContent>
            </Tooltip>
          </template>
        </div>
      </nav>
    </TooltipProvider>
  </aside>
</template>
