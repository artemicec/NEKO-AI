// src/shared/services/sentenceSplitter.ts
// Режет поток токенов на предложения — чтобы озвучка стартовала на первой же фразе,
// а не после полного ответа.

export interface SplitterOptions {
  /** Минимальная длина первого предложения (чтобы начать говорить как можно раньше) */
  firstMin?: number
  /** Минимальная длина остальных (TTS звучит естественнее на длинных кусках) */
  nextMin?: number
  /** Если предложение никак не заканчивается — режем по запятой/пробелу после этой длины */
  hardMax?: number
}

const BOUNDARY = /([.!?…]+["»”')\]]*)(?=\s)|\n+/g

export class SentenceSplitter {
  private buf = ''
  private emitted = 0
  private firstMin: number
  private nextMin: number
  private hardMax: number

  constructor(opts: SplitterOptions = {}) {
    this.firstMin = opts.firstMin ?? 12
    this.nextMin = opts.nextMin ?? 36
    this.hardMax = opts.hardMax ?? 240
  }

  private minLen() {
    return this.emitted === 0 ? this.firstMin : this.nextMin
  }

  private take(end: number, out: string[]) {
    const s = this.buf.slice(0, end).trim()
    this.buf = this.buf.slice(end)
    if (s) {
      out.push(s)
      this.emitted++
    }
  }

  push(delta: string): string[] {
    this.buf += delta
    const out: string[] = []

    for (;;) {
      BOUNDARY.lastIndex = 0
      let cut = -1
      let m: RegExpExecArray | null
      while ((m = BOUNDARY.exec(this.buf))) {
        const end = m.index + m[0].length
        if (this.buf.slice(0, end).trim().length >= this.minLen()) {
          cut = end
          break
        }
      }
      if (cut < 0) break
      this.take(cut, out)
    }

    // Защита от «бесконечного» предложения без знаков препинания
    while (this.buf.length > this.hardMax) {
      const window = this.buf.slice(0, this.hardMax)
      let at = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' — '))
      if (at < this.hardMax / 2) at = window.lastIndexOf(' ')
      if (at <= 0) at = this.hardMax
      this.take(at + 1, out)
    }
    return out
  }

  /** Вызвать, когда поток закончился */
  flush(): string[] {
    const out: string[] = []
    const rest = this.buf.trim()
    this.buf = ''
    if (rest) {
      out.push(rest)
      this.emitted++
    }
    return out
  }
}
