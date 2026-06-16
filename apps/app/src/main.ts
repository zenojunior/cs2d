import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { registerDirectives } from './directives'

const app = createApp(App)
app.use(router)
registerDirectives(app)
app.mount('#app')
