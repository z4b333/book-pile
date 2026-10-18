# กองดอง · Book Pile

ค้นหาหนังสือไทย เก็บไว้ซื้อทีหลัง

Search Thai and Thai-translated books across the web, then save them to a personal library to
buy or download later — each saved book carries links to every Thai shop, international store,
and free library that has it.

No build step, no dependencies, no account. Works as static files; an optional Node helper makes
the Thai shop lookups faster.

## Run it

```bash
node server.js
```

Then open http://localhost:5500.

`server.js` is optional. Any static server (`python -m http.server 5500`) works too — the app
detects the helper is missing and routes shop requests through a public reader instead. See
**Reaching the Thai shops** below.

## What it does

**Search** runs every source independently and merges the results:

| Source | What it adds | Key needed |
| --- | --- | --- |
| **meb** (mebmarket.com) | Thailand's largest e-book shop — cover, title, author, ISBN, category, price, direct product link. **Needs `node server.js`** (see below) | No |
| **SE-ED** (se-ed.com) | The shop's own search API — cover, title, price, year, and an ISBN in the SKU | No |
| [Google Books](https://developers.google.com/books) | Thai e-books (SE-ED, Amarin and others publish here), descriptions, prices, buy links. `langRestrict=th` in Thai scope | No |
| [Open Library](https://openlibrary.org/developers/api) | Covers, ISBNs, borrow/read-free status. `language=tha` in Thai scope | No |
| [วิกิซอร์ซ / Thai Wikisource](https://th.wikisource.org) | Public-domain Thai literature — Sunthorn Phu, royal chronicles, old law codes — free in full | No |
| [Project Gutenberg](https://gutendex.com) via Gutendex | Public-domain works, mostly English (off by default) | No |

Each source has a 12-second timeout and renders as soon as it lands, so one slow or
rate-limited API never blocks the others. Duplicates collapse by ISBN, falling back to a
title + author fingerprint — SE-ED returns real ISBNs, so its results merge with the Google
Books and Open Library records for the same book rather than appearing twice.

### Reaching the Thai shops

Neither shop publishes an API for third parties and neither sends CORS headers, so the browser
cannot call them directly. They are reached in two different ways, and the difference matters:

**SE-ED** is read through its own JSON search API (`mp-api.se-ed.com/web-bff/search-product`),
a plain GET. That works through either proxy — the local helper (~400ms) or the public reader
(~1.3s) — and returns identical bytes, so one parser covers both. SE-ED works everywhere,
including GitHub Pages.

**meb** is different. Its pages are built by script, so there is nothing in the HTML to scrape,
and its search endpoint (`ajax.php`) is **POST-only**. The public reader can only issue GETs,
so **meb only works when `server.js` is running**. When it is not, the meb source is disabled
in the UI with a note, rather than quietly returning nothing.

The meb payload is fussy and was taken from the site's own request: `sort` must be
`{by, type}` (not `sort_by`), and empty fields must be omitted rather than sent as `""` — it
rejects both mistakes with its own error codes. Its responses are HTML-encoded even over the
API, so text is decoded before use.

> **Earlier versions of this README claimed meb worked without the helper.** It did, briefly,
> because `r.jina.ai` used to execute JavaScript on the free tier. It no longer does —
> `x-engine: browser` now returns `401` — so scraping meb's rendered HTML stopped working.
> Hitting the real API is both the fix and a better source: it carries ISBNs, so meb results
> now merge with Google Books and Open Library entries instead of duplicating them.

**Naiin cannot be searched at all.** Its product pages fetch fine, but `/search` is behind
Cloudflare and answers `403` to any automated request. It stays a link-only shop.

The local helper only proxies hosts on its allowlist, so it never becomes an open relay.

### Thai focus

**Language scope** defaults to **ไทย Thai only**, which filters Google Books and Open Library
to Thai and switches วิกิซอร์ซ on. Non-Thai hits are not hidden — they sink below the Thai ones,
because the Thai edition of an English book is often what you are actually after.

**Thai books are badged** ไทย, or **แปลไทย** when the book is in Thai but the author's name is in
Latin script — i.e. a translation. Detection uses the source's own language metadata, falling
back to Thai script in the title.

**Thai shops come first** in the links panel. These are search URLs for browsing the shop
directly — each pattern was confirmed against the live site:

| Shop | Pattern |
| --- | --- |
| SE-ED ซีเอ็ด | `se-ed.com/search?filter.keyword=` |
| นายอินทร์ Naiin | `naiin.com/search?keyword=` |
| meb (อีบุ๊ก) | `mebmarket.com/index.php?action=search_book&type=all&search=` |
| ศูนย์หนังสือจุฬาฯ | `chulabook.com/categories?text=` |
| B2S | `b2s.co.th/search?q=` |
| Kinokuniya ไทย | `kinokuniya.co.th/search?q=` |
| วัชรญาณ (free) | `vajirayana.org/search/node/` |

For a **non-Thai** book, two extra links — *หาฉบับแปลไทย* on SE-ED and meb — search those shops
for a Thai edition of the same title.

Thai shop searches use the title alone; their search engines do worse with an author appended.

**International links** follow: Amazon, Bookshop.org, Barnes & Noble, Kobo, Apple Books,
AbeBooks (used), WorldCat (borrow from a library), Standard Ebooks. These use the ISBN when one
is known, so they land on the right edition.

**The library** stores books under three statuses — *To buy*, *To download*, *Got it* — each with
a note. Filter, sort, export to JSON, import it back.

## Formats

Books are tagged **นิยาย**, **ไลท์โนเวล**, **การ์ตูน** and **อีบุ๊ก**, and the format chips on the
search page narrow results to any of the ticked tags. Tags also show on every card and in the
library, where the text filter matches them — typing `การ์ตูน` finds the manga you saved.

These are not one dimension, so a book carries a *set* rather than a single label. A light
novel sold as a PDF is both ไลท์โนเวล and อีบุ๊ก, and ticking either chip finds it. The kind
tags are mutually exclusive and resolved most-specific-first, so a graphic novel is การ์ตูน and
never also นิยาย, and ไลท์โนเวล is never doubled up as นิยาย.

Detection reads each source's own category data plus the title: meb and SE-ED category names,
Google Books categories, Open Library subjects. `อีบุ๊ก` is separate and factual rather than
guessed — meb sells only e-books, SE-ED says which catalogue a product came from, Google Books
reports EPUB/PDF availability, Open Library reports its ebook access, and Gutenberg and
วิกิซอร์ซ are digital by definition.

Classification is only as good as the categories the shops publish; a book filed under nothing
useful gets no kind tag rather than a wrong one.

## Same series

Opening a book shows the other volumes in its series, ordered by volume number, with covers and
prices. Clicking one opens that book, so a series can be browsed without going back to search.

There is no series ID to rely on — meb's `series_issue_id` turns out to be the *volume* number,
not a series key — so siblings are grouped by title instead: volume markers (`เล่ม 7`, `vol. 3`,
bracketed notes like `(PDF)` or `(จบ)`) are stripped, and books sharing the remaining base are
treated as one series.

This costs no extra requests. The availability check already queries meb and SE-ED when a dialog
opens; it now searches the *series base* rather than the exact title, so one search per shop
answers both questions.

Volume numbers are compared before titles when deciding whether two entries are the same book.
Plain text containment makes `เล่ม 2` look like a match for `เล่ม 21`, which would wrongly hide a
volume from the strip and mislabel shop availability.

## Shop availability

Opening a book shows where to get it. Those rows are not all equally certain, so the dialog
says which is which rather than presenting every shop as a sure thing:

| State | Meaning |
| --- | --- |
| **มีเล่มนี้** (green) | A source returned this exact book. The link goes straight to the product page. |
| **กำลังตรวจ…** | meb or SE-ED is being queried right now. |
| **ไม่พบ** (dimmed, dashed) | That shop was queried and had nothing matching. |
| **ตรวจไม่ได้** | The check itself failed — not the same as the shop not stocking it. |
| no label change | The shop has no API we can reach, so the link is an honest search guess. |

Only meb and SE-ED can be checked, because they are the two shops with a reachable search.
Naiin, Chulabook, B2S, Kinokuniya and the international stores are never dimmed — we have no
way to know, and greying them out would be a guess dressed up as a fact.

Checks run when the dialog opens and are cached per book for the session. Titles are matched
loosely in both directions, since shop listings add volume numbers, `(PDF)` and box-set
wording to the same book.

## Look and feel

The interface is in Thai. Two controls sit in the top right:

- **Theme** — light / dark, overriding the system preference. Click cycles between them.
- **Accent** — eight hues (ส้มอิฐ, ชาด, ชมพู, บานเย็น, ม่วง, คราม, ฟ้า, เขียว).

Both persist in `localStorage` under `bookpile/prefs` and are applied before first paint, so
there is no flash of the wrong colour on reload.

Colour is built on a single custom property. `--accent-h` is a hue, and every accent shade —
plus the subtle tint in the backgrounds, borders and muted text — is derived from it in OKLCH,
with separate lightness values for light and dark. Changing the accent sets that one number;
nothing else in the stylesheet has to know. The *free* green and *Thai* blue badges are
deliberately fixed, so a badge never changes meaning when the accent changes.

This relies on OKLCH and `color-mix()`, which need a 2023-or-newer browser (Chrome 111+,
Safari 16.4+, Firefox 113+).

## Where the data lives

In `localStorage` under the key `bookpile/v1`, in your browser only. Nothing is sent anywhere
except the book APIs above. Clearing site data clears the library — use **Export** first.

## Deploying to GitHub Pages

The app is static, so Pages serves it as-is. `server.js` is not uploaded-and-run by Pages —
Pages only serves files — so the shop lookups fall back to the public reader automatically.
SE-ED, Google Books, Open Library and วิกิซอร์ซ all work there. **meb does not** — its endpoint
is POST-only and needs the helper, so the page disables that source and says so.

```bash
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
The site appears at `https://<user>.github.io/<repo>/` within a minute or two.

Notes:

- Pages from a **private** repo needs a paid GitHub plan. A public repo works on the free tier.
- Everything the page calls is HTTPS, so there is no mixed-content problem.
- `server.js` stays useful locally — clone, `node server.js`, and the SE-ED lookups go direct
  instead of through the reader. The page detects which case it is on its own.

## Files

- [index.html](index.html) — markup for both views and the details dialog
- [styles.css](styles.css) — all styling, light and dark
- [app.js](app.js) — sources, proxy fallback, merging, store links, library, rendering
- [server.js](server.js) — optional: static server + allowlisted shop proxy

## Known gaps

- **meb needs the local helper.** On GitHub Pages the meb source is switched off and the chip
  is greyed out. Everything else — SE-ED, Google Books, Open Library, วิกิซอร์ซ — works there.
- **Naiin** is link-only: its search is Cloudflare-protected (`403`), so it cannot be a result
  source. Its product pages do load, but that does not help you find a book you cannot search for.
- **Thai shop search is fuzzy, and is now filtered.** SE-ED returns 20 loosely-related titles
  rather than nothing when it has no real match — "Assassination Classroom" came back with
  "Google Classroom". Results it returns must now contain the whole query phrase, or every word
  of a multi-word query, in the title or author. A shop with no genuine match returns nothing
  instead of a page of wrong answers. The trade-off is that an author-only search may drop
  SE-ED, since its search API gives no author for physical books; Google Books and Open Library
  cover that case.
- The shop sources read public listing pages the way a browser does. That is fine for personal
  use; do not point them at bulk or automated traffic.
- **Hytexts**, **Asia Books**, **Ookbee** and **ReadAWrite** were left out on purpose: their
  searches run in JavaScript without changing the URL, so there is no link to deep-link to.
- Open Library often returns the **English work record** for a translated book, so a Thai
  translation may show its English title. The Thai shop links still search that title, which
  usually finds the Thai edition.
- Google Books may answer `429` from shared or datacenter IPs. Adding an API key to the URL in
  `app.js` raises the limit.

## Possible next steps

- Scrape live Thai prices instead of linking to a search (needs a small proxy — the shops send
  no CORS headers)
- Thai-language UI toggle for the rest of the interface
- Tags or shelves beyond the three statuses
- An ISBN barcode scanner on mobile via the camera
