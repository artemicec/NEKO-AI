// src/shared/plugins/weatherPlugin.ts
// Open-Meteo: геокодинг города + текущая погода и прогноз на 2 дня. Ключ не нужен.
// Раньше координаты были зашиты (Москва) для любого города.

import type { Plugin, PluginContext } from '@shared/types'
import { fetchJson, type FetchLike } from './netUtil'

const WMO: Record<number, string> = {
  0: 'ясно ☀️', 1: 'в основном ясно 🌤️', 2: 'переменная облачность ⛅', 3: 'пасмурно ☁️',
  45: 'туман 🌫️', 48: 'изморозь 🌫️',
  51: 'лёгкая морось 🌦️', 53: 'морось 🌦️', 55: 'сильная морось 🌧️',
  56: 'ледяная морось 🧊', 57: 'сильная ледяная морось 🧊',
  61: 'небольшой дождь 🌦️', 63: 'дождь 🌧️', 65: 'сильный дождь 🌧️',
  66: 'ледяной дождь 🧊', 67: 'сильный ледяной дождь 🧊',
  71: 'небольшой снег 🌨️', 73: 'снег 🌨️', 75: 'сильный снег ❄️', 77: 'снежная крупа ❄️',
  80: 'ливень 🌦️', 81: 'сильный ливень 🌧️', 82: 'очень сильный ливень ⛈️',
  85: 'снегопад 🌨️', 86: 'сильный снегопад ❄️',
  95: 'гроза ⛈️', 96: 'гроза с градом ⛈️', 99: 'сильная гроза с градом ⛈️',
}

export const describeWeatherCode = (code: number) => WMO[code] ?? 'погода неясна 🤷'

/** Извлекает город из фразы. null — это не вопрос про погоду. '' — город не назван. */
export function extractCity(input: string): string | null {
  const text = input.trim()
  if (text.length > 90 || !/погод/i.test(text)) return null
  const m = /погод\p{L}*\s*(?:(?:сейчас|сегодня|завтра|на\s+сегодня|на\s+завтра)\s*)?(?:(?:в|во|на|для)(?=\s)\s*)?(.*)$/iu.exec(text)
  if (!m) return null
  const city = m[1]
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/(?<![\p{L}])(пожалуйста|сегодня|завтра|сейчас|там|у тебя)(?![\p{L}])/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return city
}

/** «Москве» → ['Москве', 'Москв', 'Моск'] — Open-Meteo ищет по префиксу, так что склонения переживаем */
export function cityCandidates(city: string): string[] {
  const out = [city]
  if (city.length > 4) out.push(city.slice(0, -1))
  if (city.length > 5) out.push(city.slice(0, -2))
  return [...new Set(out)]
}

interface GeoResult { name: string; country?: string; admin1?: string; latitude: number; longitude: number }

export class WeatherPlugin implements Plugin {
  name = 'Погода'
  description = 'Прогноз погоды'
  icon = '🌤️'

  constructor(private fetchFn?: FetchLike) {}

  matches(input: string): boolean {
    return extractCity(input) !== null
  }

  private async geocode(city: string, signal?: AbortSignal): Promise<GeoResult | null> {
    for (const q of cityCandidates(city)) {
      const data = await fetchJson<{ results?: GeoResult[] }>(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ru&format=json`,
        { signal, fetchFn: this.fetchFn }
      )
      if (data.results?.length) return data.results[0]
    }
    return null
  }

  async execute(input: string, ctx?: PluginContext): Promise<string> {
    const asked = extractCity(input)
    if (asked === null) return ''
    const city = asked || ctx?.settings.defaultCity || 'Москва'

    try {
      const geo = await this.geocode(city, ctx?.signal)
      if (!geo) return `🌤️ Не нашла город «${city}». Попробуй написать название полностью или по-другому.`

      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
        `&timezone=auto&forecast_days=2&wind_speed_unit=ms`
      const w = await fetchJson<any>(url, { signal: ctx?.signal, fetchFn: this.fetchFn })

      const c = w.current
      const d = w.daily
      const round = (n: number) => Math.round(n)
      const place = [geo.name, geo.country].filter(Boolean).join(', ')
      const day = (i: number, label: string) =>
        `${label}: ${round(d.temperature_2m_min[i])}…${round(d.temperature_2m_max[i])}°C, ${describeWeatherCode(d.weather_code[i])}` +
        (d.precipitation_probability_max?.[i] != null ? `, осадки ${d.precipitation_probability_max[i]}%` : '')

      return (
        `🌤️ **${place}** — сейчас\n\n` +
        `🌡️ **${round(c.temperature_2m)}°C** (ощущается как ${round(c.apparent_temperature)}°C), ${describeWeatherCode(c.weather_code)}\n\n` +
        `💨 ветер ${Math.round(c.wind_speed_10m * 10) / 10} м/с · 💧 влажность ${c.relative_humidity_2m}%\n\n` +
        `📅 ${day(0, 'Сегодня')}\n\n📅 ${day(1, 'Завтра')}\n\n` +
        `*Мяу~ Не забудь одеться по погоде!* 💙`
      )
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e
      return `🌤️ Не получилось узнать погоду для «${city}» — похоже, нет связи с сервисом. Попробуй позже! ✨`
    }
  }
}
