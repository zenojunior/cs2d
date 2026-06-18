import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

// Standalone app routes: everything revolves around the demo analyzer.
// `/` opens the upload; `/:id` reopens a demo from history; the optional `:tab`
// segment selects a sub-view (`heatmaps` / `grenades`), the 2D replay otherwise.
const routes: RouteRecordRaw[] = [
  {
    path: '/about',
    name: 'about',
    component: () => import('@/pages/AboutPage.vue'),
  },
  {
    path: '/cologne-major-2026',
    name: 'major',
    component: () => import('@/pages/MajorPage.vue'),
  },
  {
    path: '/:id?/:tab?',
    name: 'demoviewer',
    component: () => import('@/viewer/DemoAnalyzerView.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
