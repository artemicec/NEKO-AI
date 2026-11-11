// src/neko/services/imageFile.ts
// Подготовка пользовательского фото для дневника: уменьшаем до разумного размера и пережимаем в JPEG,
// чтобы папка дневника не раздувалась от 12-мегапиксельных снимков.

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024

export async function fileToDataUrl(file: File, maxSide = 1600, quality = 0.9): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Это не изображение')
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Файл слишком большой (максимум 25 МБ)')

  const bitmap = await createImageBitmap(file)
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * k))
    const h = Math.max(1, Math.round(bitmap.height * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось подготовить изображение')
    ctx.fillStyle = '#ffffff' // у PNG/GIF с прозрачностью фон иначе стал бы чёрным
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}
