import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

// Standalone app routes: everything revolves around the demo analyzer.
// `/` opens the upload; `/:id` reopens a demo from history; the optional `:tab`
// segment selects a sub-view (`heatmaps` / `grenades`), the 2D replay otherwise.
// The optional `:sub` segment selects a sub-view's own page (e.g. the heatmap
// source: `/:id/heatmaps/kills`).
const routes: RouteRecordRaw[] = [
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
  {
    path: '/:id?/:tab?/:sub?',
    name: 'demoviewer',
    component: () => import('@/viewer/DemoAnalyzerView.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
