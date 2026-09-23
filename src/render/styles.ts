/**
 * The look: Polarsteps' surface over a guidebook's structure.
 *
 * Their travel books are carried by photographs of a trip somebody already
 * took. This is a guide to a trip nobody has taken yet, so the photography is
 * sparse and borrowed, and the type and the route map carry the weight
 * instead. That puts the real structural reference somewhere else — a printed
 * city guide, where long prose is the point and the design exists to make
 * reading it pleasant for an hour.
 *
 * So: Poppins for the surface (small-caps labels, big coral numbers, the
 * geometric headings), Source Serif for the prose. The two halves of the
 * thesis, visible in the type pairing.
 */

export const TOKENS = {
  ink: '#14273D',
  ink2: '#22364D',
  ink3: '#4A5C70',
  faint: '#63727F',
  coral: '#E2574C',
  /** Coral fails 4.5:1 on paper at body size, so small text uses this. */
  coralInk: '#B8392F',
  paper: '#FBFAF7',
  sand: '#F2EDE3',
  rule: '#E0DCD2',
  verified: '#3F7D6E',
} as const

export const BOOK_CSS = `
:root {
  --ink: ${TOKENS.ink};
  --ink-2: ${TOKENS.ink2};
  --ink-3: ${TOKENS.ink3};
  --faint: ${TOKENS.faint};
  --coral: ${TOKENS.coral};
  --coral-ink: ${TOKENS.coralInk};
  --paper: ${TOKENS.paper};
  --sand: ${TOKENS.sand};
  --rule: ${TOKENS.rule};
  --verified: ${TOKENS.verified};
  --sans: Poppins, ui-sans-serif, system-ui, sans-serif;
  --serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;
  /* The left rail beside a stop, and the gutter after it. Named because a
     photograph has to reach back across both of them. */
  --rail: 150px;
  --rail-gap: 56px;
}

* { box-sizing: border-box; }

/* A display declaration in any rule beats the user agent's
   [hidden] { display: none }, so every pane styled as flex stayed on screen
   with the attribute set. This put the dark companion view over the whole
   page on first load. */
[hidden] { display: none !important; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 19px;
  line-height: 1.68;
  -webkit-text-size-adjust: 100%;
}

a { color: var(--coral-ink); }
a:hover { color: #8F2C24; }

.wrap { max-width: 1040px; margin: 0 auto; padding: 0 120px 80px; }

/* Small-caps labels do a lot of work and must never shout. */
.label {
  font-family: var(--sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.17em;
  color: var(--faint);
  text-transform: uppercase;
}
.label.accent { color: var(--coral-ink); }

/* ---- the day opener ---- */

/* ---- the title page ---- */

.title-page { padding: 104px 0 76px; }
.title-page h1 {
  margin: 18px 0 0; font-family: var(--sans); font-size: 84px; font-weight: 600;
  line-height: 0.98; letter-spacing: -0.035em; color: var(--ink);
}
.title-lead {
  margin: 22px 0 0; max-width: 30rem; font-size: 21px; line-height: 1.6; color: var(--ink-3);
}
.title-page .figures { padding-top: 40px; border-top: 1px solid var(--rule); margin-top: 44px; }

.day { padding-top: 72px; }
.day + .day { border-top: 1px solid var(--rule); margin-top: 72px; }

.day-head { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; }

.day h1 {
  margin: 26px 0 0;
  font-family: var(--sans);
  font-size: 58px;
  font-weight: 600;
  line-height: 1.06;
  letter-spacing: -0.02em;
}

.day-lead { display: flex; gap: 48px; align-items: flex-start; margin-top: 26px; }
.day-lead p { margin: 0; flex-grow: 1; font-size: 21px; line-height: 1.62; color: var(--ink-3); }

.figures { display: flex; gap: 36px; padding-top: 6px; }
.figure-n {
  font-family: var(--sans);
  font-size: 34px;
  font-weight: 600;
  color: var(--coral);
  line-height: 1;
}
.figure-l { font-family: var(--sans); font-size: 10px; font-weight: 500; letter-spacing: 0.16em;
  color: var(--faint); padding-top: 7px; text-transform: uppercase; }

/* ---- the route, the one image we can always produce ---- */

.route { background: var(--sand); border-radius: 14px; padding: 24px; margin-top: 40px; }
/* No fixed height: the drawing keeps the day's own proportions, and forcing a
   height would flatten it back into the line this replaced. */
.route svg { width: 100%; height: auto; display: block; }

/* The real map, once the tiles are in. The drawing stays in the DOM and comes
   back for print, where a WebGL canvas cannot be relied on. */
.route-map { height: clamp(260px, 44vh, 460px); border-radius: 10px; overflow: hidden; }
.route.has-map svg { display: none; }
.route.has-map { padding: 10px; }
.route .maplibregl-ctrl-attrib { font-family: var(--sans); font-size: 10px; }

/* A passage's own heading. Sans, so it reads as structure rather than as a
   louder sentence; well below the thirty-point stop name above it. */
.passage-title {
  font-family: var(--sans); font-size: 16px; font-weight: 600; line-height: 1.35;
  letter-spacing: -0.005em; color: var(--ink); margin: 30px 0 12px;
}
.passage-title:first-child { margin-top: 0; }
.corridor-body .passage-title { margin-top: 22px; }

/* ---- the traveller's own note ---- */

/* Coral rather than the sand the rest of the furniture uses. Sand is the
   guide's own voice — corridors, route maps, facts. Coral is this trip, and a
   note is the only thing on the page that belongs to the person reading it. */
.own-note {
  margin: 26px 0 0; padding: 14px 18px 4px;
  background: rgba(226, 87, 76, 0.055);
  border-left: 2px solid var(--coral); border-radius: 0 10px 10px 0;
}
.own-note .label { color: var(--coral-ink); }
/* The sans and a step down in size, so a long note never reads as another
   paragraph of the book. Scoped under .entry deliberately: the .entry p rule
   is declared later in this sheet at the same specificity, and an unscoped
   .own-note p loses font-size, colour and leading to it while keeping the
   family — which renders a note in twenty-point sans and looks like a
   mistake rather than a voice. */
.entry .own-note p {
  font-family: var(--sans); font-size: 15px; line-height: 1.6;
  color: var(--ink-3); margin: 7px 0 10px;
}
.own-link { color: var(--coral-ink); text-decoration: underline; text-underline-offset: 2px; }

/* ---- photography ---- */

figure { margin: 44px 0 0; }
/*
 * A stop's photograph reaches back across the rail.
 *
 * Not beside the prose, which was the other option and is arithmetically out:
 * the text column runs sixty-seven characters at twenty-point serif, and an
 * image taking even a third of it drops that to forty-two. This book already
 * made that mistake once, in two-column corridor prose that measured eighteen
 * characters a line, and Czech proper nouns are not short.
 *
 * So the picture goes below — but full width rather than the width of the
 * column. A photograph that stops short of the page's own edge reads as an
 * inset, something dropped into the argument. Reaching back across the rail
 * makes it a plate: a break in the reading, which is what it is for. It also
 * matches the chapter openers, which have always run the full width.
 *
 * Direct child only. Dish thumbnails are figures too and live in their own
 * grid, where a negative margin would shove them off the page.
 */
.entry-body > figure { margin-left: calc(-1 * (var(--rail) + var(--rail-gap))); }
figure img { width: 100%; height: 300px; object-fit: cover; border-radius: 14px; display: block; background: #DCD9CF; }
figcaption { display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding-top: 11px; font-family: var(--sans); font-size: 11px; color: var(--faint); }
.swap {
  font-family: var(--sans); font-size: 11px; font-weight: 500; letter-spacing: 0.06em;
  color: var(--ink); background: transparent; border: 1px solid #D8D3C6; border-radius: 999px;
  padding: 0 18px; min-height: 44px; cursor: pointer; white-space: nowrap;
}
.swap:hover { border-color: var(--faint); }

/* ---- a place ---- */

.entry { display: flex; gap: var(--rail-gap); padding-top: 58px; }
.entry-side { width: var(--rail); flex-shrink: 0; padding-top: 9px; }
.entry-when { font-family: var(--sans); font-size: 11px; color: var(--faint); padding-top: 9px; }
.entry-body { flex-grow: 1; min-width: 0; }
.entry h2 { margin: 0 0 18px; font-family: var(--sans); font-size: 30px;
  font-weight: 600; letter-spacing: -0.01em; }
.entry p { margin: 0 0 17px; font-size: 20px; line-height: 1.68; color: var(--ink-2); }
.entry p:last-child { margin-bottom: 0; }

/* ---- a corridor ----
   A tinted full-bleed band with a coral hairline. Corridors must read as a
   different kind of thing from places without being indented, because
   indentation would make them look subordinate and they are the point. */

.corridor {
  margin: 54px calc(50% - 50vw) 0;
  padding: 40px calc(50vw - 50% + 120px) 44px;
  background: var(--sand);
  border-top: 2px solid var(--coral);
}
.corridor-head { display: flex; align-items: center; gap: 14px; padding-bottom: 20px; flex-wrap: wrap; }
.corridor-head .dot { width: 4px; height: 4px; border-radius: 50%; background: #B3AC9B; }
.corridor-route { font-family: var(--sans); font-size: 11px; letter-spacing: 0.05em; color: #6E6A5E;
  text-transform: uppercase; }
/* Single column, deliberately. Two columns looked right in a mockup and
   measured 170px wide on a real page — about eighteen characters a line,
   against the forty-five a reader wants. The band already makes a corridor
   read as a different kind of thing; the columns were decoration that cost
   legibility to get it. */
.corridor-body { max-width: 34rem; }
.corridor-body p { margin: 0 0 16px; font-size: 19px; line-height: 1.7; color: #33404F; }
.corridor-body p:last-child { margin-bottom: 0; }

/* ---- the practical spine: hours, rating, the site ---- */

.facts {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 20px;
  margin: -6px 0 20px; padding-bottom: 16px; border-bottom: 1px solid var(--rule);
  font-family: var(--sans); font-size: 12px; color: var(--faint);
}
.facts b { font-weight: 600; color: var(--ink-3); }
.facts a { color: var(--faint); text-decoration: none; border-bottom: 1px solid var(--rule); }
.facts a:hover { color: var(--coral-ink); border-color: var(--coral-ink); }

/* ---- what the kitchen is known for ---- */

.dishes {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px; margin: 24px 0 0;
}
.dishes figure { margin: 0; }
/* An explicit auto height is load-bearing here: without it these inherit the
   300px meant for a chapter photograph and come out stretched. */
.dishes img { width: 100%; height: auto; aspect-ratio: 1; object-fit: cover;
  border-radius: 8px; display: block; background: var(--sand); }
.dishes figcaption { display: block; padding-top: 6px; font-family: var(--sans);
  font-size: 10px; letter-spacing: 0.04em; color: var(--faint); }

/* ---- computed passages say what they are ---- */

.computed {
  display: inline-flex; align-items: center; gap: 12px; margin-top: 4px;
  background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 13px 17px;
  font-family: var(--sans); font-size: 12px; color: var(--ink-3);
}
.computed svg { flex-shrink: 0; }

/* ---- claims ---- */

.claim {
  font-family: var(--sans); font-size: 11px; font-weight: 600;
  color: var(--coral-ink); padding-left: 2px; text-decoration: none;
  vertical-align: super; line-height: 0;
}
body[data-claims='off'] .claim { display: none; }

.checked { border-top: 1px solid var(--rule); margin-top: 64px; padding-top: 22px;
  display: flex; gap: 56px; }
.checked-list { flex-grow: 1; display: flex; flex-direction: column; gap: 9px;
  font-family: var(--sans); font-size: 12px; line-height: 1.6; color: var(--faint); }
.checked-list b { color: var(--coral-ink); }

/* ---- the reading surface at phone size ---- */

@media (max-width: 860px) {
  body { font-size: 17px; }
  .wrap { padding: 0 20px 56px; }
  .day h1 { font-size: 30px; }
  .title-page { padding: 56px 0 44px; }
  .title-page h1 { font-size: 46px; }
  .title-lead { font-size: 18px; }
  .day-lead, .entry, .checked { flex-direction: column; gap: 18px; }
  /* The rail is gone at this width, so there is nothing to reach back across
     and the offset would push the picture off the left of the screen. */
  .entry-body > figure { margin-left: 0; }
  .entry-side { width: auto; padding-top: 0; display: flex; align-items: baseline; gap: 12px; }
  .entry-when { padding-top: 0; }
  .entry h2 { font-size: 25px; }
  .passage-title { font-size: 15px; }
  .entry p, .corridor-body p { font-size: 18px; }
  .figures { gap: 24px; flex-wrap: wrap; }
  .corridor { margin: 40px -20px 0; padding: 32px 20px 34px; }
  .route { padding: 22px 20px 16px; }
  /* Five names will not fit across a phone and ran off the edge of the box.
     The ends are what orient a reader; the middle is on the page below. */
  .route-stops span { font-size: 9px; letter-spacing: 0.08em; }
  .route-stops span:not(:first-child):not(:last-child) { display: none; }
  figure img { height: 200px; }
  .dishes { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .facts { font-size: 11px; gap: 4px 14px; }
}

/* ---- paper survives a dead battery and a roaming charge ---- */

@media print {
  body { background: #fff; font-size: 11pt; }
  .wrap { max-width: none; padding: 0; }
  /* Everything that is chrome rather than the book. The reader owns these ids
     and the renderer does not, but print is the one place the two meet. */
  .swap, .controls, .build-tag, #auth, #status, #intro, #now, dialog { display: none; }
  .day { break-before: page; padding-top: 0; }
  /* The title page owns page one and pushes the first chapter onto page two,
     which is what the old .day:first-child exception was standing in for back
     when there was no cover to break after. */
  .title-page { break-after: page; padding: 0 0 24pt; }
  .title-page h1 { font-size: 40pt; }
  .entry, .corridor { break-inside: avoid; }
  /* The sand band is a screen device. On paper twenty-three of them are the
     single biggest thing on the page by area, and a laser prints that as a
     grey slab the prose has to sit inside. The coral rule already does the
     work the band was doing: this is a new section, look up. */
  .corridor { margin: 24pt 0 0; padding: 12pt 0 0; border-top: 1.5pt solid var(--coral); background: none; }
  .route { background: none; padding: 0; }
  figure img { height: 160pt; }
  .dishes { grid-template-columns: repeat(6, 1fr); gap: 6pt; }
  .facts { color: #444; }
  /* The most practical thing on the page, so it prints — but a tint that is
     invisible on screen turns into a grey slab on paper. Rule only. */
  .own-note { background: none; border-left: 1.5pt solid var(--coral); padding: 2pt 0 2pt 10pt; }
  .entry .own-note p { font-size: 9.5pt; }
  .route-map { display: none; }
  .route.has-map svg { display: block; }
  .route.has-map { padding: 16pt; }
  a { color: inherit; text-decoration: none; }
  .claim { color: var(--coral-ink); }
}
`
