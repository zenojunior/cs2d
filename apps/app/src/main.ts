import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { registerDirectives } from './directives'
import { i18n, i18nReady } from './i18n'

const app = createApp(App)
app.use(router)
app.use(i18n)
registerDirectives(app)

// Mount right away (replacing the inline #app loader) instead of waiting on the
// detected locale, so the UI paints as soon as the bundle is ready. pt is bundled
// so it renders immediately; a non-pt locale swaps in once i18nReady resolves
// (covered by the inline loader, no blank screen). Errors are swallowed: a failed
// locale fetch must not keep the app from mounting.
i18nReady.catch(() => {})
app.mount('#app')
