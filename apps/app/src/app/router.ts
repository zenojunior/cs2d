import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { APP_HOME, UPLOAD_PATH } from '@/app/paths'
import { hasUsedApp, isStandalone, markAppUsed } from '@/app/firstVisit'

// `/` is the landing, shown to first-time visitors only (an installed PWA or a
// returning user goes straight to `/app`). The analyzer runs under `/app`:
// `/app` redirects to `/app/upload`; `/app/:id` reopens a demo from history; the
// optional `:tab` segment selects a sub-view (`heatmaps` / `grenades`), the 2D
// replay otherwise. The optional `:sub` segment selects a sub-view's own page
// (e.g. the heatmap source: `/app/:id/heatmaps/kills`).
const Analyzer = () => import('@/viewer/DemoAnalyzerView.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'landing',
    component: () => import('@/pages/LandingPage.vue'),
    beforeEnter: (to) => {
      // `/?landing` is the explicit way back (the sidebar logo), for anyone.
      if ('landing' in to.query) return true
      // Old links put the analyzer's params on `/` (`/?replay=…`, `/?tab=…`).
      if (Object.keys(to.query).length) return { path: UPLOAD_PATH, query: to.query, hash: to.hash }
      if (isStandalone() || hasUsedApp()) return APP_HOME
      return true
    },
  },
  { path: APP_HOME, redirect: UPLOAD_PATH },
  { path: UPLOAD_PATH, name: 'demoviewer', component: Analyzer },
  {
    path: '/project',
    name: 'about',
    component: () => import('@/pages/AboutPage.vue'),
  },
  {
    path: '/privacy',
    name: 'privacy',
    component: () => import('@/pages/PrivacyPage.vue'),
  },
  {
    path: '/tournaments',
    name: 'tournaments',
    component: () => import('@/pages/tournaments/TournamentsPage.vue'),
  },
  {
    path: '/tournaments/:year/:slug',
    name: 'tournament',
    component: () => import('@/pages/tournaments/TournamentPage.vue'),
  },
  // Legacy slug for the Cologne major; keep it redirecting so old links/bookmarks
  // still resolve to the tournament's new home.
  { path: '/cologne-major-2026', redirect: '/tournaments/2026/major-cologne' },
  {
    path: '/library',
    name: 'library',
    component: () => import('@/pages/LibraryPage.vue'),
  },
  { path: `${APP_HOME}/:id/:tab?/:sub?`, name: 'demo', component: Analyzer },
  // Legacy: demos used to live at the root (`/:id/:tab?/:sub?`). Old bookmarks
  // and shared links keep resolving.
  {
    path: '/:id/:tab?/:sub?',
    redirect: (to) => ({
      path: [APP_HOME, to.params.id, to.params.tab, to.params.sub].filter(Boolean).join('/'),
      query: to.query,
      hash: to.hash,
    }),
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Opening the app (or its sibling hubs) retires the landing for this visitor.
const APP_PATH = /^\/(app|library|tournaments)(\/|$)/
router.afterEach((to) => {
  if (APP_PATH.test(to.path)) markAppUsed()
})

export default router
