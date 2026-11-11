import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@shared/styles/base.css'

import MainApp from './MainApp.vue'
import ChatApp from './ChatApp.vue'
import SettingsApp from './SettingsApp.vue'

const params = new URLSearchParams(window.location.search)
const win = params.get('window') || 'main'

let RootComponent
if (win === 'chat') RootComponent = ChatApp
else if (win === 'settings') RootComponent = SettingsApp
else RootComponent = MainApp

const app = createApp(RootComponent)
app.use(createPinia())
app.mount('#app')