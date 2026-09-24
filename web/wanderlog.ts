import { callFunction } from '../src/backend/client.ts'
import { interpretTripResponse, type TripResponse } from '../src/import/wanderlogApi.ts'

/**
 * Fetching a trip from the page, which cannot ask Wanderlog itself.
 *
 * wanderlog.com sends no Access-Control-Allow-Origin, so the request succeeds
 * on the wire — a 200 with the whole document — and the browser still refuses
 * to hand it over, and the page sees `TypeError: Failed to fetch`. fetchTrip is
 * for the CLI, where there is no same-origin policy to refuse it. Here the
 * `wanderlog-trip` edge function asks on the page's behalf.
 */
export async function fetchTripInBrowser(key: string, call = callFunction): Promise<TripResponse> {
  let res: Response | null
  try {
    res = await call('wanderlog-trip', { key }, AbortSignal.timeout(30_000))
  } catch (err) {
    const name = (err as { name?: string }).name
    return {
      ok: false,
      reason: name === 'TimeoutError' ? 'The import took too long. Try again.' : `request failed: ${(err as Error).message}`,
    }
  }
  if (!res) return { ok: false, reason: 'This build has no backend configured, so it cannot import.' }

  const body = await res.text()

  // The function's own refusals — a malformed key, Wanderlog unreachable —
  // arrive as { error } and say more than the status would.
  if (!res.ok) {
    const said = errorIn(body)
    if (said) return { ok: false, reason: said }
  }

  // Everything else is Wanderlog's body passed through, read by the same rules
  // the CLI reads it by.
  return interpretTripResponse({ status: res.status, contentType: res.headers.get('content-type'), body, key })
}

function errorIn(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    const error = (parsed as { error?: unknown } | null)?.error
    return typeof error === 'string' ? error : null
  } catch {
    return null
  }
}
