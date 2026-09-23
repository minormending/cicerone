import type { Place, Source } from '../domain/types.ts'

/**
 * What Wanderlog already knows about a place, and which parts of it are usable.
 *
 * `getPlaceDetailsAndCardData` returns, for a Google place id, everything
 * Wanderlog shows on a place card. Most of it is no use here and one part of
 * it is the best research material in the project.
 *
 * **Used: `sources`.** Each carries a publisher, a URL and a snippet of the
 * actual sentence — Lonely Planet on the cellar bar, expats.cz on the building
 * having been a winery and a pub from 1862, National Geographic on where
 * locals drink. That is exactly the shape a claim needs: the snippet is the
 * support, the URL is the source. Across one Prague trip it comes to over a
 * thousand snippets, and its distribution is honest — Charles Bridge has three
 * hundred, the hotel has none.
 *
 * **Not used: `reviewsSummary`, `reasonsToVisit`, `tips`, `assistantQuestions`.**
 * Those are written by a model, and citing them would launder generated text
 * through a citation — a passage that looks sourced and is not, which is the
 * precise failure the whole claim system exists to prevent. They are dropped
 * rather than downgraded, so nobody can reach for them by accident.
 *
 * `menuItems` comes through as plain names, marked as a hint rather than a
 * source: knowing a kitchen serves svíčková is a fact about the place, and it
 * is not a citation.
 *
 * On manners: this is an undocumented endpoint on somebody else's service. It
 * needs no authentication, but Wanderlog's terms are not an invitation to
 * crawl it. One pass over one trip's stops, paced, for the traveller who
 * already has that trip open in their own account.
 */

const CARD_API = 'https://wanderlog.com/api/placesAPI/getPlaceDetailsAndCardData'

export interface PlaceSource extends Source {
  /** The publisher, as Wanderlog names it. */
  publisher: string
  /** The sentence about this place. Support for a claim, not prose to reuse. */
  snippet: string
}

export interface PlaceResearch {
  placeId: string
  name: string
  /** What a kitchen serves. A hint, not a citation. */
  dishes: string[]
  sources: PlaceSource[]
}

interface RawSource {
  url?: unknown
  snippet?: unknown
  siteName?: unknown
  shortName?: unknown
}

interface RawCard {
  data?: {
    details?: { name?: unknown }
    cardData?: {
      sources?: RawSource[]
      menuItems?: Array<{ name?: unknown }>
    }
  }
}

export interface FetchOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  retrieved?: string
}

/**
 * Everything citable Wanderlog holds about one place.
 *
 * A source with no snippet is dropped: a bare link is not evidence for
 * anything, and a list of them invites citing a page nobody read.
 */
export async function researchFor(
  placeId: string,
  opts: FetchOptions = {},
): Promise<PlaceResearch | null> {
  const doFetch = opts.fetchImpl ?? fetch
  const retrieved = opts.retrieved ?? new Date().toISOString().slice(0, 10)

  let body: RawCard
  try {
    const res = await doFetch(`${CARD_API}?placeId=${encodeURIComponent(placeId)}&language=en`, {
      headers: { accept: 'application/json', 'user-agent': 'cicerone, github.com/minormending/cicerone' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) return null
    body = (await res.json()) as RawCard
  } catch {
    return null
  }

  const name = body.data?.details?.name
  if (typeof name !== 'string') return null

  const seen = new Set<string>()
  const sources: PlaceSource[] = []
  for (const raw of body.data?.cardData?.sources ?? []) {
    const url = raw.url
    const snippet = raw.snippet
    if (typeof url !== 'string' || typeof snippet !== 'string' || !snippet.trim()) continue
    if (seen.has(url)) continue
    seen.add(url)
    sources.push({
      url,
      title: typeof raw.shortName === 'string' ? raw.shortName : url,
      publisher: typeof raw.siteName === 'string' ? raw.siteName : new URL(url).hostname,
      snippet: snippet.trim(),
      retrieved,
    })
  }

  const dishes = (body.data?.cardData?.menuItems ?? [])
    .map((m) => m?.name)
    .filter((n): n is string => typeof n === 'string' && n.toLowerCase() !== 'menu')

  return { placeId, name, dishes, sources }
}

export interface ResearchOptions extends FetchOptions {
  /** Between requests. Somebody else's service, asked politely. */
  minIntervalMs?: number
  onProgress?: (done: number, total: number, withSources: number) => void
}

/** One pass over a trip's stops. Places with no place id are skipped. */
export async function researchTrip(
  places: Place[],
  opts: ResearchOptions = {},
): Promise<Map<string, PlaceResearch>> {
  const wait = opts.minIntervalMs ?? 700
  const out = new Map<string, PlaceResearch>()
  const byPlaceId = new Map<string, PlaceResearch | null>()

  const scheduled = places.filter((p) => p.dayIndex !== undefined && p.placeId)
  let done = 0
  let withSources = 0

  for (const place of scheduled) {
    if (opts.signal?.aborted) break
    const id = place.placeId as string

    // The same hotel on four days is one request, not four.
    if (!byPlaceId.has(id)) {
      if (done > 0) await new Promise((r) => setTimeout(r, wait))
      byPlaceId.set(id, await researchFor(id, opts))
    }

    const found = byPlaceId.get(id)
    if (found && found.sources.length > 0) {
      if (!out.has(place.id)) withSources++
      out.set(place.id, found)
    }
    done++
    opts.onProgress?.(done, scheduled.length, withSources)
  }

  return out
}
