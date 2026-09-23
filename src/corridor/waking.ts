import type { Corridor, Leg, Place, TransportMode, Trip } from '../domain/types.ts'
import { minutesOfDay } from './legs.ts'

/**
 * Which legs are worth writing about, and what can be written about them.
 *
 * A corridor is any leg the traveller is awake for. Not a mode test — a clock
 * test, run against the itinerary's own times. An overnight flight or a
 * sleeper crossing gets nothing at all, because there is no such thing as
 * content for somebody asleep.
 *
 * Within the legs that survive that, one further question decides what kind of
 * passage is even possible: can they see anything?
 *
 *   awake, can see out   walking, tram, bus, car, ferry, rail   passing, event, look_for
 *   awake, cannot        daytime flight, metro, long tunnel     prepare
 *   asleep               red-eye, sleeper                       nothing
 *
 * A daytime flight has no corridor to narrate at cruising altitude, but it is
 * still two hours of somebody's attention and a guide would use them: load
 * something onto your phone before you board, this route runs late, the left
 * side has the mountains on approach.
 */

export interface WakingWindow {
  /** Minutes since local midnight. */
  from: number
  to: number
}

export const DEFAULT_WAKING: WakingWindow = { from: 7 * 60, to: 23 * 60 }

/**
 * A gap this long or shorter means they were awake for it, whatever the hour.
 *
 * The window alone was wrong, and a real itinerary showed it: a four-minute
 * walk between two stops at two in the morning is somebody out late, not
 * somebody asleep. The itinerary is the better witness — if it says they are
 * doing something at 02:00, they are awake — so the window only gets a say
 * once the gap is long enough to have slept through.
 */
export const LONG_GAP_MINUTES = 180

/** Modes with nothing to look at, whatever the hour. */
const ENCLOSED: ReadonlySet<TransportMode> = new Set<TransportMode>(['flight', 'metro'])

/**
 * Awake for the middle of it?
 *
 * The midpoint rather than any overlap, because overlap says yes to a red-eye
 * that lands at 07:10. What matters is whether they were conscious for the
 * bulk of it, and the middle is the cheapest honest proxy.
 *
 * A leg with no times on either end counts as awake. Most stops on a real
 * itinerary carry no clock at all, and silence about the whole trip is a
 * worse failure than a passage nobody happens to read.
 */
export function awakeFor(leg: Leg, window: WakingWindow = DEFAULT_WAKING): boolean {
  const start = minutesOfDay(leg.departAt)
  const end = minutesOfDay(leg.arriveAt)
  if (start === undefined && end === undefined) return true

  // One end only: judge on the end we have.
  if (start === undefined) return inside(end as number, window)
  if (end === undefined) return inside(start, window)

  const span = end >= start ? end - start : end - start + 1440
  if (span <= LONG_GAP_MINUTES) return true

  const middle = (start + span / 2) % 1440
  return inside(middle, window)
}

function inside(minute: number, window: WakingWindow): boolean {
  return window.from <= window.to
    ? minute >= window.from && minute <= window.to
    : minute >= window.from || minute <= window.to
}

/** Whether there is anything out of the window. */
export function viewFrom(mode: TransportMode): Corridor['view'] {
  return ENCLOSED.has(mode) ? 'enclosed' : 'open'
}

export interface CorridorOptions {
  waking?: WakingWindow
}

/**
 * The corridors of a trip.
 *
 * Walking legs carry no minimum duration: a twelve-minute walk between two
 * stops is the densest corridor there is — street level, slow, nothing
 * between the traveller and the thing worth pointing at — and a floor would
 * throw away the best material on a city itinerary. No minimum *duration*,
 * note: walks obey the clock like everything else. Exempting them entirely
 * turned the gap between Tuesday's dinner and Wednesday's bakery into a
 * two-kilometre stroll that nobody took.
 *
 * A leg across a day boundary needs both its times before it can be believed.
 * Days are joined so that an overnight flight has somewhere to live, but most
 * of what that join produces is a night in a hotel wearing a journey's
 * clothes, and without a departure there is no way to tell the two apart.
 */
export function corridorsOf(trip: Trip, opts: CorridorOptions = {}): Corridor[] {
  const window = opts.waking ?? DEFAULT_WAKING
  const byId = new Map(trip.places.map((p) => [p.id, p]))

  const out: Corridor[] = []
  for (const leg of trip.legs) {
    const from = byId.get(leg.fromPlaceId)
    const to = byId.get(leg.toPlaceId)
    if (!from || !to) continue

    const overnight = from.dayIndex !== undefined && to.dayIndex !== undefined && from.dayIndex !== to.dayIndex
    if (overnight && !(leg.departAt && leg.arriveAt)) continue
    if (!awakeFor(leg, window)) continue

    const corridor: Corridor = {
      id: `corridor:${leg.id.replace(/^leg:/, '')}`,
      legId: leg.id,
      fromPlaceId: leg.fromPlaceId,
      toPlaceId: leg.toPlaceId,
      mode: leg.mode,
      view: viewFrom(leg.mode),
    }
    const day = dayOf(from, to)
    if (day !== undefined) corridor.dayIndex = day
    out.push(corridor)
  }
  return out
}

/** A corridor belongs to the day it starts on. */
function dayOf(from: Place, to: Place): number | undefined {
  return from.dayIndex ?? to.dayIndex
}
