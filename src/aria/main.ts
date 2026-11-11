import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@shared/styles/base.css'
import './styles/aria.css'
import AriaApp from './AriaApp.vue'

// Метка персоны нужна общим стилям (всплывающие окна, лайтбокс) — они подхватывают холодные тона ARIA
document.documentElement.dataset.persona = 'aria'

const app = createApp(AriaApp)
app.use(createPinia())
app.mount('#app')
