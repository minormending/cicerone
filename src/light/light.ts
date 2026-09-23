import type { Passage, Place, Trip } from '../domain/types.ts'
import { bestFacadeWindow, compassName, daylight, goldenHours, solarPosition, type LightWindow } from './sun.ts'

/**
 * The one kind of passage that needs no research and cannot be wrong.
 *
 * Sun azimuth and elevation are a pure function of latitude, longitude and
 * date. Combined with a facade bearing that gives "the west front is lit
 * 16:12–17:04; stand at the northeast corner with the sun behind you" —
 * correct by construction, with no source to cite because nothing was
 * retrieved and no model was in the path.
 *
 * It is also, exactly, the thing the traveller asked for: the spot that is
 * good for a picture, and when.
 */

/** Without a zone, times are estimated from longitude and the passage says so. */
export interface LocalTime {
  text: string
  approximate: boolean
}

export function formatLocal(at: Date, place: Place): LocalTime {
  if (place.timezone) {
    try {
      const text = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: place.timezone,
      }).format(at)
      return { text, approximate: false }
    } catch {
      /* fall through to the longitude estimate */
    }
  }
  const offsetHours = Math.round(place.coords.lon / 15)
  const shifted = new Date(at.getTime() + offsetHours * 3_600_000)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return { text: `${hh}:${mm}`, approximate: true }
}

function range(a: Date, b: Date, place: Place): LocalTime {
  const start = formatLocal(a, place)
  const end = formatLocal(b, place)
  return { text: `${start.text}–${end.text}`, approximate: start.approximate || end.approximate }
}

/** The place's offset from UTC on that date, read back out of its own zone. */
function zoneOffsetMs(at: Date, place: Place): number {
  if (place.timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: place.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(at)
      const hh = Number(parts.find((p) => p.type === 'hour')?.value)
      const mm = Number(parts.find((p) => p.type === 'minute')?.value)
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        const local = hh * 60 + mm
        const utc = at.getUTCHours() * 60 + at.getUTCMinutes()
        let delta = local - utc
        if (delta > 720) delta -= 1440
        if (delta < -720) delta += 1440
        return delta * 60_000
      }
    } catch {
      /* fall through */
    }
  }
  return Math.round(place.coords.lon / 15) * 3_600_000
}

/** When they are actually standing there, as an instant. */
export function arrivalOn(onDate: Date, place: Place): Date | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(place.arrive ?? '')
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined

  const midnightUtc = Date.UTC(onDate.getUTCFullYear(), onDate.getUTCMonth(), onDate.getUTCDate())
  return new Date(midnightUtc + (hours * 60 + minutes) * 60_000 - zoneOffsetMs(onDate, place))
}

function midpoint(window: LightWindow): number {
  return (window.start.getTime() + window.end.getTime()) / 2
}

/** The golden hour they are most likely to care about: the nearest one. */
export function nearestWindow(windows: LightWindow[], arrival: Date | undefined): LightWindow | undefined {
  if (windows.length === 0) return undefined
  // With no time of day recorded, the evening window is the better guess: it
  // is the one people plan around.
  if (!arrival) return windows[windows.length - 1]

  let best = windows[0] as LightWindow
  for (const window of windows) {
    if (arrival >= window.start && arrival <= window.end) return window
    if (Math.abs(arrival.getTime() - midpoint(window)) < Math.abs(arrival.getTime() - midpoint(best))) {
      best = window
    }
  }
  return best
}

function describeGap(minutes: number): string {
  if (minutes < 90) return `${minutes} minutes`
  return `${Math.round(minutes / 60)} hours`
}

/** The day a place falls on, as a date. */
export function dateFor(trip: Trip, place: Place): Date {
  const start = trip.departsOn ? new Date(trip.departsOn) : new Date()
  if (place.dayIndex === undefined) return start
  return new Date(start.getTime() + (place.dayIndex - 1) * 86_400_000)
}

/**
 * A light passage for a place, or nothing.
 *
 * Nothing is the common case and is meant to be: a bakery at 07:45 has no
 * light advice worth the words. This writes only where the sun says something
 * the traveller could act on.
 */
export function lightPassage(trip: Trip, place: Place, now = new Date()): Passage | null {
  const onDate = dateFor(trip, place)
  const day = daylight(onDate, place.coords)
  if (!day) return null

  const lines: string[] = []
  let approximate = false

  if (place.facadeBearing !== undefined) {
    const window = bestFacadeWindow(onDate, place.coords, place.facadeBearing)
    if (window) {
      const r = range(window.start, window.end, place)
      approximate ||= r.approximate
      const mid = new Date(midpoint(window))
      const sun = solarPosition(mid, place.coords)
      lines.push(
        `The ${compassName(place.facadeBearing)}-facing front is lit ${r.text}. Stand to the ${compassName(sun.azimuth)} with the sun behind you.`,
      )
    } else {
      lines.push(
        `The ${compassName(place.facadeBearing)}-facing front stays in shadow all day at this time of year.`,
      )
    }
  }

  const golden = goldenHours(onDate, place.coords)
  const arrival = arrivalOn(onDate, place)
  const chosen = nearestWindow(golden, arrival)

  if (chosen) {
    const r = range(chosen.start, chosen.end, place)
    approximate ||= r.approximate

    if (!arrival) {
      lines.push(`Low warm light ${r.text}.`)
    } else if (arrival >= chosen.start && arrival <= chosen.end) {
      lines.push(`Low warm light ${r.text}, which is when you arrive.`)
    } else {
      // Naming the gap is the useful half. "Low warm light 17:32–18:32" on a
      // card for a 07:45 bakery reads as advice and is not: it is nine hours
      // after they have gone.
      const minutes = Math.round(Math.abs(arrival.getTime() - midpoint(chosen)) / 60_000)
      const when = arrival < chosen.start ? 'after you arrive' : 'before you arrive'
      lines.push(`Low warm light ${r.text}, about ${describeGap(minutes)} ${when}.`)
    }
  }

  if (lines.length === 0) return null

  const body = approximate
    ? `${lines.join(' ')} Times estimated from longitude; no timezone on file for this place.`
    : lines.join(' ')

  return {
    id: `passage:light:${place.id}`,
    subject: { kind: 'place', id: place.id },
    kind: 'look_for',
    title: 'Light and angle',
    body,
    claims: [],
    sources: [],
    writtenAt: now.toISOString().slice(0, 10),
    computed: true,
  }
}

/** Every light passage a trip has. */
export function lightPassages(trip: Trip, now = new Date()): Passage[] {
  const out: Passage[] = []
  for (const place of trip.places) {
    if (place.dayIndex === undefined) continue
    const passage = lightPassage(trip, place, now)
    if (passage) out.push(passage)
  }
  return out
}
