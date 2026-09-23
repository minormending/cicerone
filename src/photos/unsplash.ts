import type { Coordinates, Photo, Subject } from '../domain/types.ts'
import { metresBetween } from '../corridor/legs.ts'

/**
 * Photographs, and how much their captions are allowed to claim.
 *
 * Unsplash's licence and its API guidelines disagree, and the stricter one
 * governs: the licence says attribution is appreciated but optional, while the
 * API guidelines require crediting the photographer and Unsplash and pinging
 * the download endpoint whenever a photo is used. We pull through the API, so
 * we attribute, and `credit` is not optional on anything found here.
 *
 * The harder rule is about captions. A photograph captioned as a place is a
 * factual claim, and Unsplash matches on user-supplied tags and titles which
 * are frequently approximate and sometimes simply wrong. A confident caption
 * under a picture of the wrong park is the visual form of the confidently
 * wrong operational card the previous app was built to prevent.
 *
 * So a photograph may be captioned by name only when its own coordinates put
 * it at the place. Everything else runs as atmosphere, captioned by city or
 * region, where being generic is honest rather than a hedge.
 */

const API = 'https://api.unsplash.com'

/**
 * How close a photograph's own coordinates must be to earn the place's name.
 *
 * Tight, because this is the whole verification. A hundred and fifty metres in
 * a city centre is the next building, and the next building is the failure
 * this rule exists to prevent.
 */
export const NAMED_METRES = 150

export interface Candidate {
  id: string
  url: string
  thumb: string
  description: string
  credit: { name: string; link: string }
  /** Present on a minority of photographs, and the only thing that verifies one. */
  coords?: Coordinates
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
  location?: { position?: { latitude?: unknown; longitude?: unknown } }
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
    ...(typeof lat === 'number' && typeof lon === 'number' ? { coords: { lat, lon } } : {}),
    downloadLocation: download,
  }
}

/** Search, most relevant first. Never throws: no photograph is a fine answer. */
export async function search(query: string, opts: UnsplashOptions, perPage = 8): Promise<Candidate[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const url = `${API}/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`
  try {
    const res = await doFetch(url, {
      headers: { Authorization: `Client-ID ${opts.accessKey}`, 'Accept-Version': 'v1' },
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    if (!res.ok) return []
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
 * Which of these, if any, has earned the place's own name.
 *
 * Coordinates only. Not the title, not the tags, not the order Unsplash
 * returned them in — those are what put a photograph of the wrong park at the
 * top of the list in the first place.
 */
export function verifiedAt(candidates: Candidate[], at: Coordinates): Candidate | undefined {
  return candidates.find((c) => c.coords && metresBetween(c.coords, at) <= NAMED_METRES)
}

export interface ChosenPhoto {
  photo: Photo
  candidate: Candidate
}

/**
 * The best photograph for a subject, and an honest caption for it.
 *
 * Verified first; failing that the most relevant result, captioned as the
 * region rather than the place. `undefined` when there is nothing, which is
 * an ordinary outcome and not an error.
 */
export function choose(
  subject: Subject,
  candidates: Candidate[],
  at: Coordinates | undefined,
): ChosenPhoto | undefined {
  const verified = at ? verifiedAt(candidates, at) : undefined
  const candidate = verified ?? candidates[0]
  if (!candidate) return undefined

  return {
    candidate,
    photo: {
      subject,
      unsplashId: candidate.id,
      url: candidate.url,
      credit: candidate.credit,
      claim: verified ? 'named' : 'atmosphere',
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
