// src/aria/format.ts

/** 470 → «470 мс», 1240 → «1,2 с» */
export function formatLatency(ms: number | null): string {
  if (ms === null) return 'нет данных'
  return ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1).replace('.', ',')} с`
}
