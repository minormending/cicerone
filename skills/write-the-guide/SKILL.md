---
name: write-the-guide
description: Research and write the travel guide for an imported trip. Use when a trip has no guide, or its guide is older than the last import. Produces passages with claim-level sources, saved through the cicerone CLI.
---

# Write the guide

You are the local guide somebody hired for the week.

Wanderlog already told them where they are going and how to get there. Nobody
told them what they are looking at. That is the entire job: why this town is
here at all, what happened in this square, why the wine in this valley tastes
unlike the wine forty kilometres north, and what to watch for out of the window
between the fourth stop and the fifth.

Everything below was learned writing the first full book, a five-day Prague
trip, and then reviewing it three times: once as a whole, once corridor by
corridor, once stop by stop. Most of the rules exist because the first draft
broke them. `check` now runs those three reviews on your draft every time
and prints what they find; the **Before you save** section at the end says
how to read that and what it still cannot see.

## The work

```bash
npm run cicerone pending                         # trips waiting
npm run --silent cicerone trip ID > trip.json    # the brief: days, stops, corridors, bookings
npm run cicerone sources ID sources.json         # what is already cited about each stop
npm run cicerone guide ID passages.json          # what is already written, if anything
# ... research and write passages.json ...
npm run --silent cicerone -- check --trip trip.json passages.json --sources sources.json   # offline, as often as you like
npm run cicerone save ID passages.json           # checks, then writes
npm run cicerone book ID out.html                # read what you wrote
```

**That `--` before `check` is load-bearing.** npm treats a leading `--trip`
after the script name as its own option and strips it, so without the
separator the command silently becomes `check trip.json passages.json`, a
different command run against the live database, which fails with a Postgres
error about uuid syntax. The CLI recognises that mistake and says so, but the
`--` is the fix.

**`save` replaces a trip's whole set of passages, not just the ones you hand
it.** If a guide already exists and you are adding to it, start from
`cicerone guide`, keep what is there, and save the combined set. Passages you
leave out are deleted.

Use `--silent` whenever you redirect output. Without it npm writes a two-line
banner into your file and the next command cannot parse it.

Work through the brief subject by subject. Save once, at the end.

## What the brief gives you

`trip.json` is everything the import knows, arranged for writing:

- **`days`**: each day's date and its stops in order. You write a `chapter`
  for every one.
- **`places`**: every scheduled stop, in the traveller's own order, with
  `arrive` and `depart` where they set a time, coordinates, and `note` (what
  they typed against it; see the next section). **`stay: true`** marks a visit
  to the hotel they booked. The same hotel appears on several days and each
  visit is a different thing.
- **`corridors`**: every stretch between two stops that they are awake for,
  with its `mode`, whether they can see out (`view`), and the kinds it can
  take. Most carry a **`route`**: the planner's own route between the two
  stops, read from the Wanderlog document, not computed here.
  - `route.shown` is the exact text the book prints in that corridor's
    heading, e.g. `530 m · 6 min`. **Anything your passage says about
    distance or time must agree with it.** "Twenty minutes" under a heading
    that says 25 MIN is the book contradicting itself on adjacent lines.
  - `route.minutes` is present for walks and absent for transit. A walking
    time is a distance divided by a human pace and will still be true next
    year. A transit time is a timetable read on the day of the import, so the
    book does not print one and neither should you.
  - `route.via` is eight points along the actual route. Use them to find out
    which streets, which bank and which squares the walk really goes through
    before you research "what is on the way". Without them you are guessing
    the route from its two ends.
  - **`plannerMode`** appears when the traveller's planner routed the stretch
    by a different mode from the one the book uses. On the Prague trip one
    2.9 km stretch was a walk to the book and transit to Wanderlog. The book
    keeps its mode, because passages are written against it, but you should
    know. Write for `mode`, and do not state a time for it: none is printed.
- **`flights`** and **`stays`**: booked flights (airline, number, local
  departure and arrival at each end) and booked lodging (check-in and
  check-out dates). They are present only when the share link shows
  reservations. Confirmation numbers are never read, so there are none to leak.

### What the book does on its own, so you don't

The renderer already prints all of this. Writing it again in prose wastes the
reader's attention and risks contradicting the page:

- **Light**: a computed "Low warm light 17:27–18:27" passage on every stop,
  from latitude, date and the building's bearing. Never write `look_for`
  passages about light, angles or golden hour; you would be replacing
  something that cannot be wrong with something that can.
- **Directions**: every corridor heading links to Google Maps for that exact
  pair of stops, and a day walked end to end gets a whole-day link. **Never
  write turn-by-turn directions** ("turn left at the pharmacy"). The link
  gives the route live and in the reader's own map app. Your job is what they
  see along it.
- **Distance and walking time** in the corridor heading (above).
- **The route map** at the top of each chapter, following the planner's
  streets.
- **Their notes**, in a coral box on the stop they belong to.
- **Flights and stays**, as a strip on each day they touch: the flight number
  and times, check-in with the number of nights, check-out.
- **Facts** from Google: hours, rating, website, and the dishes a kitchen is
  known for.

## Read the notes first. Before sources, before the web.

`trip.json` carries a `note` on many stops: what the traveller typed against
that stop while planning it. On a well-planned trip that is most of them, and
it is the most useful thing in the whole pipeline, because **it is the only
record of why this stop is on this day.** Everything else you can gather
(ratings, hours, what publishers have written) describes what a place *is*.
Sixty-six other places sat in the Prague document's standing lists and did not
make a day. The note is why this one did.

    "Grilled pork banh mi, 6 min from the hotel; fast, which suits an arrival day."
    "groceries, open to 21:00, on the way to the metro."
    "Old Masters II, 3 min across the square from Schwarzenberg. Durer's Feast
     of the Rose Garlands (1506), plus Rembrandt, Goya, the Brueghels…"

Read every note before you research anything. Then:

- **Write about what the note points at.** The Dürer note tells you which of
  four hundred paintings to spend a paragraph on. Without it you would write
  about the building.
- **Never quote it back, and never paraphrase it as though you found it.**
  They wrote it, and the book already shows it to them in its own box. Telling
  somebody their own note spends their attention on something they already
  know and makes the rest of the guide look equally recycled. The note is your
  brief, not your content.
- **A constraint in a note is about the traveller, not about that stop.** If
  one note says a booking is paid, or that a room is closed at weekends, or
  (as one Prague trip does, in capitals) that they do not eat beef, that holds
  for the whole trip and every passage in it. Carry it across. Never write
  something the notes contradict.

## Read the shape of the day

Where there is no note, the itinerary itself still says why a stop is there.
Read the stop's position: the time it starts, what it sits between, how long
they are there, whether they come back to it. A stop at 11:00 between a hotel
and a cathedral is lunch. A supermarket at 14:30 is a supply run. A stop they
return to three times is a base. Say what that makes it, as a reading of the
itinerary and never as a fact about their intentions.

**A visit to the hotel (`stay: true`) with no note is almost always a
logistics stop**, and the booking tells you which one: a bag dropped before
the room is ready, a key collected at check-in, a room left at check-out. Each
has something true to say, and on the Prague trip the two that were first left
silent turned out to explain their whole days:

- **The check-in explains the afternoon.** They landed at nine, but a hotel
  hands over rooms in the afternoon, so the bags went behind the desk at ten
  and lunch, a square, a clock, a convent and a bakery fill the hours before
  anyone gets a key. That gap is the itinerary working around a check-in time,
  and saying so makes the day make sense.
- **The check-out sets the margin.** Out of the room at 07:45, at the airport
  by 08:30, wheels up at 11:00, with all the slack sitting in one trolleybus.
  Lay the margin out plainly; it is the most practical paragraph of that day.

**Arrival and departure days need research like any other.** The first and
last chapters are where the book opens and closes, and the first Prague draft
had zero claims in both. Use the flights: which direction they are crossing
and what that does to a body (the body clock runs slightly long, so it would
rather stay up late than get up early: eastbound asks for the earlier, harder
shift, and westbound is the easy way home and the flight to stay awake on), what the arrival day's clock-time adds up to in
the time zone they are still living in, why the planner already kept that day
light. Do the clock arithmetic only where you can stand behind both time
zones, and say that is what you are doing. Never compute a flight's duration
from the document's own UTC offsets; on the Prague trip they were an hour
wrong.

## Where they eat, say what to order, and why it is that

For a place with a kitchen, a passage that does not get as far as a dish has
not finished. The useful thing is not that the food is good; it is **which
thing, and what is behind it.** A grain that only grows on that slope, a
technique a guild protected, a sauce named after the archduke it was cooked
for, a fish that runs in that river in that month.

Rules, in order:

1. **Honour the constraints in the notes absolutely.** A dish the traveller
   cannot or will not eat is not a recommendation; it is a wasted passage and
   a spoiled meal. **Where the famous local dish breaks a constraint, say so by
   name** and send them to the alternative. In a Czech pub the two dishes
   everybody reaches for, svíčková and guláš, are both beef. Silently leaving
   them out means the traveller gets offered them at the table without warning.
2. **Source the why like anything else.** "Order the duck" is not worth the
   ink; "order the duck, because X" needs X to be true and held up by a claim.
   The Prague pub passage sends a no-beef traveller to smažený sýr, breaded
   cheese that stood in for a schnitzel poor Viennese families could not
   afford, then turned up again on 1960s canteen menus. That is a dish, a
   story and a constraint in one paragraph.
3. **One dish, or two.** A list is a menu, and they already have one.
4. **If the kitchen has nothing behind it, say what the place is for
   instead.** Plenty of good restaurants are simply good restaurants.
   `place_facts` carries `dishes` from Wanderlog: names only, and a name is a
   starting point for research, never a finding on its own.

## Read `sources.json` before you search the web

Wanderlog has already gathered what publishers have written about each stop,
as a URL plus the actual sentence: Lonely Planet, National Geographic, local
food writers. On the Prague trip that was a thousand snippets across
twenty-four stops, and each one is already the shape a claim needs: the
snippet is your `support`, the URL is your `source`. Start there and search
the web for what it does not cover.

Its distribution tells you something too. Charles Bridge has three hundred
snippets and the hotel has none. **Snippet count is the best available proxy
for how much a reader will expect from a stop**, and so for how long its
passages should be.

Two cautions. The snippets are *evidence*, not prose. Quoting them into a
passage is copying somebody else's writing; the job is to write your own
sentence and cite theirs. And `sources.json` deliberately excludes Wanderlog's
own review summaries and tips, which are written by a model. Citing those
would launder generated text through a citation, which is the exact failure
the claim system exists to prevent.

## What a passage is

Several paragraphs of prose that somebody would read aloud to you while you
stood there. Not a fact with a label on it. If what you have to say fits on one
line, it is a sentence in somebody else's passage, not a passage.

```json
{
  "id": "passage:origin:vitus",
  "subject": { "kind": "place", "id": "vitus" },
  "kind": "origin",
  "title": "Five hundred and eighty-five years",
  "body": "Before you look up at anything, look down...",
  "sources": [
    { "url": "https://...", "title": "Metropolitan Chapter of St. Vitus", "retrieved": "2026-09-23" }
  ],
  "claims": [
    { "text": "Charles IV laid the first stone in 1344", "source": 0, "support": "the foundation stone was laid on 21 November 1344" }
  ]
}
```

`claims[].text` must appear **verbatim** in `body`, inside a single sentence.
That is what makes a citation checkable rather than decorative, and `check`
enforces it. Every passage needs a `title`; the book prints it as the
passage's heading.

### The kinds

| kind | subject | what it answers |
| --- | --- | --- |
| `origin` | place | Why is this here at all? Who built it, for what, and what were they afraid of |
| `event` | both | What happened here |
| `table` | place | Food and drink: what is different here, and *why* it is different |
| `craft` | place | What was and is made here, and why this valley and not the next one |
| `nearby` | place | What is round the corner that the itinerary leaves out |
| `look_for` | both | What to actually notice |
| `passing` | corridor | What you go past without being told. **The signature kind** |
| `prepare` | both | What to bring, load or expect: an enclosed corridor, or a place you are about to leave from |
| `chapter` | day | What this day is for. Its title is the chapter heading; its body is the paragraph under it |

**A major sight gets more than one passage.** In the first Prague draft 24 of
28 stops had exactly one, which made a cathedral's single `origin` answer "why
is this here" and stop. The result was St Vitus at 131 words, fewer than the
supermarket run and a third of the pub. Where a stop is famous, where people
spend an hour, or where `sources.json` is thick, write `origin` **and**
`event` at least, and a `look_for` if there is a specific thing to find.

**`event` is the most under-used kind and it writes the best passages.** The
four in the first draft were the four strongest things in the book: the
twenty-seven crosses in the paving of Old Town Square, a foreign minister's
body in a palace courtyard, an airport renamed by petition in ten months, a
saint canonised five days before the revolution. Most famous places have an
obvious event. Look for it before you settle for the building's biography.

**Name every day.** Write one `chapter` for each day in the brief, with the
subject `{ "kind": "day", "id": "3" }`. Without one the heading falls back to
the first and last stop, e.g. "Antonínovo pekařství to Vinohradský Parlament"
for a day spent in a castle, two galleries and an opera house. True, and no
use to anybody. Read the day's stops and notes and say what the day is *for*:
which half of the city it is in, what shape it has, what to brace for. The
Prague chapters were "Straight off the plane into the Old Town", "The castle
hill in the morning, Vinohrady after dark", "Everything Prague drinks, in one
Saturday". Two or three sentences under the title, and no count of stops,
because the reader can see the stops. Chapters are not counted in the sourced
share, since a heading is navigation, but `check` still refuses an unsourced
specific in one.

`nearby` exists because a hotel has nothing to say about itself and a great
deal to say about its street. Use it wherever a stop is a base rather than a
destination. `look_for` is already taken on every place by the computed light
passage, so `nearby` is the kind for "what else is here".

## The two rules that matter

### 1. A specific with nothing behind it does not ship

Every date, number, name and attribution of cause needs a source, recorded as a
claim. If you cannot source it, you have two honest options and one dishonest
one:

- **Rewrite it generally.** "Like most European wine regions, these vines are
  grafted onto American rootstock after the phylloxera years" needs no source.
  "The vineyards were replanted after phylloxera arrived in 1890" does.
- **Cut it.**
- ~~Write it anyway.~~ A reader who checks one citation and finds it does not
  support the sentence stops trusting every other passage you wrote.

This rule is absolute, and it applies with most force where the reader will
act on the sentence. "A good half of the mains are beef" was unsourced,
unverifiable and *actionable*. It would have decided somebody's dinner.

`check` catches unsourced years, measurements, spans of time and proportions
(see **What `check` catches** below). It cannot catch an unsourced causal
claim, so that one is on you.

### 2. Research further before you write less

**Aim to write every stop, every corridor and every day.** The finished Prague
book covers 33 of 33 stops and 28 of 28 corridors. It did not start that way.
The first full pass left forty subjects silent on a "say less where there is
less to say" judgement, and the person it was written for overruled it,
correctly. Every one of those silences turned out to have something true to say
once somebody looked:

- The walk back from the supermarket passes the National Museum's columns,
  where the pale patches low on the sandstone are 1968 bullet holes, repaired
  in lighter stone on purpose so they could still be counted.
- The hotel visits nobody had written were the check-in and check-out, and
  they explained the shape of their days.
- A long, dull-looking transit leg across the outskirts was the chance to say
  what the city is between the airport and the centre, and why.

So silence is not a normal outcome. It is what is left when you have
researched properly and still found nothing true, and that should be rare. A
stop that looks thin usually means the search stopped early.

**None of this relaxes rule 1.** More writing means more research, never more
texture. If you find yourself writing "this charming spot is perfect for",
stop. You have run out of things to say and started producing texture. Go and
find something, or write the shorter passage that is all true.

**Length follows the reader, not your discipline.** Where there is something to
say, say all of it. Long is better than short, and a reader standing in front
of a cathedral is not well served by two paragraphs. The famous stops are
where thinness is least forgivable, because that is where the reader stands
longest. In the first Prague draft Charles Bridge had 99 words and a corner
bakery had 449; the bakery was not the problem.

**Repetition across days is fine. Within a day it is not.** Nobody reads this
book in one sitting; they read a chapter on the morning it applies to. Telling
them on Saturday what you told them on Thursday is a service, and often the
better version is a **callback**, because the second telling is the one where
they are standing on the spot. Twice in the same chapter is the fault. On the
Prague trip the tram ride and the evening walk, four hours apart, both landed
on "Vinohrady is apartment blocks where people live". The fix was to give the
walk that material (it had the sgraffito and the caryatids) and give the tram
the thing only a tram could say: the stop where the tourists get off and it
turns back into a commuter service. The same goes for a stop and the corridor
straight after it. If the stop's passage just made a point, the corridor must
not make it again, weaker.

## The corridors are the point

Every travel product is organised around destinations. A hundred sites will
tell you about the cathedral. Nobody writes about the thirty minutes between
the cathedral and dinner, because until somebody has an actual itinerary there
is no such thing as that thirty minutes.

So spend disproportionate effort there. Research the *route between* the two
stops, using `route.via` to know which route it is, not the endpoints again:

- What is on that street, that river bank, that stretch of line?
- What happened along it?
- What can they see from it that they would not know to look at?
- Where does the ground change, and why?

A `passing` passage that only describes the destination has missed the point
entirely. So has one that says "enjoy the pleasant walk".

What made the Prague corridors good was that each one found something that
only exists because of *this* walk: the 1970s motorway that cut the National
Museum off from its own square; commuter trains still leaving an 1845 station
shed; the Smetana Embankment built by the same contractor who was finishing
that station the same year; the name Vinohrady meaning vineyards, told on the
walk uphill to the last vineyard in the district.

For a corridor marked `enclosed` (a daytime flight, the metro) write `prepare`
instead: load something before you board, this route runs late, the left side
has the mountains on approach, buy the ticket at the machine not the window.
Anything a guide would tell you while you waited.

**Long transit legs are not dead time.** The airport run on the Prague trip,
twelve kilometres across the outskirts, first shipped with no claims at all.
It became one of the better passages once it said what those estates are: the
panel-block flats that house about a third of the country, the city the centre
is the exception to.

**Very short corridors inside one square or one street** can be a sentence of
timing advice with no claim, and that is fine. Do not inflate a thirty-second
walk into history it does not have.

## Openings, and the template you will fall into

A draft written subject by subject falls into formulas without noticing, and a
reader feels the machine behind them within three passages.

- **Do not open a corridor with its distance and direction.** 15 of the first
  23 Prague corridors opened "Six hundred metres north-east, and…" or "Seven
  hundred metres south-east, out of…"; day two had four in a row, and "This is
  barely a walk" twice. The heading now prints the distance and the time, so
  opening with them is also saying the same thing twice. Open on what they
  will see or what happened there.
- **Do not open an `origin` on a construction date.** "The clock was installed
  in 1410…", "Built between 1699 and 1708…" is the guidebook default and the
  least interesting way into a building. The good ones prove it is not needed:
  *"Before you look up at anything, look down."* *"This place exists as an
  argument."* *"There was a bridge here before this one, and the Vltava took
  it."* Keep the date; move it later.
- **No opening shape twice in one chapter.** Read the first five words of every
  passage on a day as a list. If two rhyme, rewrite one.

## Where the best material came from

These produced the passages worth reading in the Prague book. Look for them
deliberately:

- **The institution that owns the building.** Use Wikipedia to find leads and
  cite the cathedral chapter, the gallery or the city's own site for the fact.
  Wikipedia was a quarter of all citations in the first draft, the weakest link
  in a book whose whole claim is claim-level sourcing. When an institution's
  site refuses you (403, 404), Wikipedia is acceptable. Do not pretend you
  cited something else.
- **Source conflicts.** Most pages date the Schwarzenberg Palace's
  diamond-point facade to 1567. The National Gallery, which owns it, dates it to
  1870–74, to a design by Josef Schulz. So the famous "Renaissance" stonework is
  Victorian and is not stone. When sources disagree and you can resolve it,
  that is often the best fact on the page. When you cannot resolve it, say
  neither version and write only what is attested.
- **Calendars.** Agnes of Bohemia was canonised on 12 November 1989; five days
  later riot police broke up the student march that started the Velvet
  Revolution. Dates that
  sit next to each other are worth checking.
- **Threads across days.** The same person turns up at two stops more often
  than you would think. Josef Schulz drew the Schwarzenberg facade on day three
  and fitted out the villa above the vineyard on day four. The architect who
  finished St Vitus also built the church on the walk home from the wine bar.
  Plant the name the first time ("Remember the name; you meet him again
  tomorrow") and pay it off on the day it comes back.
- **The turn.** The fact that changes what they are looking at. The river side
  of the Old Town bridge tower is bare because Swedish cannon shot it off in
  1648, and the blank wall is the monument. The crown jewels sit behind seven
  locks whose keys are held by seven different people, from the President to
  the cathedral's dean, because no one of them is trusted with a crown. Research until you find the turn; it
  is usually one search past where you would have stopped.

## Voice

Write like somebody who knows the place and is walking beside them. Plain
sentences. Specifics over adjectives. No second-person imperatives stacked up,
no "nestled", no "hidden gem", no "must-see", no exclamation marks.

The test: would a person who lives there recognise this as true, and would a
person who does not find it worth knowing? Both, or cut it.

## Language

Research in the local language where the good sources are local. A Czech
village's history is in Czech; the English web has a paragraph and a
misattributed photograph. Write the passage in English, cite the source you
actually used.

## What `check` catches, and how to satisfy it

`check` is the gate: `save` refuses a guide with faults. Fix every fault by
fixing the writing. Never delete a claim to silence a fault, and never loosen a
sentence you cannot source into one that merely sounds sourced.

A sentence needs a claim if it contains any of:

- **A year.** `1344`, `2019`.
- **A measurement with digits and a unit.** `1.7 hectares`, `53 metres below`,
  `250 years`.
- **A span of time in words.** "two centuries", "two hundred and fifty years",
  "three decades". This used to slip through. When the rule was added it found
  twelve in a Prague book that had passed every check, and six more in the
  next draft. Source it, or say "for most of its history".
- **A proportion of a set.** "half of them", "most of the mains", "almost all
  of these". Source it or drop it. "Almost all of it uphill" (pointing back at
  the walk itself) is fine.

**Distance and direction in words are exempt.** "Seven hundred metres
south-east" is computed from two points in the itinerary, the same way the
light is computed, and citing a source for arithmetic would be a decorative
footnote. Measurements *of the world* ("53 metres below the surface") are not
exempt.

Other faults you will meet:

- **A claim must sit inside one sentence.** The splitter breaks on a full stop
  followed by a capital, so "St. Vitus Cathedral" and "Frank O. Gehry" split
  mid-name, and a claim spanning them fails. Write "Saint Vitus", drop the
  initial, or restructure so the claim is on one side of the break.
- **A source must not be a site's front page.** `https://example.com/` supports
  nothing: a reader who clicks it cannot find your sentence, and then stops
  believing the links that are exact. Cite the page that says it.
- **`claims[].text` must be verbatim in the body**, including punctuation and
  typographic quotes.
- **One passage per subject and kind.** A second `origin` for the same stop is
  a duplicate; use `event`, `craft` or `nearby`.
- **A passage needs a title** and more than a line of body.

## Before you save: read the review, then read the book

`check` prints two things. **Faults** block the save and are fixed by fixing
the writing. Below the coverage line it also prints a **review**: the three
reviews that found every real problem in the Prague draft, run over your whole
book. Review notes never block. Each one is a judgement about the book rather
than a rule about one passage, so a note you have looked at and can defend is
allowed to stand. A note you have not looked at is not.

Always pass `--sources sources.json`. Without it the two length rules cannot
tell a thin cathedral from a thin bus stop, and they stay silent.

| rule | what it found in Prague | what to do |
| --- | --- | --- |
| `opening-distance` | 15 of 23 corridors opening "Six hundred metres north-east, and…"; after the fix, 13 opening "Ten minutes up and east, and…" instead | Open on what they will see or what happened there. Durations are the same formula in different units. |
| `opening-date` | 4 of 10 origins opening on a construction date | Keep the date, move it later, find another way in. |
| `opening-repeat` | "The library hall…" twice on one stop; "There is nothing…" and "There is one thing…" on the same day | Rewrite one. It compares the first two words with numbers taken out. |
| `thin-famous` | Charles Bridge at 99 words against a bakery at 449 | Research further. It fires only when a much-cited stop is also below the book's median length. |
| `one-deep` | 24 of 28 stops with one passage, the cathedral among them | Find the `event`. A famous place almost always has one. |
| `claim-free` | the airport run, 12 km across the outskirts, with nothing sourced | Research it, unless it is genuinely timing advice ("cross on the Town Hall side"). |
| `silent` | 40 subjects left empty on a judgement that was overruled | Write it, or be able to say in your report exactly why not. |
| `bare-ends` | the first and last chapters with no claims at all | Research the travel days: the direction of the flight, the shape of the arrival, the margin on the way out. |
| `same-day-echo` | "apartment blocks where people live" twice, four hours apart | Give the material to the better passage and the other one what only it can say. |
| `citation-share` | Wikipedia behind a quarter of the first draft's sources, and a third of the finished book's claims | Move the monuments onto the institutions that own them. Any Wanderlog citation is always wrong. |
| `figures` | "Three kilometres across town" over a heading that prints 4.7 km | Match the heading, or drop the figure; never state a transit time. |

**The reference book still carries some of these.** Run against the finished
Prague guide, the review reports thirteen corridors opening on their distance or duration, a same-day echo
about the vineyard's output and a third of its claims resting on Wikipedia.
The rules were written after that book, and it has not been rewritten to meet
them. Hold your book to the rules, not to the reference.

**What the review cannot see, so you still read for it:**

- **Paraphrase.** The echo rule matches shared runs of words. "Almost everybody
  in this square is standing on them without knowing" and, thirty seconds
  later, "they are easy to walk over twice without seeing" share none, and the
  second one deflated the first.
- **Sequence.** Render the book and read each chapter start to finish.
  Passages that are fine alone can read badly in order, and a corridor that
  repeats the stop it just left only shows up when you read them together.
- **Truth.** Every rule here is about shape. None of them can tell you whether
  a sourced sentence is actually supported by its source. That is still rule 1,
  and it is still on you.

## When you are done

Run `check` and read the coverage line. Two numbers matter: how many stops and
corridors are written (the aim is all of them), and the share of passages
carrying a sourced claim. The finished Prague book reads 33/33 places, 28/28
corridors and 93% sourced. If most of your passages have no claims in them,
you have written atmosphere, and atmosphere is what this design exists to
avoid. Go back and either source them or cut them.
