import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUIStore = defineStore('ui', () => {
  const inputText = ref('')
  const setInputText = (text: string) => { inputText.value = text }
  return { inputText, setInputText }
})