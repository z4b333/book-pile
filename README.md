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
| **meb** (mebmarket.com) | Thailand's largest e-book shop — cover, title, author, ISBN, category, price, direct product link | No |
| **SE-ED** (se-ed.com) | The shop's own search API — cover, title, price, year, and an ISBN in the SKU | No |
| **Kinokuniya ไทย** (kinokuniya.co.th) | Shopify predictive search — English and imported titles, cover, price, publisher, ISBN | No |
| [Open Library](https://openlibrary.org/developers/api) | Covers, ISBNs, borrow/read-free status. `language=tha` in Thai scope | No |
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

**meb** has no HTML worth scraping — its pages are built by script — so it calls the same
`ajax.php` endpoint the site uses. The site POSTs to it, which would have tied meb to the local
helper, since no public proxy will forward a POST. It turns out `ajax.php` reads its parameters
from the query string too, so it can be fetched as a GET and works through the reader like
everything else. **Nothing needs to be installed.**

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

### Which shops can be searched, and which block it

Not every shop can be a search source. What each one allows:

| Shop | Searchable? | How |
| --- | --- | --- |
| **SE-ED** | Yes, anywhere | Its own JSON search API, a plain GET |
| **Kinokuniya ไทย** | Yes, anywhere | Shopify predictive search (`/search/suggest.json`); the product handle is the ISBN |
| **meb** | Yes, anywhere | Its own `ajax.php`, which reads parameters from the query string as well as a POST body |
| **Naiin** | **No** | `/search` answers `403` from Cloudflare to any automated request |
| **B2S** | Not yet | Has a REST API, but the query travels in a POST body that has not been worked out |
| **Chulabook**, **วัชรญาณ** | Not investigated | Link-only for now |

Naiin is the genuinely blocked one, and deliberately so. Its `robots.txt` says, for every
user-agent:

```
User-agent: *
Allow: /
Disallow: /api/v1
Disallow: /search-result
Disallow: /autocomplete
```

Its product pages are allowed and do fetch fine; search, autocomplete and the API are not, and
the Cloudflare `403` enforces that. So this is not a bug to route around — getting past it would
mean defeating bot protection against the shop's stated wishes. **Naiin will stay unsearchable
here.** A book sold only on Naiin will not appear in results.

What the app does instead: after every search it offers a one-click manual search at the shops
it is not allowed to query, pre-filled with what you typed, and the Naiin row in a book's links
panel is marked *ค้นเองในเว็บ* with a note explaining why its stock cannot be checked. It is
never greyed out as "ไม่พบ", because nothing is known about its stock either way.

The only legitimate ways to change this would be an official API or affiliate feed from Naiin,
or crawling the product URLs in their published `sitemap.xml` — allowed by robots.txt, but a
disproportionate amount of machinery for one shop.

A book's links panel is split in two: **ซื้อหรือยืม** for the shops whose stock was actually
checked, and **ตรวจสต็อกให้ไม่ได้ — ค้นเอง** for the rest. Without that split the handful of
useful answers were lost among a dozen links that only say "go and look".

Shops that cannot be searched are never dimmed in the links panel. Not knowing is not the same
as knowing a shop lacks the book, and greying them out would be a guess presented as a fact.

### Thai focus

**Searching by field** (ทั้งหมด / ชื่อเรื่อง / ผู้แต่ง / ISBN) reaches every source. meb scopes
natively — its filter accepts `title` and `author` — while SE-ED and Kinokuniya, whose search
takes only a keyword, are narrowed afterwards against the chosen field. Author search falls back
to matching the title for shops that publish no author field, where the name usually appears in
the title anyway.

**Language scope** defaults to **ไทย Thai only**, which filters Open Library to Thai and
switches วิกิซอร์ซ on. Non-Thai hits are not hidden — they sink below the Thai ones,
because the Thai edition of an English book is often what you are actually after.

**Thai books are badged** ไทย, or **แปลไทย** when the book is in Thai but the author's name is in
Latin script — i.e. a translation. Detection uses the source's own language metadata, falling
back to Thai script in the title. These badges, and the *ฟรี* one, are derived when a card is
drawn rather than stamped onto search results, so books restored from an **Import** or saved by
an older version badge the same as freshly-searched ones.

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

**International links** follow: Amazon, Amazon SG (which ships to Thailand), Kobo and Apple
Books. They use the ISBN when one is known, so they land on the right edition — but none of
them can be checked either, so they carry the same ค้นเอง flag as the Thai shops we cannot
query. Barnes & Noble was dropped, since it does not realistically serve Thailand.

**The library** stores books under three statuses — *To buy*, *To download*, *Got it* — each with
a note. Filter, sort, export to JSON, import it back.

## Filters

Four rows narrow a search, and all of them work on what the sources actually report rather than
on guesses:

| Row | Options | Where it comes from |
| --- | --- | --- |
| **ภาษา** | ไทย · อังกฤษ · อื่นๆ · ทั้งหมด | the source's language metadata, falling back to the title's script |
| **ประเภท** | นิยาย · สารคดี · ไลท์โนเวล · การ์ตูน | each shop's own category text |
| **รูปแบบ** | หนังสือเล่ม · อีบุ๊ก | each source states whether its edition is digital |
| **แหล่ง** | the six sources | ticked by hand |

Genre is resolved most-specific-first, so a graphic novel is การ์ตูน and never also นิยาย. A book
whose categories say nothing useful gets **no** genre rather than a wrong one, which means it
will not match a genre filter — a deliberate choice over mislabelling it.

Changing **ภาษา** re-runs the search, because it changes what the sources are asked for (Open
Library's language parameter, Gutenberg's, and whether วิกิซอร์ซ is included). The other rows
filter what is already on screen, and a line under the status says how many books are hidden.

### Sources follow the format

Picking a รูปแบบ switches off the shops that cannot serve it, so the row never offers a
pointless search: meb, วิกิซอร์ซ, Gutenberg and Internet Archive are digital only, Kinokuniya is
print only, SE-ED and Open Library carry both. AniList switches off for either, because a
catalogue entry is a work rather than an edition and has no รูปแบบ to match — its cards are
badged *ซีรีส์* with a volume count instead. Only sources switched off this way are switched back
on, so neither the page's defaults nor a shop you unticked get overridden.

## Arranging results

A **เรียงตาม** control sits above the results:

| Option | Orders by |
| --- | --- |
| ตรงที่สุด | the order the sources returned — the default |
| ราคาน้อย → มาก / มาก → น้อย | price |
| ชื่อ ก–ฮ | title, using Thai collation |
| ปีใหม่ → เก่า | publication year |
| ฟรีก่อน | books with a free link first |
| จัดกลุ่มตามแหล่ง | source, then title |

Books with nothing to sort on sink to the bottom rather than bunching at the top: an unpriced
catalogue entry should not lead a cheapest-first list. Sorting works on a copy, so switching
back to **ตรงที่สุด** restores the sources' own order rather than an approximation of it.

## One card per book, not per printing

The same book is listed many times over — a paperback, a box set, a PDF, a reprint with a fresh
ISBN. Matching on ISBN alone keeps them all apart, because every printing has its own, so the
results filled up with near-identical rows and genuinely different books fell off the end.

Editions now collapse into a single card, marked *N ฉบับ*, carrying the links of every shop that
had one. Two things are deliberately **not** merged:

- **Volumes.** เล่ม 1 and เล่ม 2 are different books. The volume number is part of the key, and is
  read before any title comparison, since `เล่ม 2` is otherwise a substring of `เล่ม 21`.
- **Printed vs e-book.** These stay separate cards, because choosing between them is usually the
  point.

This is why the app does not simply keep one result per shop, which was the obvious fix: that
would have hidden real volumes of a series behind whichever one happened to be first.

### Shops that cannot be searched

Most Thai e-book, light-novel and manga platforms cannot be queried from here, each for its own
reason. Rather than leave them out, every one is offered as a flagged **ค้นเอง** button that
opens its own search with what you typed — under the results, and in every book's links panel.
They are never shown as *ไม่พบ*, because nothing is known about their stock.

| Site | Why not automatic |
| --- | --- |
| **Naiin** | `robots.txt` disallows `/search-result`; Cloudflare answers `403` |
| **Fictionlog** | `robots.txt` disallows `/api/*`, and the page loads its results from that API |
| **Yaakz** | `robots.txt` disallows `/api/`; the page is server-rendered but the data is a serialized graph |
| **Hytexts** | search runs in JavaScript and returns a 3 KB shell to a plain fetch |
| **BookWalker** | global search redirects to a migration path that answers `403` |
| **ReadAWrite** | the keyword is echoed but never applied, so its search has no URL |
| **PhoenixNext** | a site-builder page with no searchable catalogue |

ReadAWrite and PhoenixNext have no URL-addressable search at all, so their buttons open the site
itself rather than a pre-filled query.

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

## Installing on a phone

The site ships a web app manifest and icons, so it can be added to a home screen and runs
full-screen with no browser chrome. On Android use Chrome's *Install app* / *Add to Home
screen*; on iOS use Share → *Add to Home Screen*. The icons are committed as PNGs, including a
maskable variant with the safe-zone padding Android expects; `node scripts/make-icons.js`
regenerates them and needs no dependencies.

There is no service worker yet, so the app still needs a connection — every search queries
live shops regardless.

## First-run guide

A short Thai walkthrough opens on a first visit: how searching works, what the filters do, how
to save into the pile, what the availability colours mean, series browsing, and the fact that
data lives only in that browser.

It carries a **ไม่ต้องแสดงอีก** checkbox. Closing without ticking leaves it to open again next
time; ticking it stores `seenGuide` in `bookpile/prefs`. Either way the **?** button in the
header reopens it, and unticking the box inside restores it on future visits — so the
explanation cannot be lost by clicking the wrong thing.

The dialog scrolls, and its footer is pinned to the bottom, because the guide is taller than a
phone screen and the checkbox would otherwise sit below the fold.

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
Every source works there, meb included. Measured on a plain static server with no helper
running: meb 3.4s, SE-ED 1.2s, Kinokuniya 2.2s, and 4.3s for all three in parallel.

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

- **Naiin** is link-only: its search is Cloudflare-protected (`403`), so it cannot be a result
  source. Its product pages do load, but that does not help you find a book you cannot search for.
- **B2S** has a usable-looking REST API whose query is in a POST body; adding it would be the
  next source worth the effort.
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
- **No book descriptions or page counts.** Google Books was the only source that carried them
  and it has been removed; Open Library's search fields do not include a description. Re-adding
  Google Books is a small change if you miss them.
- **Amazon cannot be a search source.** Its Product Advertising API needs an Associates account
  and keys, scraping its search pages means defeating bot protection, and the public reader
  blocks `amazon.com` outright (`AbuseAlleviationError`). It stays a link — now to both the US
  store and **Amazon SG**, which ships to Thailand.

## Possible next steps

- Scrape live Thai prices instead of linking to a search (needs a small proxy — the shops send
  no CORS headers)
- Thai-language UI toggle for the rest of the interface
- Tags or shelves beyond the three statuses
- An ISBN barcode scanner on mobile via the camera
