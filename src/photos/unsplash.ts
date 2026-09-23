import type { Coordinates, Photo, Subject } from '../domain/types.ts'

/**
 * Photographs, and how much their captions are allowed to claim.
 *
 * Unsplash's licence and its API guidelines disagree, and the stricter one
 * governs: the licence says attribution is appreciated but optional, while the
 * API guidelines require crediting the photographer and Unsplash and pinging
 * the download endpoint whenever a photo is used. We pull through the API, so
 * we attribute, and `credit` is not optional on anything found here.
 *
 * The rule about captions survived contact with the live API; the mechanism
 * for it did not.
 *
 * The rule: a photograph captioned as a place is a factual claim, so a caption
 * may only claim what can be checked. The mechanism was going to be
 * coordinates — a picture earns a place's name when its own `position` puts it
 * within 150 m. Across four searches of Prague landmarks, not one of thirty-two
 * results carried coordinates at all. `position` is null on effectively
 * everything, and a rule that never fires is not a strict rule but a dead one.
 *
 * The photographer's own `location.name` looked like the answer — "Charles
 * bridge, Prague, Czechia" is a statement about where somebody stood rather
 * than about what a picture is of. It is not enough either, and the reason is
 * simpler than the matching: **nothing automatic gets to claim a name here.**
 * A location string is still free text somebody typed, and the failure it
 * would produce — a confident caption under a photograph of the wrong park —
 * is exactly what the rule exists to prevent.
 *
 * So the settled design is smaller than the one it replaced. Anything found by
 * searching is **atmosphere**, captioned by city, where being generic is
 * honest. A name requires a person: either the traveller's own photograph, or
 * one they picked in the swap dialog, having looked at it.
 *
 * `location` is still read, and shown to whoever is choosing. It is good
 * evidence for a human and insufficient evidence for a machine, which is the
 * whole distinction.
 */

const API = 'https://api.unsplash.com'

export interface Candidate {
  id: string
  url: string
  thumb: string
  description: string
  credit: { name: string; link: string }
  /** Almost never present in practice. Verifies a photograph outright. */
  coords?: Coordinates
  /** What the photographer said about where it was taken. */
  where?: string
  /** The photographer's own tags. Evidence about the picture, not the query. */
  tags?: string[]
  downloadLocation: string
}

export interface UnsplashOptions {
  accessKey: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

interface RawPhoto {
  id?: unknown
  description?: unknown
  alt_description?: unknown
  urls?: { regular?: unknown; small?: unknown }
  links?: { download_location?: unknown; html?: unknown }
  user?: { name?: unknown; links?: { html?: unknown } }
  location?: {
    name?: unknown
    city?: unknown
    position?: { latitude?: unknown; longitude?: unknown }
  }
  tags?: Array<{ title?: unknown }>
}

function toCandidate(raw: RawPhoto): Candidate | null {
  const id = raw.id
  const url = raw.urls?.regular
  const thumb = raw.urls?.small
  const name = raw.user?.name
  const profile = raw.user?.links?.html
  const download = raw.links?.download_location
  if (
    typeof id !== 'string' ||
    typeof url !== 'string' ||
    typeof thumb !== 'string' ||
    typeof name !== 'string' ||
    typeof profile !== 'string' ||
    typeof download !== 'string'
  ) {
    return null
  }

  const lat = raw.location?.position?.latitude
  const lon = raw.location?.position?.longitude
  const where = [raw.location?.name, raw.location?.city]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(', ')
  const tags = (raw.tags ?? [])
    .map((t) => t?.title)
    .filter((t): t is string => typeof t === 'string')
  const description =
    (typeof raw.description === 'string' && raw.description) ||
    (typeof raw.alt_description === 'string' && raw.alt_description) ||
    ''

  return {
    id,
    url,
    thumb,
    description,
    credit: { name, link: profile },
    // 0,0 comes back for a photograph with no location rather than null, and
    // Null Island is not where anybody stood.
    ...(typeof lat === 'number' && typeof lon === 'number' && (lat !== 0 || lon !== 0)
      ? { coords: { lat, lon } }
      : {}),
    ...(where ? { where } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    downloadLocation: download,
  }
}

/**
 * Thrown when the hour's requests are gone.
 *
 * Distinct from finding nothing, and the distinction is the point: an empty
 * result is a fine answer and being out of budget is not. Swallowing it
 * printed "0 photographs" over a trip whose pictures were simply never asked
 * for, which is the least useful thing a tool can say.
 */
export class RateLimited extends Error {
  constructor() {
    super('Unsplash rate limit reached — the Demo tier allows 50 requests an hour. Try again later.')
    this.name = 'RateLimited'
  }
}

/** Search, most relevant first. Empty is a fine answer; out of budget is not. */
export async function search(query: string, opts: UnsplashOptions, perPage = 8): Promise<Candidate[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const url = `${API}/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { Authorization: `Client-ID ${opts.accessKey}`, 'Accept-Version': 'v1' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  } catch {
    return []
  }
  if (res.status === 403 && res.headers?.get('x-ratelimit-remaining') === '0') throw new RateLimited()
  if (!res.ok) return []
  try {
    const body = (await res.json()) as { results?: RawPhoto[] }
    return (body.results ?? []).map(toCandidate).filter((c): c is Candidate => c !== null)
  } catch {
    return []
  }
}

/**
 * Required by the API guidelines whenever a photograph is actually used.
 *
 * Fire-and-forget: it reports usage to the photographer and failing it must
 * never cost the traveller their picture.
 */
export async function trackDownload(candidate: Candidate, opts: UnsplashOptions): Promise<void> {
  const doFetch = opts.fetchImpl ?? fetch
  try {
    await doFetch(candidate.downloadLocation, {
      headers: { Authorization: `Client-ID ${opts.accessKey}`, 'Accept-Version': 'v1' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  } catch {
    /* the picture is still fine */
  }
}

/**
 * Everything the photograph itself says about where it was taken.
 *
 * A separate request, because the search response omits `location` entirely.
 * Called only for the photograph actually kept.
 */
export async function describe(candidate: Candidate, opts: UnsplashOptions): Promise<Candidate> {
  const doFetch = opts.fetchImpl ?? fetch
  try {
    const res = await doFetch(`${API}/photos/${encodeURIComponent(candidate.id)}`, {
      headers: { Authorization: `Client-ID ${opts.accessKey}`, 'Accept-Version': 'v1' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) return candidate
    const full = toCandidate((await res.json()) as RawPhoto)
    // The search result keeps its own urls; only the location is wanted here.
    return full ? { ...candidate, ...(full.coords ? { coords: full.coords } : {}), ...(full.where ? { where: full.where } : {}) } : candidate
  } catch {
    return candidate
  }
}

export interface ChosenPhoto {
  photo: Photo
  candidate: Candidate
}

/**
 * The most relevant photograph, captioned as atmosphere.
 *
 * `undefined` when there is nothing, which is an ordinary outcome and not an
 * error — several stops on a real trip have no photograph anywhere.
 */
export function choose(subject: Subject, candidates: Candidate[]): ChosenPhoto | undefined {
  const candidate = candidates[0]
  if (!candidate) return undefined

  return {
    candidate,
    photo: {
      subject,
      unsplashId: candidate.id,
      url: candidate.url,
      credit: candidate.credit,
      // Always. Nothing found by searching gets to claim a name.
      claim: 'atmosphere',
      chosenBy: 'auto',
    },
  }
}

/**
 * A photograph a person picked is one a person vouched for.
 *
 * This is the mitigation the whole matching rule leans on. Automated matching
 * will be wrong sometimes and no amount of verification makes it always right;
 * what makes that acceptable is that somebody who knows what the place looks
 * like can fix it in one tap — and having looked at it, they have supplied
 * exactly the evidence coordinates were standing in for.
 */
export function vouchedFor(subject: Subject, candidate: Candidate): Photo {
  return {
    subject,
    unsplashId: candidate.id,
    url: candidate.url,
    credit: candidate.credit,
    claim: 'named',
    chosenBy: 'person',
  }
}
