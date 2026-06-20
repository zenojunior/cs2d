<script setup lang="ts">
import { useRoute } from 'vue-router'
import Cs2Mark from '@/shell/Cs2Mark.vue'
import UiIcon from '@/ui/UiIcon.vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip'
import { useSidebar } from '@/shell/useSidebar'
import { useI18n } from '@/i18n'

// Compact, collapsible primary nav (VS Code activity-bar style). The collapse
// state is shared (useSidebar) so the top-bar button drives it; when collapsed
// only the icons show and hovering an item reveals its label as a tooltip.
const { t } = useI18n()
const route = useRoute()
const { collapsed } = useSidebar()

// Top: the core tool navigation. The analyzer route ('demoviewer') backs both the
// upload home and the open viewer.
const NAV_TOP = [
  { name: 'demoviewer', to: '/', icon: 'upload', label: 'shell.upload' },
  { name: 'library', to: '/library', icon: 'library', label: 'shell.library' },
] as const

// Footer: secondary destinations (the showcase bracket and the project page).
const NAV_FOOTER = [
  { name: 'major', to: '/cologne-major-2026', icon: 'trophy', label: 'shell.major' },
  { name: 'about', to: '/project', icon: 'book', label: 'shell.project' },
] as const

function itemClass(name: string) {
  return [
    collapsed.value ? 'justify-center px-0' : 'px-3',
    route.name === name
      ? 'bg-ink-800 text-ink-50'
      : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
  ]
}
</script>

<template>
  <aside
    class="flex shrink-0 flex-col border-r border-ink-800/80 bg-ink-950/80 p-2 transition-[width] duration-200"
    :class="collapsed ? 'w-14' : 'w-52'"
  >
    <!-- Brand: icon always visible, title hidden when collapsed -->
    <RouterLink
      to="/"
      :aria-label="t('shell.home')"
      class="flex h-10 items-center gap-2 rounded-md px-1 text-ink-200 transition-colors hover:bg-ink-800"
      :class="collapsed ? 'justify-center' : ''"
    >
      <Cs2Mark size="sm" />
      <span v-if="!collapsed" class="truncate text-sm font-medium">CS Demo Analyzer</span>
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
              <span v-if="!collapsed" class="truncate">{{ t(item.label) }}</span>
            </RouterLink>
          </TooltipTrigger>
          <TooltipContent v-if="collapsed">{{ t(item.label) }}</TooltipContent>
        </Tooltip>
      </nav>

      <!-- Footer: secondary links pinned to the bottom -->
      <nav class="mt-auto flex flex-col gap-1">
        <Tooltip v-for="item in NAV_FOOTER" :key="item.name">
          <TooltipTrigger as-child>
            <RouterLink
              :to="item.to"
              :aria-label="t(item.label)"
              class="flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors"
              :class="itemClass(item.name)"
            >
              <UiIcon :name="item.icon" class="h-4 w-4 shrink-0" />
              <span v-if="!collapsed" class="truncate">{{ t(item.label) }}</span>
            </RouterLink>
          </TooltipTrigger>
          <TooltipContent v-if="collapsed">{{ t(item.label) }}</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  </aside>
</template>
