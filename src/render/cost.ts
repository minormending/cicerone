import type { RouteFact } from '../domain/types.ts'

/**
 * A corridor's figures as the book prints them: "530 m · 6 min", or "15.1 km".
 *
 * One formatter for three readers — the corridor heading, the routine's
 * brief and the review that checks the prose against the heading — because
 * the whole point is that all three say the same thing. A passage that says
 * "twenty minutes" under a heading that says 25 MIN is the book contradicting
 * itself on adjacent lines.
 *
 * Distance always; time only for modes where time means a pace rather than a
 * timetable. Nine minutes across the Old Town will be true next year. Forty-
 * two minutes from the airport is a bus that runs every twenty minutes on a
 * weekday, read on the day of the import.
 */
export function costText(route: RouteFact): string {
  const parts = [distanceText(route.metres)]
  if (route.mode !== 'transit') parts.push(`${routeMinutes(route)} min`)
  return parts.join(' · ')
}

/** Whole minutes, never zero: a thirty-second walk is still a walk. */
export function routeMinutes(route: RouteFact): number {
  return Math.max(1, Math.round(route.seconds / 60))
}

/**
 * Metric, and rounded to what a walk is actually accurate to.
 *
 * The document's own `text` is rendered for the account that owns the trip,
 * which for an American account means a Prague itinerary comes back saying
 * `0.38 mi` about a five-minute walk. Only the raw value is read.
 */
export function distanceText(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.max(10, Math.round(metres / 10) * 10)} m`
}
