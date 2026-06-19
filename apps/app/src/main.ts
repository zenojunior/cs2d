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

// Wait for the detected locale's messages to load before painting, so the app
// shows the right language instead of flashing the pt fallback.
i18nReady.then(() => app.mount('#app'))
