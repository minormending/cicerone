import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrivalOn, dateFor, lightPassage, lightPassages, nearestWindow } from '../src/light/light.ts'
import { goldenHours } from '../src/light/sun.ts'
import type { Place, Trip } from '../src/domain/types.ts'

const PRAGUE = { lat: 50.0875, lon: 14.4213 }

const trip = (places: Place[], departsOn = '2026-09-23'): Trip => ({
  id: 't',
  title: 'Prague',
  departsOn,
  places,
  legs: [],
})

const place = (extra: Partial<Place> = {}): Place => ({
  id: 'p1',
  name: 'Šternberský Palace',
  coords: PRAGUE,
  dayIndex: 1,
  timezone: 'Europe/Prague',
  ...extra,
})

test('a computed passage carries no sources and says so', () => {
  const passage = lightPassage(trip([place()]), place())
  assert.equal(passage?.computed, true)
  assert.deepEqual(passage?.sources, [])
  assert.deepEqual(passage?.claims, [])
  assert.equal(passage?.kind, 'look_for')
})

test('a facade bearing yields a side to stand on', () => {
  const p = place({ facadeBearing: 270 })
  const passage = lightPassage(trip([p]), p)
  assert.match(passage?.body ?? '', /west-facing front is lit \d\d:\d\d–\d\d:\d\d/)
  assert.match(passage?.body ?? '', /sun behind you/)
})

test('golden hour names the gap rather than pretending it is advice', () => {
  // A 07:45 bakery told about the evening window is being told about nine
  // hours after it has gone.
  const p = place({ arrive: '07:45' })
  const passage = lightPassage(trip([p]), p)
  assert.match(passage?.body ?? '', /before you arrive|after you arrive/)
  assert.match(passage?.body ?? '', /\d+ (minutes|hours)/)
})

test('arriving inside the window is said plainly', () => {
  const golden = goldenHours(new Date('2026-09-23'), PRAGUE)
  const evening = golden[golden.length - 1]
  assert.ok(evening, 'Prague in September has an evening golden hour')
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Prague',
  }).format(new Date((evening.start.getTime() + evening.end.getTime()) / 2))

  const p = place({ arrive: hhmm })
  assert.match(lightPassage(trip([p]), p)?.body ?? '', /which is when you arrive/)
})

test('without a timezone the times are estimated and labelled', () => {
  const p = place({ timezone: undefined as unknown as string, facadeBearing: 180 })
  delete (p as { timezone?: string }).timezone
  assert.match(lightPassage(trip([p]), p)?.body ?? '', /estimated from longitude/)
})

test('each place gets its own day of sun, not the departure date', () => {
  // Over five days in October that is several minutes of golden hour; across
  // an equinox it is more.
  const t = trip([place({ dayIndex: 1 }), place({ id: 'p5', dayIndex: 5 })])
  const first = dateFor(t, t.places[0] as Place)
  const fifth = dateFor(t, t.places[1] as Place)
  assert.equal(fifth.getTime() - first.getTime(), 4 * 86_400_000)
})

test('an arrival time resolves against the place own zone', () => {
  const at = arrivalOn(new Date('2026-09-23'), place({ arrive: '09:40' }))
  const back = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Prague',
  }).format(at as Date)
  assert.equal(back, '09:40')
})

test('with no arrival the evening window is the one offered', () => {
  const windows = goldenHours(new Date('2026-09-23'), PRAGUE)
  assert.equal(nearestWindow(windows, undefined), windows[windows.length - 1])
})

test('places on no day get no light passage', () => {
  // Standing lists are not stops and nobody is standing there at any hour.
  const t = trip([{ id: 'idea', name: 'Maybe', coords: PRAGUE }])
  assert.deepEqual(lightPassages(t), [])
})

test('polar night yields nothing rather than nonsense', () => {
  const p = place({ id: 'svalbard', name: 'Longyearbyen', coords: { lat: 78.22, lon: 15.63 } })
  assert.equal(lightPassage(trip([p], '2026-12-21'), p), null)
})
