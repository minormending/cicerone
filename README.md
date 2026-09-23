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

## Status

Early. The [product spec][spec] is ahead of the code and is the authoritative
description of what this is meant to be.

This supersedes [trip-companion][tc], which is frozen. That app solved the
import and then spent its effort on the operational layer — payment methods,
opening hours, step-free access — which is the half Wanderlog already covers.
The spec explains what happened and why the design inverts here.

[spec]: https://claude.ai/code/artifact/f1e02bfd-2091-4c21-b21e-a397583bece9
[tc]: https://github.com/minormending/trip-companion
