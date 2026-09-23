# cicerone

*n. a guide who takes visitors round a place and tells them about it.*

Wanderlog and Polarsteps tell you where you are going and how to get there.
Neither tells you what you are looking at.

Cicerone reads an itinerary you already built and writes the book about it —
why this town is here at all, what happened in this square, why the wine in
this valley tastes unlike the wine forty kilometres north, and what to look
out of the window for between the fourth stop and the fifth.

## The corridor, not the pin

Every travel product is organised around destinations. What a hired guide
gives you that no app does is narration of the *journey between them*: the
field on the left where the battle was, the bridge worth looking back from,
the village you pass that makes the cheese you ate at lunch.

That content cannot be pre-written or scraped, because until somebody has an
actual itinerary there is no such thing as "the thirty minutes between the
cathedral and dinner". The corridor only exists once the trip does.

A corridor is any leg you are **awake for** — a clock test against the
itinerary's own times, not a mode test. Within those, one further question
decides what can be written:

| | example | gets |
| --- | --- | --- |
| awake, can see out | walking, tram, rail, ferry | `passing`, `event`, `look_for` |
| awake, cannot | daytime flight, metro | `prepare` |
| asleep | red-eye, sleeper | nothing |

## How it works

```
Wanderlog key → edge function → trip graph → Supabase
                                                  ↓
                        a scheduled Claude routine researches and writes
                                                  ↓
                                          passages, with sources
                                                  ↓
                                 the book, or the where-am-I-now view
```

Logistics — times, routes, hours, costs — are read from the import and shown
as the spine the narrative hangs on. They are never recomputed here. That is
Wanderlog's job and it already does it well.

## Running it

```bash
npm install
npm test
npm run build:web

# sign in at the site, press "Copy token for the routine", then once:
npm run cicerone login TOKEN

# the routine's side of the seam
npm run cicerone import KEY
npm run cicerone pending
npm run --silent cicerone trip ID > trip.json
#  ... the write-the-guide skill researches and writes passages.json ...
npm run --silent cicerone check --trip trip.json passages.json   # no database
npm run cicerone save ID passages.json
npm run cicerone photos ID
```

`--silent` matters wherever output is redirected: without it npm writes its own
two-line banner into the file.

The session is saved at `~/.config/cicerone/token`, 0600. Refresh tokens
rotate, so the CLI writes each new one back after every use — copying from the
site is a one-off rather than a recurring chore.

`save` runs `check` first and refuses on a fault, so the quality bar is code
rather than a request. `check` can be run by anybody, over any guide, with no
model in the loop.

### Environment

| | |
| --- | --- |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | the project; both ship in the bundle by design |
| `SUPABASE_REFRESH_TOKEN` | your session, for the CLI |
| `PUBLIC_UNSPLASH_ACCESS_KEY` | photographs; absent, the swap says it is off |
| `DATABASE_URL` | migrations only |

## What is written, and what is refused

The unit is a **passage** — several paragraphs somebody would read aloud while
you stood there — not a fact with a label on it. Each carries its sources, and
each specific assertion carries its own claim pointing at one of them.

Two rules hold the whole thing up:

**A specific with nothing behind it does not ship.** "Charles IV laid the first
stone in 1344" needs a source. "Charles IV laid the first stone and did not
expect to see it finished" does not — the guide is allowed to know things
stated generally. `check` catches an unsourced year.

**Saying nothing is a legitimate answer.** A cathedral has libraries written
about it; the suburban bakery on day four has a Google listing. A guide that
produces four paragraphs for both is lying about the second. A trip where two
thirds of the stops have no passage is a good guide, and nothing in the
pipeline pushes toward filling them.

The number worth watching is the share of researched passages carrying a
sourced claim. Prose that survives with none is atmosphere, and a guide made
mostly of atmosphere is the failure this design exists to avoid.

## Photographs

A photograph captioned as a place is a factual claim, and Unsplash matches on
user-supplied tags that are often approximate. So a picture earns a place's
own name only when its **own coordinates** put it within 150 m — not its
title, not its tags, not the order the results came back in. Everything else
runs as atmosphere, captioned by city.

Any photograph can be swapped, and choosing one by hand makes it captionable
by name: somebody who knows what the place looks like has supplied the
evidence the coordinates were standing in for. A chosen picture survives every
rebuild of the guide.

## Status

Early. The [product spec][spec] is ahead of the code and is the authoritative
description of what this is meant to be.

This supersedes [trip-companion][tc], which is frozen. That app solved the
import and then spent its effort on the operational layer — payment methods,
opening hours, step-free access — which is the half Wanderlog already covers.
The spec explains what happened and why the design inverts here.

[spec]: https://claude.ai/code/artifact/f1e02bfd-2091-4c21-b21e-a397583bece9
[tc]: https://github.com/minormending/trip-companion
