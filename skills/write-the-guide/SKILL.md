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

## The work

```bash
npm run cicerone pending                         # trips waiting
npm run --silent cicerone trip ID > trip.json    # the graph and its corridors
npm run cicerone sources ID sources.json         # what is already cited about each stop
# ... research and write passages.json ...
npm run --silent cicerone check --trip trip.json passages.json   # offline, as often as you like
npm run cicerone save ID passages.json           # checks, then writes
npm run cicerone book ID out.html                # read what you wrote
```

Read the book back when you are done. Passages that are fine on their own can
read badly in sequence, and the only way to find that is to read the chapter.

Use `--silent` whenever you redirect output. Without it npm writes a two-line
banner into your file and the next command cannot parse it.

`trip` gives you every stop and every corridor, and tells you which kinds each
corridor can take. Work through it subject by subject. Save once, at the end.

**Read `sources.json` before you search the web.** Wanderlog has already
gathered what publishers have written about each stop, as a URL plus the actual
sentence — Lonely Planet, National Geographic, local food writers. On a Prague
trip that is a thousand snippets across twenty-four stops, and each one is
already the shape a claim needs: the snippet is your `support`, the URL is your
`source`. Start there and search the web for what it does not cover.

Its distribution tells you something too. Charles Bridge has three hundred
snippets and the hotel has none, which is a fair first guess at where there is
something to say.

Two cautions. The snippets are *evidence*, not prose — quoting them into a
passage is copying somebody else's writing, and the job is to write your own
sentence and cite theirs. And `sources.json` deliberately excludes Wanderlog's
own review summaries and tips, which are written by a model: citing those would
launder generated text through a citation, which is the exact failure the claim
system exists to prevent. If you find yourself wanting them, that is the
feeling of having nothing to say.

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
  "body": "Charles IV laid the first stone in 1344 and did not remotely expect to see it finished...",
  "sources": [
    { "url": "https://...", "title": "Metropolitan Chapter of St. Vitus", "retrieved": "2026-09-23" }
  ],
  "claims": [
    { "text": "Charles IV laid the first stone in 1344", "source": 0, "support": "the foundation stone was laid on 21 November 1344" }
  ]
}
```

`claims[].text` must appear **verbatim** in `body`. That is what makes a
citation checkable rather than decorative, and `check` enforces it.

### The kinds

| kind | subject | what it answers |
| --- | --- | --- |
| `origin` | place | Why is this here at all? Who built it, for what, and what were they afraid of |
| `event` | both | What happened here |
| `table` | place | Food and drink: what is different here, and *why* it is different |
| `craft` | place | What was and is made here, and why this valley and not the next one |
| `nearby` | place | What is round the corner that the itinerary leaves out |
| `look_for` | both | What to actually notice |
| `passing` | corridor | What you go past without being told — **the signature kind** |
| `prepare` | both | What to bring, load or expect — an enclosed corridor, or a place you are about to leave from |

`nearby` exists because a hotel has nothing to say about itself and a great
deal to say about its street. Use it wherever a stop is a base rather than a
destination — and note that `look_for` is already taken on every place by the
computed light passage, so this is the kind for "what else is here".

Do not write `look_for` passages about light, angles or golden hour. Those are
computed from latitude, longitude and date and added automatically. Writing
them by hand replaces something that cannot be wrong with something that can.

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

`check` will catch an unsourced year. It cannot catch an unsourced causal
claim, so that one is on you.

### 2. Say less where there is less to say

**This is the rule you will be most tempted to break, and breaking it is how
this product fails.**

Research quality varies enormously and the variation is invisible in the
output. A cathedral has libraries written about it. The suburban bakery on day
four has a Google listing and nothing else. Producing four plausible paragraphs
for both is easy, and it is lying about the second one.

Returning **nothing at all** for a stop is a normal, unremarkable outcome. A
trip where eleven of thirty-three stops have real passages and the rest have
none is a good guide. A trip where all thirty-three have four paragraphs is a
bad one wearing a good one's clothes.

If you find yourself writing "this charming spot is perfect for", stop. You
have run out of things to say and started producing texture.

## The corridors are the point

Every travel product is organised around destinations. A hundred sites will
tell you about the cathedral. Nobody writes about the thirty minutes between
the cathedral and dinner, because until somebody has an actual itinerary there
is no such thing as that thirty minutes.

So spend disproportionate effort there. For each corridor you are given the two
ends, their coordinates, the mode and the view. Research the *route between
them*, not the endpoints again:

- What is on that street, that river bank, that stretch of line?
- What happened along it?
- What can they see from it that they would not know to look at?
- Where does the ground change, and why?

A `passing` passage that only describes the destination has missed the point
entirely. So has one that says "enjoy the pleasant walk".

For a corridor marked `enclosed` — a daytime flight, the metro — write
`prepare` instead: load something before you board, this route runs late, the
left side has the mountains on approach, buy the ticket at the machine not the
window. Anything a guide would tell you while you waited.

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

## When you are done

Run `check` and read the coverage line. The number worth watching is the share
of passages carrying a sourced claim. If most of your passages have no claims
in them, you have written atmosphere, and atmosphere is what this design exists
to avoid. Go back and either source them or cut them.
