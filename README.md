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
| **meb** (mebmarket.com) | Thailand's largest e-book shop — cover, title, author, category, direct product link | No |
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
cannot call them directly. Requests go through a proxy, picked per request:

- **`server.js`** (local, ~400ms) — a dependency-free Node helper that serves the static files
  and forwards requests to an allowlist of shop hosts. It is a plain fetch.
- **`r.jina.ai`** (public, ~1.3s) — used when `server.js` is not running, and *always* for meb.

Why meb always uses the public one: meb writes its results in with JavaScript, so a plain fetch
returns an empty shell. The public reader runs a real browser, so it sees the rendered page.
SE-ED needs no rendering because it is read through its own JSON search API, which returns the
same bytes over either route — one parser covers both.

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
That path is tested: on a plain static server the same search returns the same 47 results
(meb 6, SE-ED 20, วิกิซอร์ซ 20), just ~1s slower per shop.

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

- **meb results carry no price.** meb only shows a price on the product page, not in search
  results. SE-ED prices are included.
- **Naiin** is link-only: its Cloudflare rules reject automated requests, so it cannot be a
  result source, and its URL pattern is the one that could not be confirmed from this machine.
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
