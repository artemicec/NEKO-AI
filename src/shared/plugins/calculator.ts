// src/shared/plugins/calculator.ts
//
// Безопасный калькулятор. Раньше выражение исполнялось через new Function(...) — по сути eval
// пользовательского текста. Теперь — собственный токенайзер и рекурсивный разбор:
// никакого исполнения кода, лимиты на длину и глубину.

import type { Plugin } from '@shared/types'

/* ─────────────────────────── Токенайзер ─────────────────────────── */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

const MAX_LEN = 240
const MAX_TOKENS = 200
const MAX_DEPTH = 40

function tokenize(src: string): Tok[] {
  let s = src
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/(?<=[\d)])\s*[xх]\s*(?=[\d(])/gi, '*') // «3 x 4», «3х4»
    .replace(/\*\*/g, '^')
    .replace(/(\d)\s+(?=\d)/g, '$1')                  // «1 000 000» → 1000000
    .trim()

  // Запятая — десятичный разделитель («3,5»), кроме выражений с max/min/pow, где она разделяет аргументы
  const commaIsArgSep = /(?:max|min|pow)\s*\(/i.test(s)
  const numRe = commaIsArgSep ? /^(?:\d+(?:\.\d+)?|\.\d+)/ : /^(?:\d+(?:[.,]\d+)?|[.,]\d+(?=\d))/

  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    const nm = /[\d.,]/.test(c) ? numRe.exec(s.slice(i)) : null
    if (nm) {
      const v = Number(nm[0].replace(',', '.'))
      if (!Number.isFinite(v)) throw new Error('bad number')
      out.push({ t: 'num', v })
      i += nm[0].length
      continue
    }
    if (/\p{L}/u.test(c)) {
      let j = i
      while (j < s.length && /[\p{L}\d_]/u.test(s[j])) j++
      out.push({ t: 'id', v: s.slice(i, j).toLowerCase() })
      i = j
      continue
    }
    if (c === ';') { out.push({ t: 'op', v: ',' }); i++; continue }
    if ('+-*/^%(),'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new Error(`unexpected "${c}"`)
  }
  if (out.length > MAX_TOKENS) throw new Error('too long')
  return out
}

/* ─────────────────────────── Функции и константы ─────────────────────────── */

const CONSTS: Record<string, number> = { pi: Math.PI, пи: Math.PI, e: Math.E, tau: Math.PI * 2 }

const FUNCS: Record<string, { f: (...a: number[]) => number; min: number; max: number }> = {
  sin: { f: Math.sin, min: 1, max: 1 },
  cos: { f: Math.cos, min: 1, max: 1 },
  tan: { f: Math.tan, min: 1, max: 1 },
  tg: { f: Math.tan, min: 1, max: 1 },
  asin: { f: Math.asin, min: 1, max: 1 },
  acos: { f: Math.acos, min: 1, max: 1 },
  atan: { f: Math.atan, min: 1, max: 1 },
  log: { f: Math.log10, min: 1, max: 1 },
  lg: { f: Math.log10, min: 1, max: 1 },
  log2: { f: Math.log2, min: 1, max: 1 },
  ln: { f: Math.log, min: 1, max: 1 },
  sqrt: { f: Math.sqrt, min: 1, max: 1 },
  корень: { f: Math.sqrt, min: 1, max: 1 },
  cbrt: { f: Math.cbrt, min: 1, max: 1 },
  exp: { f: Math.exp, min: 1, max: 1 },
  abs: { f: Math.abs, min: 1, max: 1 },
  floor: { f: Math.floor, min: 1, max: 1 },
  ceil: { f: Math.ceil, min: 1, max: 1 },
  round: { f: Math.round, min: 1, max: 1 },
  trunc: { f: Math.trunc, min: 1, max: 1 },
  sign: { f: Math.sign, min: 1, max: 1 },
  pow: { f: Math.pow, min: 2, max: 2 },
  max: { f: Math.max, min: 1, max: 20 },
  min: { f: Math.min, min: 1, max: 20 },
}

/* ─────────────────────────── Парсер ─────────────────────────── */

interface Val { v: number; pct: boolean }

class Parser {
  private p = 0
  private depth = 0
  constructor(private toks: Tok[]) {}

  parse(): number {
    if (!this.toks.length) throw new Error('empty')
    const r = this.expr()
    if (this.p < this.toks.length) throw new Error('trailing tokens')
    return r.v
  }

  private peek(): Tok | undefined { return this.toks[this.p] }
  private isOp(v: string) { const t = this.peek(); return !!t && t.t === 'op' && t.v === v }

  private enter() { if (++this.depth > MAX_DEPTH) throw new Error('too deep') }
  private leave() { this.depth-- }

  /** a + b%  →  a + a*b/100  (как в обычном калькуляторе) */
  private expr(): Val {
    this.enter()
    let left = this.term()
    for (;;) {
      if (this.isOp('+') || this.isOp('-')) {
        const op = (this.peek() as { v: string }).v
        this.p++
        const right = this.term()
        const r = right.pct ? left.v * right.v : right.v
        left = { v: op === '+' ? left.v + r : left.v - r, pct: false }
      } else break
    }
    this.leave()
    return left
  }

  private term(): Val {
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      if (!t) break
      if (t.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.p++
        const right = this.unary()
        left = { v: t.v === '*' ? left.v * right.v : left.v / right.v, pct: false }
      } else if (t.t === 'id' && (t.v === 'mod' || t.v === 'остаток')) {
        this.p++
        const right = this.unary()
        left = { v: left.v % right.v, pct: false }
      } else if ((t.t === 'op' && t.v === '(') || (t.t === 'id' && t.v !== 'mod' && t.v !== 'остаток')) {
        // неявное умножение: 2(3+4), 2pi, 3sin(1)
        const right = this.unary()
        left = { v: left.v * right.v, pct: false }
      } else break
    }
    return left
  }

  private unary(): Val {
    if (this.isOp('-')) { this.p++; const r = this.unary(); return { v: -r.v, pct: r.pct } }
    if (this.isOp('+')) { this.p++; return this.unary() }
    return this.power()
  }

  private power(): Val {
    const base = this.postfix()
    if (this.isOp('^')) {
      this.p++
      this.enter()
      const exp = this.unary() // правоассоциативно: 2^3^2 = 2^(3^2)
      this.leave()
      return { v: Math.pow(base.v, exp.v), pct: false }
    }
    return base
  }

  private postfix(): Val {
    const prim = this.primary()
    if (this.isOp('%')) {
      this.p++
      return { v: prim / 100, pct: true }
    }
    return { v: prim, pct: false }
  }

  private primary(): number {
    const t = this.peek()
    if (!t) throw new Error('unexpected end')
    this.p++
    if (t.t === 'num') return t.v
    if (t.t === 'op' && t.v === '(') {
      const r = this.expr()
      if (!this.isOp(')')) throw new Error('missing )')
      this.p++
      return r.v
    }
    if (t.t === 'id') {
      if (this.isOp('(')) {
        const fn = FUNCS[t.v]
        if (!fn) throw new Error(`unknown function ${t.v}`)
        this.p++
        const args: number[] = []
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.expr().v)
            if (this.isOp(',')) { this.p++; continue }
            break
          }
        }
        if (!this.isOp(')')) throw new Error('missing )')
        this.p++
        if (args.length < fn.min || args.length > fn.max) throw new Error('bad arity')
        return fn.f(...args)
      }
      if (t.v in CONSTS) return CONSTS[t.v]
      throw new Error(`unknown identifier ${t.v}`)
    }
    throw new Error('unexpected token')
  }
}

/** Вычисляет выражение. Бросает Error при любой проблеме. */
export function evaluate(expression: string): number {
  if (expression.length > MAX_LEN) throw new Error('too long')
  const result = new Parser(tokenize(expression)).parse()
  if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('not finite')
  return result
}

export function formatNumber(n: number): string {
  const rounded = Number(n.toPrecision(12))
  if (Math.abs(rounded) >= 1e15 || (Math.abs(rounded) < 1e-9 && rounded !== 0)) return rounded.toExponential(6)
  return rounded.toLocaleString('ru-RU', { maximumFractionDigits: 10 })
}

/* ─────────────────────────── Плагин ─────────────────────────── */

const KEYWORD =
  /^\s*(?:пожалуйста[,\s]*)?(?:нуу*[,\s]*)?(?:посчитай|подсчитай|вычисли|реши|сколько\s+(?:будет|получится)|калькулятор|calc)\s*:?\s*/i

const PURE_MATH = /^[\d\s+\-*/^().,%×÷−xх]+$/i

/** «20% от 150» → «(20/100)*(150)» */
function expandPercentOf(s: string): string {
  return s.replace(/(\d+(?:[.,]\d+)?)\s*%\s*от\s*([^+\-*/^]+)/gi, '(($1)/100*($2))')
}

function cleanTail(s: string): string {
  return s.replace(/[?!=\s.]+$/g, '').trim()
}

export class CalculatorPlugin implements Plugin {
  name = 'Калькулятор'
  description = 'Математические вычисления'
  icon = '🔢'

  /** Возвращает выражение, если сообщение — это просьба посчитать, иначе null */
  private extract(input: string): { expr: string; explicit: boolean } | null {
    const text = input.trim()
    if (text.length > MAX_LEN + 40) return null

    const kw = text.match(KEYWORD)
    if (kw) {
      const rest = cleanTail(text.slice(kw[0].length))
      if (/\d/.test(rest) || /[a-zа-я]+\s*\(/i.test(rest)) return { expr: rest, explicit: true }
      return null
    }
    const bare = cleanTail(text)
    if (PURE_MATH.test(bare) && /\d/.test(bare) && /[+\-*/^×÷%xх]/i.test(bare.replace(/^-/, ''))) {
      return { expr: bare, explicit: false }
    }
    return null
  }

  matches(input: string): boolean {
    return this.extract(input) !== null
  }

  async execute(input: string): Promise<string> {
    const found = this.extract(input)
    if (!found) return ''
    try {
      const value = evaluate(expandPercentOf(found.expr))
      return `🔢 ${found.expr} = **${formatNumber(value)}**\n\n*Ня~ Математика — это просто!* ✨`
    } catch {
      return found.explicit ? '🔢 Не смогла разобрать выражение. Проверь скобки и знаки — например: «посчитай (12+8)*3».' : ''
    }
  }
}
