import { supabase } from '../src/backend/client.ts'
import { Store, type SavedTrip } from '../src/backend/store.ts'
import { corridorsOf } from '../src/corridor/waking.ts'
import { withLegs } from '../src/corridor/legs.ts'
import { renderBook } from '../src/render/book.ts'
import { dayIndexFor, renderNow, whereAt } from '../src/render/now.ts'
import { cityFrom } from '../src/photos/illustrate.ts'
import { describe, search, trackDownload, vouchedFor, type Candidate } from '../src/photos/unsplash.ts'
import { fetchTripInBrowser } from './wanderlog.ts'
import { tripFromWanderlog } from '../src/import/wanderlog.ts'
import type { Corridor, Guide, Subject, Trip } from '../src/domain/types.ts'
import { mountAuth } from './auth.ts'
import { mountBuildTag } from './build.ts'

declare const __UNSPLASH_KEY__: string

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const authPane = $<HTMLDivElement>('auth')
const intro = $<HTMLDivElement>('intro')
const introNote = $<HTMLParagraphElement>('intro-note')
const tripsPane = $<HTMLDivElement>('trips')
const keyField = $<HTMLInputElement>('key')
const importBtn = $<HTMLButtonElement>('import')
const status = $<HTMLParagraphElement>('status')
const controls = $<HTMLDivElement>('controls')
const modeBtn = $<HTMLButtonElement>('mode')
const claimsBtn = $<HTMLButtonElement>('claims')
const printBtn = $<HTMLButtonElement>('print')
const backBtn = $<HTMLButtonElement>('back')
const book = $<HTMLElement>('book')
const nowPane = $<HTMLDivElement>('now')

const swapDialog = $<HTMLDialogElement>('swap')
const swapSubject = $<HTMLParagraphElement>('swap-subject')
const swapNote = $<HTMLParagraphElement>('swap-note')
const swapGrid = $<HTMLDivElement>('swap-grid')
const swapQuery = $<HTMLInputElement>('swap-q')
const swapSearch = $<HTMLButtonElement>('swap-search')
const swapClose = $<HTMLButtonElement>('swap-close')

let store: Store | null = null
let open: { saved: SavedTrip; trip: Trip; corridors: Corridor[]; guide: Guide } | null = null
let companion = false

function setStatus(text: string): void {
  status.textContent = text
}

const unsplashKey = (): string => (typeof __UNSPLASH_KEY__ === 'string' ? __UNSPLASH_KEY__ : '')

/* ---------------------------------------------------------------- trips */

async function showTrips(): Promise<void> {
  open = null
  companion = false
  book.replaceChildren()
  nowPane.hidden = true
  controls.hidden = true
  intro.hidden = false
  tripsPane.replaceChildren()
  if (!store) return

  setStatus('Reading your account…')
  const trips = await store.listTrips()
  setStatus('')

  if (trips.length === 0) {
    introNote.textContent = 'Nothing imported yet.'
    return
  }
  introNote.textContent = ''

  for (const trip of trips) {
    const row = document.createElement('button')
    row.type = 'button'
    const title = document.createElement('div')
    title.textContent = trip.title
    const when = document.createElement('div')
    when.className = 'when'
    when.textContent = `${trip.departsOn ?? 'no date'} · ${trip.graph.places.filter((p) => p.dayIndex !== undefined).length} stops`
    row.append(title, when)
    row.addEventListener('click', () => void openTrip(trip.id))
    tripsPane.append(row)
  }
}

async function openTrip(id: string): Promise<void> {
  if (!store) return
  setStatus('Opening…')
  const saved = await store.getTrip(id)
  if (!saved) {
    setStatus('That trip is gone.')
    return
  }

  const trip = withLegs(saved.graph)
  const guide = await store.getGuide(id)
  open = { saved, trip, corridors: corridorsOf(trip), guide }

  intro.hidden = true
  controls.hidden = false
  setStatus(
    guide.passages.length === 0
      ? 'No guide yet. The routine writes one the next time it runs.'
      : '',
  )
  history.replaceState(null, '', `#${id}`)
  render()
}

declare global {
  interface Window {
    /** Installed by MAP_JS, inlined in index.html. Absent if that script failed. */
    ciceroneMaps?: () => void
  }
}

function render(): void {
  if (!open) return
  const { trip, guide, corridors } = open

  if (companion) {
    const now = new Date()
    const dayIndex = dayIndexFor(trip, now) ?? 1
    const minute = now.getHours() * 60 + now.getMinutes()
    nowPane.innerHTML = renderNow(guide, whereAt(trip, corridors, { dayIndex, minute }))
    nowPane.hidden = false
    book.hidden = true
  } else {
    book.innerHTML = renderBook(trip, guide, { corridors, ...(cityFrom(trip) ? { city: cityFrom(trip) as string } : {}) })
    book.hidden = false
    nowPane.hidden = true
    // The routes arrived with that innerHTML, so the maps have to be mounted
    // again; the script itself is inlined in the shell and loads the library
    // the first time it finds one.
    window.ciceroneMaps?.()
  }
  modeBtn.textContent = companion ? 'The book' : 'Where I am now'
}

/* ---------------------------------------------------------------- import */

async function runImport(pasted: string): Promise<void> {
  if (!store) return
  const key = pasted.trim().replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? ''
  if (!key) {
    introNote.textContent = 'Paste the trip link or key first.'
    return
  }

  importBtn.disabled = true
  setStatus('Fetching the trip…')
  try {
    const fetched = await fetchTripInBrowser(key)
    if (!fetched.ok) {
      introNote.textContent = fetched.reason
      setStatus('')
      return
    }

    const { trip, report } = tripFromWanderlog(fetched.document, {})
    const scheduled = report.places - report.unscheduled
    if (scheduled === 0) {
      introNote.textContent = 'That trip has no stops on any day yet.'
      setStatus('')
      return
    }

    // Through importTrip, never saveTrip: pasting the link of a trip that
    // already has a book is how people update it, and a plain save would
    // strand every passage whose stop had moved.
    const result = await store.importTrip({
      title: trip.title,
      ...(trip.departsOn ? { departsOn: trip.departsOn } : {}),
      source: 'wanderlog',
      sourceKey: key,
      graph: withLegs(trip),
    })
    keyField.value = ''
    await openTrip(result.id)
    if (result.created) {
      setStatus(`Imported ${scheduled} stops. The guide is written by the routine, not here — it takes a while.`)
    } else {
      const added = result.reconciliation.added.length
      const setAside = result.plan.retire.length
      setStatus(
        `Updated. ${added === 0 ? 'Nothing new to write' : `${added} new ${added === 1 ? 'stop or walk' : 'stops and walks'} for the routine to write`}` +
          (setAside ? `; ${setAside} passage${setAside === 1 ? '' : 's'} set aside for stops that left the trip` : '') +
          '.',
      )
    }
  } catch (err) {
    introNote.textContent = `Could not import: ${(err as Error).message}`
    setStatus('')
  } finally {
    importBtn.disabled = false
  }
}

/* ------------------------------------------------------------ swap photo */

let swapping: { subject: Subject; candidates: Candidate[]; picked: number } | null = null

function subjectName(subject: Subject): string {
  if (!open) return ''
  if (subject.kind === 'place') return open.trip.places.find((p) => p.id === subject.id)?.name ?? subject.id
  const corridor = open.corridors.find((c) => c.id === subject.id)
  const to = open.trip.places.find((p) => p.id === corridor?.toPlaceId)
  return to ? `on the way to ${to.name}` : subject.id
}

function drawCandidates(): void {
  swapGrid.replaceChildren()
  if (!swapping) return

  swapping.candidates.forEach((candidate, index) => {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.setAttribute('aria-pressed', String(index === swapping?.picked))
    cell.setAttribute('aria-label', candidate.description || 'Unsplash photograph')

    const img = document.createElement('img')
    img.src = candidate.thumb
    img.alt = ''
    img.loading = 'lazy'

    const tag = document.createElement('span')
    tag.className = 'tag'
    // Where the photographer said they stood. Good evidence for the person
    // choosing, and not enough for anything automatic — which is why this is
    // shown rather than acted on. Coordinates are null on almost everything.
    tag.textContent = candidate.where ?? 'location not given'

    cell.append(img, tag)
    cell.addEventListener('click', () => {
      if (!swapping) return
      swapping.picked = index
      drawCandidates()
      describeChoice()
    })
    swapGrid.append(cell)
  })
}

function describeChoice(): void {
  if (!swapping || !open) return
  const candidate = swapping.candidates[swapping.picked]
  if (!candidate) {
    swapNote.textContent = 'Nothing found. Try another search.'
    return
  }
  // Picking by hand is what makes the whole matching rule survivable: somebody
  // who knows what the place looks like supplies the evidence coordinates
  // were standing in for.
  swapNote.textContent = candidate.coords
    ? 'This one carries its own coordinates. Either way, choosing it yourself means it can be captioned by name — you have looked at it.'
    : 'No coordinates on this photograph, so a search would only caption it by city. Choosing it yourself means it can carry the name.'
}

async function openSwap(subject: Subject): Promise<void> {
  if (!open) return
  if (!unsplashKey()) {
    setStatus('No Unsplash key in this build, so photographs cannot be changed here.')
    return
  }

  swapSubject.textContent = subjectName(subject)
  swapNote.textContent = 'Looking…'
  swapGrid.replaceChildren()
  swapDialog.showModal()

  const query = subjectName(subject)
  swapQuery.value = query
  const found = await search(query, { accessKey: unsplashKey() })
  // Each candidate is asked where it was taken, because the search response
  // omits `location` entirely. Up to eight small requests, once, while a
  // person is looking at the dialog.
  const candidates = await Promise.all(found.map((c) => describe(c, { accessKey: unsplashKey() })))
  swapping = { subject, candidates, picked: 0 }
  drawCandidates()
  describeChoice()
}

async function commitSwap(): Promise<void> {
  if (!swapping || !open || !store) return
  const candidate = swapping.candidates[swapping.picked]
  if (candidate) {
    await trackDownload(candidate, { accessKey: unsplashKey() })
    const photo = vouchedFor(swapping.subject, candidate)
    await store.savePhoto(open.saved.id, photo)
    open.guide = {
      ...open.guide,
      photos: [...open.guide.photos.filter((p) => p.subject.id !== photo.subject.id), photo],
    }
    render()
  }
  swapping = null
  swapDialog.close()
}

/* ---------------------------------------------------------------- wiring */

importBtn.addEventListener('click', () => void runImport(keyField.value))
keyField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void runImport(keyField.value)
})

modeBtn.addEventListener('click', () => {
  companion = !companion
  render()
})

claimsBtn.addEventListener('click', () => {
  const on = document.body.dataset['claims'] !== 'off'
  document.body.dataset['claims'] = on ? 'off' : 'on'
  claimsBtn.textContent = on ? 'Show sources' : 'Hide sources'
})

printBtn.addEventListener('click', () => window.print())
backBtn.addEventListener('click', () => void showTrips())

book.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return
  const key = target.getAttribute('data-swap')
  if (!key) return
  const [kind, ...rest] = key.split(':')
  if (kind !== 'place' && kind !== 'corridor') return
  void openSwap({ kind, id: rest.join(':') })
})

swapSearch.addEventListener('click', () => {
  void (async () => {
    if (!swapping) return
    swapNote.textContent = 'Looking…'
    const candidates = await search(swapQuery.value, { accessKey: unsplashKey() })
    swapping = { ...swapping, candidates, picked: 0 }
    drawCandidates()
    describeChoice()
  })()
})
swapClose.addEventListener('click', () => void commitSwap())

mountBuildTag($<HTMLDivElement>('build'))

mountAuth(authPane, (user) => {
  const db = supabase()
  store = db && user ? new Store(db, user.id) : null
  if (!store) {
    intro.hidden = true
    controls.hidden = true
    book.replaceChildren()
    return
  }
  void (async () => {
    const wanted = location.hash.slice(1)
    if (wanted) await openTrip(wanted)
    else await showTrips()
  })()
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => undefined)
  })
}

// The clock moves, so the companion view does too. Once a minute is plenty:
// the itinerary's own resolution is never finer than five.
setInterval(() => {
  if (companion) render()
}, 60_000)
