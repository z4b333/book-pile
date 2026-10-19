/* กองดอง (Book Pile) — Thai book search + save-for-later library.
   No build step, no backend. Data lives in localStorage. */

const STORAGE_KEY = 'bookpile/v1';
const PREFS_KEY = 'bookpile/prefs';

/* Keys this app stored under before it was renamed, newest first. Whatever is
   found under an old name is adopted and the old name cleared, so renaming
   the app never costs anyone their pile. */
const LEGACY_KEYS = {
  [STORAGE_KEY]: ['kongdong/v1', 'shelf-later/v1'],
  [PREFS_KEY]: ['kongdong/prefs'],
};

function readStored(key) {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    for (const old of LEGACY_KEYS[key] || []) {
      const value = localStorage.getItem(old);
      if (value === null) continue;
      localStorage.setItem(key, value);
      localStorage.removeItem(old);
      return value;
    }
  } catch { /* storage unavailable — fall through to the default */ }
  return null;
}
const STATUSES = {
  buy: 'รอซื้อ',
  download: 'รอโหลด',
  have: 'ได้แล้ว',
};

/* ------------------------------------------------------------ appearance */

/* One hue drives every accent shade (see styles.css), so a theme is just a
   number plus light/dark. Both are applied before first paint. */
const ACCENTS = [
  { name: 'ส้มอิฐ', h: 45 },
  { name: 'ชาด', h: 28 },
  { name: 'ชมพู', h: 355 },
  { name: 'บานเย็น', h: 330 },
  { name: 'ม่วง', h: 295 },
  { name: 'คราม', h: 265 },
  { name: 'ฟ้า', h: 230 },
  { name: 'เขียว', h: 160 },
];

const prefs = (() => {
  try {
    return {
      accent: 45, theme: 'auto', seenGuide: false, collections: [],
      ...JSON.parse(readStored(PREFS_KEY) || '{}'),
    };
  } catch {
    return { accent: 45, theme: 'auto', seenGuide: false, collections: [] };
  }
})();

function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--accent-h', prefs.accent);
  if (prefs.theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prefs.theme);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* private mode — the look just resets next visit */ }
}

applyPrefs();

/* ------------------------------------------------------------------ state */

let library = load();
let results = [];
let searchSeq = 0;
let activeStatus = 'all';

function load() {
  try {
    const parsed = JSON.parse(readStored(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {
    toast('บันทึกไม่ได้ — เบราว์เซอร์ไม่ให้เก็บข้อมูล');
  }
}

/* ------------------------------------------------------------------ utils */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/** Lowercase and strip punctuation, but keep Thai script — stripping it would
    reduce every Thai title to an empty string, collapsing unrelated books
    onto one fingerprint and breaking library search. */
function slug(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]+/g, ' ')
    .trim();
}

/** Stable identity so the same book from two sources collapses into one row. */
function fingerprint(book) {
  if (book.isbn13) return `isbn:${book.isbn13}`;
  if (book.isbn10) return `isbn:${book.isbn10}`;
  const author = slug((book.authors || [])[0] || '').split(' ').slice(-1)[0];
  return `t:${slug(book.title).slice(0, 60)}|a:${author}`;
}

function mergeBooks(a, b) {
  const out = { ...a };
  for (const key of ['cover', 'description', 'publisher', 'year', 'pages', 'isbn13', 'isbn10']) {
    if (!out[key] && b[key]) out[key] = b[key];
  }
  if ((b.authors || []).length > (out.authors || []).length) out.authors = b.authors;
  out.sources = [...new Set([...(out.sources || []), ...(b.sources || [])])];
  out.languages = [...new Set([...(out.languages || []), ...(b.languages || [])])];
  out.shopLinks = { ...(b.shopLinks || {}), ...(out.shopLinks || {}) };
  out.digital = out.digital || b.digital;
  out.freeLinks = dedupeLinks([...(out.freeLinks || []), ...(b.freeLinks || [])]);
  out.subjects = [...new Set([...(out.subjects || []), ...(b.subjects || [])])].slice(0, 8);
  return out;
}

function dedupeLinks(links) {
  const seen = new Set();
  return links.filter((l) => !seen.has(l.url) && seen.add(l.url));
}

/* ------------------------------------------------------------------ fetch */

const SOURCE_TIMEOUT = 12000;

/** Abort on either the user's next search or this source taking too long. */
function timedSignal(signal) {
  const limit = AbortSignal.timeout(SOURCE_TIMEOUT);
  return AbortSignal.any ? AbortSignal.any([signal, limit]) : signal;
}

async function getJSON(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal: timedSignal(signal), headers: { Accept: 'application/json' } });
  } catch (err) {
    if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    throw Object.assign(new Error('unreachable'), { code: err.name === 'TimeoutError' ? 'timeout' : 'offline' });
  }
  if (res.status === 429) throw Object.assign(new Error('rate limited'), { code: 'rate-limit' });
  if (!res.ok) throw Object.assign(new Error(`${res.status}`), { code: 'http' });
  return res.json();
}

/* --------------------------------------------------- source: Open Library */

async function searchOpenLibrary({ field, term, lang }, signal) {
  const params = new URLSearchParams({ limit: '20' });
  const key = { title: 'title', author: 'author', isbn: 'isbn' }[field] || 'q';
  params.set(key, field === 'isbn' ? term.replace(/[^0-9Xx]/g, '') : term);
  // Open Library's language filter drops real Thai books — many work records
  // carry no Thai language tag at all ("สี่แผ่นดิน" returns 1 hit unfiltered,
  // 0 with language=tha). A Thai-script query already constrains the results,
  // so only filter when the user typed Latin script and wants Thai editions.
  // Open Library's own language filter drops real Thai books, so it is only
  // used when the typed script cannot already imply the language.
  if (lang === 'th' && !THAI_SCRIPT.test(term)) params.set('language', 'tha');
  if (lang === 'en') params.set('language', 'eng');
  params.set('fields', [
    'key', 'title', 'subtitle', 'author_name', 'first_publish_year', 'publisher',
    'number_of_pages_median', 'cover_i', 'isbn', 'subject', 'ebook_access', 'ia', 'language',
  ].join(','));

  const data = await getJSON(`https://openlibrary.org/search.json?${params}`, signal);
  return (data.docs || []).map((d) => {
    const isbns = d.isbn || [];
    const freeLinks = [];
    const olUrl = `https://openlibrary.org${d.key}`;

    if (d.ebook_access === 'public') {
      freeLinks.push({ label: 'Open Library (read free)', url: olUrl, kind: 'free read' });
      if (d.ia?.[0]) {
      }
    } else if (d.ebook_access === 'borrowable') {
      freeLinks.push({ label: 'Open Library (borrow)', url: olUrl, kind: 'free borrow' });
    }

    return {
      title: d.title + (d.subtitle ? `: ${d.subtitle}` : ''),
      authors: d.author_name || [],
      year: d.first_publish_year ? String(d.first_publish_year) : null,
      publisher: d.publisher?.[0] || null,
      pages: d.number_of_pages_median || null,
      description: null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      isbn13: isbns.find((i) => i.length === 13) || null,
      isbn10: isbns.find((i) => i.length === 10) || null,
      subjects: (d.subject || []).slice(0, 8),
      price: null,
      buyLink: null,
      infoLink: olUrl,
      languages: d.language || [],
      digital: d.ebook_access === 'public' || d.ebook_access === 'borrowable',
      sources: ['Open Library'],
      freeLinks,
    };
  });
}

/* ----------------------------------------------------------- editions */

/* The same book is listed many times over: a paperback, a box set, a PDF, a
   reprint with a new ISBN. Matching on ISBN alone keeps them apart, because
   every printing has its own. These collapse into one card.

   Volume numbers stay distinct, so เล่ม 1 and เล่ม 2 never merge, and the
   media type is part of the key, so a printed copy and an e-book of the same
   title remain separate cards — you are usually choosing between them. */
function editionKey(book) {
  const base = slug(seriesBase(book.title)) || slug(book.title);
  const volume = volumeOf(book.title) ?? '';
  const author = slug((book.authors || [])[0] || '').split(' ').pop() || '';
  return `${base}#${volume}#${author}#${mediaOf(book) || 'work'}`;
}

function groupEditions(books) {
  const groups = new Map();
  for (const book of books) {
    const key = editionKey(book);
    const seen = groups.get(key);
    if (!seen) {
      groups.set(key, { ...book, editions: 1 });
      continue;
    }
    const merged = mergeBooks(seen, book);
    merged.editions = (seen.editions || 1) + 1;
    groups.set(key, merged);
  }
  return [...groups.values()];
}

/* ------------------------------------------------- matching & series */

const THAI_DIGITS = { '๐':'0','๑':'1','๒':'2','๓':'3','๔':'4','๕':'5','๖':'6','๗':'7','๘':'8','๙':'9' };
const arabic = (str) => String(str).replace(/[๐-๙]/g, (d) => THAI_DIGITS[d]);

/** Volume number, if the title carries one. */
function volumeOf(title) {
  const m = String(title || '').match(/(?:เล่ม|ตอนที่|vol\.?|volume|#)\s*([\d๐-๙]+)/i);
  return m ? Number(arabic(m[1])) : null;
}

/** The title with its volume markers removed, so every book in a series
    reduces to the same string. */
function seriesBase(title) {
  return String(title || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(เล่ม|ตอนที่|ภาค|vol\.?|volume|book|part)\s*[\d๐-๙]+(\s*[-–]\s*[\d๐-๙]+)?/gi, ' ')
    .replace(/[\d๐-๙]+\s*$/, ' ')
    .replace(/[-–—:,"'""]+\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this result actually answer the query? Thai shop search engines
    return 20 loosely-related titles rather than nothing, so "Assassination
    Classroom" comes back with "Google Classroom". Require the whole phrase,
    or every word of a multi-word query, somewhere in title or author. */
function matchesQuery(book, term, field = 'all') {
  const q = slug(term);
  if (!q) return true;
  const authors = book.authors || [];
  // Author search falls back to the title for shops that publish no author
  // field at all, where the name often appears in the title anyway.
  const parts = field === 'title' ? [book.title]
    : field === 'author' ? (authors.length ? authors : [book.title])
    : [book.title, ...authors];
  const hay = slug(parts.join(' '));
  if (hay.includes(q)) return true;
  const words = q.split(' ').filter(Boolean);
  return words.length > 1 && words.every((w) => hay.includes(w));
}

/** Loose title match for "is this the same book": shops add "(PDF)", box-set
    wording and so on. Volume numbers are compared first, because plain
    containment makes "เล่ม 2" look like a match for "เล่ม 21". */
function sameBook(a, b) {
  const va = volumeOf(a);
  const vb = volumeOf(b);
  if (va !== null && vb !== null && va !== vb) return false;
  const x = slug(a);
  const y = slug(b);
  if (!x || !y) return false;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  return long.includes(short) && short.length >= 4;
}

/* ------------------------------------------------- Thai shops (no API) */

/* Thai bookshops publish no API and send no CORS headers, so their pages are
   fetched through a proxy: the local helper in server.js when it is running,
   otherwise a public reader service. Both return raw HTML, so one parser
   covers either route. */

const LOCAL_PROXY = `${location.origin}/proxy`;
const READER = 'https://r.jina.ai/';
let localProxy = null; // null = not probed yet, true/false once known.

async function probeLocalProxy() {
  if (localProxy !== null) return localProxy;
  try {
    const r = await fetch(`${LOCAL_PROXY}/ping`, { signal: AbortSignal.timeout(1500) });
    localProxy = r.ok;
  } catch {
    localProxy = false;
  }
  return localProxy;
}

/** Fetch a page or API through whichever proxy is available.
    `format` is what the public reader should return: 'text' hands back the
    response body untouched (used for JSON APIs), 'html' renders the page in a
    real browser first. Pass needsJs for pages that only fill in via script —
    the local proxy is a plain fetch and would return an empty shell. */
async function proxyText(target, { format = 'text', needsJs = false } = {}, signal) {
  const attempts = [];
  if (!needsJs && await probeLocalProxy()) {
    attempts.push({ url: `${LOCAL_PROXY}?url=${encodeURIComponent(target)}`, headers: {} });
  }
  attempts.push({ url: READER + target, headers: { 'X-Return-Format': format } });

  let lastError;
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { signal: timedSignal(signal), headers: attempt.headers });
      if (res.status === 429) throw Object.assign(new Error('rate limited'), { code: 'rate-limit' });
      if (!res.ok) throw Object.assign(new Error(`${res.status}`), { code: 'http' });
      return await res.text();
    } catch (err) {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      lastError = err;
    }
  }
  throw lastError?.code ? lastError : Object.assign(new Error('unreachable'), { code: 'offline' });
}

/* meb — Thailand's largest e-book shop. Its pages are built by script, so
   there is nothing to scrape from the HTML; this calls the same endpoint the
   site itself uses. The site POSTs to it, but ajax.php reads its parameters
   from the query string too, so it can be fetched as a GET — which means it
   works through the public reader, with no local helper and nothing to
   install. The payload shape came from the site's own request: sort is
   {by, type}, and empty fields are omitted rather than sent as "". */
const MEB_API = 'https://www.mebmarket.com/ajax.php';

/** meb returns HTML-encoded text ("&ldquo;" and friends) even over its API. */
function decodeEntities(str) {
  if (!str || !str.includes('&')) return str || '';
  const area = document.createElement('textarea');
  area.innerHTML = str;
  return area.value;
}

const MEB_FILTER_TYPE = { title: 'title', author: 'author' };

async function searchMeb({ field, term }, signal) {
  const payload = {
    token: '',
    filter: { type: MEB_FILTER_TYPE[field] || 'all', value: term },
    sort: { by: 'date', type: 'desc' },
    exact_keyword: '', price: 'all', series_id: '', bundle_type: '',
    result_per_page: 40, page_no: 1, app_id: 'ASK', app_platform: 'WEB',
    content_type_list: null, debug_elastic: 1, category_group_id: '',
  };
  const query = new URLSearchParams({
    api: 'Store', method: 'userSearchBooks2', data: JSON.stringify(payload),
  });

  const body = await proxyText(`${MEB_API}?${query}`, { format: 'text' }, signal);
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error('bad payload'), { code: 'http' });
  }
  if (!data.status?.success) throw Object.assign(new Error('rejected'), { code: 'http' });

  return (data.data?.book_list || []).map((b) => {
    const url = `https://www.mebmarket.com/ebook-${b.book_id}-x`;
    const isbn = [b.isbn_ebook, b.isbn].find((i) => /^\d{13}$/.test(i || ''));
    const baht = Number(b.book_baht_price);
    return {
      title: decodeEntities(b.book_name),
      authors: b.book_author ? [decodeEntities(b.book_author)] : [],
      year: null,
      publisher: decodeEntities(b.book_publisher) || 'meb',
      pages: null,
      description: null,
      // The API hands back the thumbnail folder, not a file.
      cover: b.book_thumbnail_path ? `${b.book_thumbnail_path}web_large2.gif` : null,
      isbn13: isbn || null,
      isbn10: null,
      subjects: b.category_name ? [decodeEntities(b.category_name)] : [],
      volume: Number(b.series_issue_id) || null,
      price: Number.isFinite(baht) ? `฿${baht.toLocaleString('th-TH')}` : null,
      buyLink: url,
      infoLink: url,
      languages: ['tha'],
      digital: true,
      sources: ['meb'],
      shopLinks: { meb: url },
      freeLinks: [],
    };
  });
}

/* Kinokuniya Thailand runs on Shopify, whose predictive-search endpoint is a
   plain GET returning JSON. Unlike meb that works through either proxy, so
   this source is available on a static host too. The Shopify product handle
   is the ISBN, which lets these merge with the other sources. */
const KINO_ORIGIN = 'https://kinokuniya.co.th';

async function searchKinokuniya({ field, term }, signal) {
  const keyword = field === 'isbn' ? term.replace(/[^0-9Xx]/g, '') : term;
  const body = await proxyText(
    `${KINO_ORIGIN}/search/suggest.json?q=${encodeURIComponent(keyword)}`
      + '&resources[type]=product&resources[limit]=10',
    { format: 'text' },
    signal,
  );

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error('bad payload'), { code: 'http' });
  }

  const books = (data.resources?.results?.products || []).map((p) => {
    const url = KINO_ORIGIN + String(p.url || '').split('?')[0];
    const baht = Number(p.price);
    return {
      title: p.title,
      authors: [],
      year: null,
      publisher: p.vendor || 'Kinokuniya',
      pages: null,
      description: null,
      cover: p.featured_image || p.image || null,
      isbn13: /^\d{13}$/.test(p.handle || '') ? p.handle : null,
      isbn10: null,
      subjects: (p.tags || []).slice(0, 3),
      price: Number.isFinite(baht) ? `฿${baht.toLocaleString('th-TH')}` : null,
      buyLink: url,
      infoLink: url,
      languages: [],
      digital: false,
      sources: ['Kinokuniya'],
      shopLinks: { kino: url },
      freeLinks: [],
    };
  }).filter((b) => b.title);

  return field === 'isbn' ? books : books.filter((b) => matchesQuery(b, term, field));
}

/** SE-ED — the shop's own search API, the same one its website calls. Returns
    covers, prices and an ISBN in the SKU, so these merge with the other
    sources instead of showing up twice. */
const SEED_PRICE_UNIT = 1e6; // the API quotes satang-millionths, 500000000 = ฿500

function seedProduct(entry) {
  const wrapper = entry.physicalProduct || entry.eBookAudio;
  if (!wrapper) return null;
  const item = wrapper.physicalProduct || wrapper.eBookAudio;
  if (!item?.name) return null;

  const kind = entry.physicalProduct ? 'physical' : 'e-book-audio';
  const variant = Object.values(wrapper.extendedOrderProduct || {})[0]?.variants?.[0];
  const amount = variant?.priceAfterDiscount || variant?.price;
  const sku = item.variants?.[0]?.sku || '';
  // The site builds product URLs as name-with-dashes plus the id; encodeURI
  // leaves the ":" and brackets their slugs keep.
  const url = `https://www.se-ed.com/${kind}/${encodeURI(item.name.replace(/ /g, '-'))}-${item.id}`;

  return {
    title: item.name,
    authors: item.author ? [item.author] : [],
    year: (item.publishAt || '').slice(0, 4) || null,
    publisher: 'SE-ED',
    pages: null,
    description: null,
    cover: item.cover || null,
    isbn13: /^\d{13}$/.test(sku) ? sku : null,
    isbn10: /^\d{9}[\dXx]$/.test(sku) ? sku : null,
    subjects: item.category?.name ? item.category.name.split(', ').slice(0, 3) : [],
    price: amount ? `฿${(Number(amount) / SEED_PRICE_UNIT).toLocaleString('th-TH')}` : null,
    buyLink: url,
    infoLink: url,
    languages: ['tha'],
    digital: kind === 'e-book-audio',
    sources: ['SE-ED'],
    shopLinks: { seed: url },
    freeLinks: [],
  };
}

async function searchSeed({ field, term }, signal) {
  const keyword = field === 'isbn' ? term.replace(/[^0-9Xx]/g, '') : term;
  const body = await proxyText(
    'https://mp-api.se-ed.com/web-bff/search-product'
      + `?filter.keyword=${encodeURIComponent(keyword)}&page=1&perPage=20`,
    { format: 'text' },
    signal,
  );

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw Object.assign(new Error('bad payload'), { code: 'http' });
  }
  const books = (data.products || []).map(seedProduct).filter(Boolean);
  // An ISBN search already matched on SKU, so only keyword results need this.
  return field === 'isbn' ? books : books.filter((b) => matchesQuery(b, term, field));
}

/* What each source can actually supply. Picking a รูปแบบ switches off the
   shops that cannot serve it — meb sells only e-books, Kinokuniya only
   printed stock — so the source list never offers a pointless search. */
const SOURCE_MEDIA = {
  meb: ['ebook'],
  seed: ['physical', 'ebook'],
  kino: ['physical'],
  openlibrary: ['physical', 'ebook'],
};

const SOURCES = {
  meb: { name: 'meb', run: searchMeb },
  seed: { name: 'SE-ED', run: searchSeed },
  kino: { name: 'Kinokuniya', run: searchKinokuniya },
  openlibrary: { name: 'Open Library', run: searchOpenLibrary },
};

/* ------------------------------------------------------------ store links */

/* ---------------------------------------------------------------- formats */

/* Format is two things at once: what kind of book it is (นิยาย / การ์ตูน /
   ไลท์โนเวล) and whether it is digital. A light novel can also be an e-book,
   so a book carries a set of tags rather than one label, and the filter
   matches any of them. */
const GENRE_LABELS = {
  fiction: 'นิยาย',
  nonfiction: 'สารคดี',
  lightnovel: 'ไลท์โนเวล',
  manga: 'การ์ตูน',
};
const MEDIA_LABELS = { physical: 'หนังสือเล่ม', ebook: 'อีบุ๊ก' };
const LANG_LABELS = { th: 'ไทย', en: 'อังกฤษ', other: 'อื่นๆ' };

/* Genre is read from each shop's own category text. The order matters: the
   most specific kind wins, so a graphic novel is การ์ตูน and never also
   นิยาย. A book whose categories say nothing useful gets no genre at all
   rather than a guessed one — it simply will not match a genre filter. */
const GENRE_PATTERNS = [
  ['lightnovel', /ไลท์โนเวล|ไลต์โนเวล|light\s*novel/i],
  ['manga', /การ์ตูน|มังงะ|manga|comic|graphic novel|อนิเม|webtoon/i],
  ['nonfiction', /สารคดี|ประวัติศาสตร์|ชีวประวัติ|จิตวิทยา|พัฒนาตนเอง|ธุรกิจ|การเงิน|การลงทุน|สุขภาพ|อาหาร|ท่องเที่ยว|ศาสนา|ปรัชญา|การศึกษา|คอมพิวเตอร์|วิทยาศาสตร์|ภาษา|กฎหมาย|how.?to|non.?fiction|biography|history|business|self.?help|psychology|science|cookbook|travel|reference|textbook/i],
  ['fiction', /นิยาย|วรรณกรรม|เรื่องสั้น|โรแมนซ์|แฟนตาซี|สืบสวน|ทริลเลอร์|สยองขวัญ|novel|fiction|literature|romance|fantasy|mystery|thriller/i],
];

function genreOf(book) {
  const hay = [book.title, book.publisher, ...(book.subjects || [])].join(' ');
  for (const [genre, pattern] of GENRE_PATTERNS) if (pattern.test(hay)) return genre;
  return null;
}

/** Physical, digital, or neither — a catalogue entry describes a work
    rather than an edition you can buy, so it has no รูปแบบ at all. */
function mediaOf(book) {
  if (book.digital === true) return 'ebook';
  if (book.digital === false) return 'physical';
  return null;
}

/** Thai, English, or something else — metadata first, then the title's script. */
function languageOf(book) {
  const codes = (book.languages || []).map((l) => l.toLowerCase());
  if (codes.includes('tha') || codes.includes('th')) return 'th';
  if (THAI_SCRIPT.test(book.title || '')) return 'th';
  if (codes.includes('eng') || codes.includes('en')) return 'en';
  if (codes.length) return 'other';
  // No language metadata: Latin script is almost always English here.
  return /[A-Za-z]/.test(book.title || '') ? 'en' : 'other';
}

const THAI_SCRIPT = /[฀-๿]/;

/** Thai-language, by the source's own metadata or by the title's script. */
/** Any source can supply a free link, and a book saved or imported long ago
    may predate these flags, so all three are derived at render time rather
    than stamped onto search results only. */
function isFree(book) {
  return (book.freeLinks || []).length > 0;
}

function isThai(book) {
  return (book.languages || []).some((l) => l === 'tha' || l === 'th')
    || THAI_SCRIPT.test(book.title || '');
}

/** A Thai-language book whose author is written in Latin script is almost
    always a translation — worth flagging, since those are what Thai readers
    most often hunt for across shops. */
function isTranslated(book) {
  const author = (book.authors || [])[0] || '';
  return isThai(book) && !!author && !THAI_SCRIPT.test(author);
}

/** Thai bookshops and e-book shops. None of them offer an API, so these are
    search URLs — each pattern confirmed against the live site. */
/* A link is in one of three states:
     have    — a source returned this exact book, so we hold its product URL
     check   — meb and SE-ED can be queried, so the dialog finds out on open
     search  — the shop has no API we can reach; the link is an honest guess
   Only a shop we actually checked and that came back empty is greyed out;
   an unverifiable shop is never dimmed, because we do not know. */
function thaiStoreLinks(q, qThai) {
  return [
    { shop: 'seed', label: 'SE-ED ซีเอ็ด', url: `https://www.se-ed.com/search?filter.keyword=${qThai}`, kind: 'ร้านหนังสือ' },
    { shop: 'meb', label: 'meb (อีบุ๊ก)', url: `https://www.mebmarket.com/index.php?action=search_book&type=all&search=${qThai}`, kind: 'e-book' },
    { shop: 'kino', label: 'Kinokuniya ไทย', url: `https://kinokuniya.co.th/search?q=${q}`, kind: 'นำเข้า' },
  ];
}

/** Promote the shops we already know about, and mark the rest checkable. */
function withShopState(links, book) {
  return links.map((l) => {
    if (!l.shop) return l;
    const known = (book.shopLinks || {})[l.shop];
    if (known) return { ...l, url: known, state: 'have', kind: 'มีเล่มนี้' };
    return { ...l, state: 'check', kind: 'กำลังตรวจ…' };
  });
}

/** Where to buy or borrow — built from the book's own title/author/ISBN.
    Thai shops come first for Thai books; for everything else they still
    appear below, since a Thai translation may exist under the same title. */
function storeLinks(book) {
  const titleAuthor = [book.title, (book.authors || [])[0]].filter(Boolean).join(' ');
  const q = encodeURIComponent(titleAuthor);
  // Thai shop search engines do better on the title alone than title + author.
  const qThai = encodeURIComponent(book.title || titleAuthor);
  const isbn = book.isbn13 || book.isbn10;
  const links = [];

  if (isThai(book)) {
    links.push(...withShopState(thaiStoreLinks(q, qThai), book));
  } else {
    // Kinokuniya is the Thai shop that stocks English imports, so for a
    // non-Thai book it belongs at the top rather than not at all.
    links.push(...withShopState([
      { shop: 'kino', label: 'Kinokuniya ไทย', url: `https://kinokuniya.co.th/search?q=${q}`, kind: 'นำเข้า' },
    ], book));
  }
  // None of these can be checked either, so they are flagged like every other
  // unverifiable shop. An ISBN still lands them on the exact edition.
  links.push(
    { manual: true, label: 'Amazon', url: isbn ? `https://www.amazon.com/s?k=${isbn}` : `https://www.amazon.com/s?k=${q}&i=stripbooks`, kind: 'ค้นเอง' },
    { manual: true, label: 'Amazon SG (ส่งไทย)', url: isbn ? `https://www.amazon.sg/s?k=${isbn}` : `https://www.amazon.sg/s?k=${q}&i=stripbooks`, kind: 'ค้นเอง' },
    { manual: true, label: 'Kobo', url: `https://www.kobo.com/search?query=${isbn || q}`, kind: 'ค้นเอง' },
    { manual: true, label: 'Apple Books', url: `https://books.apple.com/th/search?term=${q}`, kind: 'ค้นเอง' },
  );
  if (!isThai(book)) {
    links.push(...withShopState([
      { shop: 'seed', label: 'หาฉบับแปลไทย — SE-ED', url: `https://www.se-ed.com/search?filter.keyword=${qThai}`, kind: 'ฉบับไทย?' },
      { shop: 'meb', label: 'หาฉบับแปลไทย — meb', url: `https://www.mebmarket.com/index.php?action=search_book&type=all&search=${qThai}`, kind: 'ฉบับไทย?' },
    ], book));
  }
  // Shops whose stock cannot be checked at all. They are listed for every
  // book, not just Thai ones, because the manga and light-novel shops matter
  // most for titles that arrive from a non-Thai source.
  links.push(...MANUAL_SHOPS.map((shop) => ({
    manual: true, label: shop.label, url: shop.url(qThai), kind: 'ค้นเอง',
  })));

  if (book.infoLink) links.push({ label: book.sources?.[0] || 'Source page', url: book.infoLink, kind: 'details' });

  return dedupeLinks(links);
}

/* ---------------------------------------------------------------- search */

let currentController = null;
const FAIL_REASON = {
  'rate-limit': 'จำกัดจำนวนคำขอ',
  timeout: 'ตอบช้าเกินไป',
  offline: 'เชื่อมต่อไม่ได้',
  http: 'ตอบกลับผิดพลาด',
};

/** Each source is fetched independently and rendered the moment it lands,
    so one slow or blocked API never holds up the rest. */
async function runSearch(query, sourceKeys) {
  const seq = ++searchSeq;
  currentController?.abort();
  currentController = new AbortController();
  const { signal } = currentController;

  $('#search-intro').hidden = true;
  $('#results').innerHTML = '';
  showManualShops(query.term);

  const merged = new Map();
  const pending = new Set(sourceKeys.map((k) => SOURCES[k].name));
  const failed = [];
  results = [];
  report(pending, failed);

  await Promise.all(sourceKeys.map(async (key) => {
    const { name, run } = SOURCES[key];
    try {
      const books = await run(query, signal);
      if (seq !== searchSeq) return;
      for (const book of books) {
        if (!book.title) continue;
        const id = fingerprint(book);
        merged.set(id, merged.has(id) ? mergeBooks(merged.get(id), book) : { ...book, id });
      }
      results = groupEditions([...merged.values()]);
    } catch (err) {
      if (seq !== searchSeq || err.name === 'AbortError') return;
      failed.push(`${name} ${FAIL_REASON[err.code] || 'ใช้งานไม่ได้'}`);
    }
    if (seq !== searchSeq) return;
    pending.delete(name);
    renderResults();
    report(pending, failed);
  }));
}

function report(pending, failed) {
  const parts = [];
  if (results.length) {
    const free = results.filter(isFree).length;
    const thai = results.filter(isThai).length;
    parts.push(`${results.length} เล่ม`);
    if (thai) parts.push(`${thai} ภาษาไทย`);
    if (free) parts.push(`อ่าน/โหลดฟรี ${free} เล่ม`);
  }
  if (pending.size) parts.push(`<span class="spinner"></span>กำลังค้นหา ${[...pending].join(', ')}…`);
  else if (!results.length && !failed.length) parts.push('ไม่พบหนังสือที่ตรงกัน ลองใช้คำน้อยลงหรือสะกดแบบอื่น');
  if (failed.length) parts.push(failed.join(' · '));
  setStatus(parts.join(' · '), !pending.size && !results.length && failed.length > 0);
}

/* Shops that cannot be searched automatically. Naiin's robots.txt disallows
   /search-result and /autocomplete outright, and its Cloudflare rules enforce
   that with a 403, so the honest thing is to hand over a link rather than
   pretend the shop has nothing. */
const MANUAL_SHOPS = [
  { label: 'นายอินทร์', url: (q) => `https://www.naiin.com/search?keyword=${q}` },
  { label: 'BookWalker', url: (q) => `https://global.bookwalker.jp/search/?word=${q}` },
  { label: 'Hytexts', url: (q) => `https://www.hytexts.com/search?q=${q}` },
  { label: 'Fictionlog', url: (q) => `https://fictionlog.co/search?q=${q}` },
  { label: 'Yaakz', url: (q) => `https://www.yaakz.com/search?keyword=${q}` },
  // These two have no search that can be reached by URL, so the link lands on
  // the site and the reader takes it from there.
  { label: 'ReadAWrite', url: () => 'https://www.readawrite.com/' },
  { label: 'PhoenixNext', url: () => 'https://phoenix-next.com/' },
  { label: 'B2S', url: (q) => `https://www.b2s.co.th/search?q=${q}` },
  { label: 'ศูนย์หนังสือจุฬาฯ', url: (q) => `https://www.chulabook.com/categories?text=${q}` },
];

function showManualShops(term) {
  const box = $('#manual-shops');
  if (!term) { box.hidden = true; return; }
  const q = encodeURIComponent(term);
  box.hidden = false;
  box.innerHTML = '<span class="manual-label">ร้านที่ตรวจให้ไม่ได้ — ต้องค้นเอง</span>'
    + MANUAL_SHOPS.map((shop) =>
      `<a class="manual-link" href="${esc(shop.url(q))}" target="_blank" rel="noopener noreferrer">${shop.label}</a>`
    ).join('');
}

function setStatus(html, isError = false) {
  const el = $('#search-status');
  el.innerHTML = html;
  el.classList.toggle('error', isError);
}

/* ---------------------------------------------------------------- library */

function inLibrary(id) {
  return library.some((b) => b.id === id);
}

function saveBook(book, status = 'buy') {
  if (inLibrary(book.id)) {
    toast('มีอยู่ในกองดองแล้ว');
    return;
  }
  library.unshift({ ...book, status, note: '', savedAt: Date.now() });
  save();
  renderAll();
  toast(`เก็บเข้า “${STATUSES[status]}” แล้ว`);
}

function removeBook(id) {
  library = library.filter((b) => b.id !== id);
  save();
  renderAll();
  toast('เอาออกจากกองดองแล้ว');
}

function updateBook(id, patch) {
  const book = library.find((b) => b.id === id);
  if (!book) return;
  Object.assign(book, patch);
  save();
  renderAll();
}

function findBook(id) {
  return library.find((b) => b.id === id)
    || results.find((b) => b.id === id)
    || relatedBooks.get(id);
}

/* ----------------------------------------------------------------- render */

function coverHTML(book, cls = 'cover') {
  if (book.cover) {
    return `<img class="${cls}" src="${esc(book.cover)}" alt="" loading="lazy"
              onerror="this.outerHTML='<div class=&quot;${cls} placeholder&quot;>📕</div>'">`;
  }
  return `<div class="${cls} placeholder">📕</div>`;
}

/** The labels shown on a card: genre first, then physical/e-book. */
function bookTags(book) {
  const genre = genreOf(book);
  const media = mediaOf(book);
  return [
    genre ? GENRE_LABELS[genre] : null,
    media ? MEDIA_LABELS[media] : 'ซีรีส์',
    book.volumeCount ? `${book.volumeCount} เล่ม` : null,
  ].filter(Boolean);
}

function metaLine(book) {
  return [
    book.price,
    book.year,
    book.pages ? `${book.pages} pages` : null,
    book.publisher,
  ].filter(Boolean).join(' · ');
}

function cardHTML(book, mode) {
  const saved = inLibrary(book.id);
  const badges = [
    ...bookTags(book).map((t) => `<span class="badge format">${t}</span>`),
    book.editions > 1 ? `<span class="badge">${book.editions} ฉบับ</span>` : '',
    isTranslated(book) ? '<span class="badge thai">แปลไทย</span>'
      : isThai(book) ? '<span class="badge thai">ไทย</span>' : '',
    isFree(book) ? '<span class="badge free">ฟรี</span>' : '',
    mode === 'library' ? `<span class="badge status">${esc(STATUSES[book.status] || book.status)}</span>` : '',
    ...(mode === 'library' ? (book.collections || []) : [])
      .map((c) => `<span class="badge collection">${esc(c)}</span>`),
    ...(book.sources || []).map((s) => `<span class="badge">${esc(s)}</span>`),
  ].join('');

  const actions = mode === 'library'
    ? `<select data-act="status" data-id="${esc(book.id)}" aria-label="Status">
         ${Object.entries(STATUSES).map(([k, v]) =>
           `<option value="${k}"${book.status === k ? ' selected' : ''}>${v}</option>`).join('')}
       </select>
       <span class="spacer"></span>
       <button class="btn small" data-act="open" data-id="${esc(book.id)}">ลิงก์</button>
       <button class="btn small ghost" data-act="remove" data-id="${esc(book.id)}">เอาออก</button>`
    : `<button class="btn small primary" data-act="save" data-id="${esc(book.id)}" ${saved ? 'disabled' : ''}>
         ${saved ? 'อยู่ในกองแล้ว' : (isFree(book) ? 'เก็บไว้โหลด' : 'เก็บไว้ซื้อ')}
       </button>
       <span class="spacer"></span>
       <button class="btn small" data-act="open" data-id="${esc(book.id)}">หาซื้อที่ไหน</button>`;

  return `<article class="card">
    <button class="card-main" data-act="open" data-id="${esc(book.id)}">
      ${coverHTML(book)}
      <div class="card-text">
        <h3 class="card-title">${esc(book.title)}</h3>
        <p class="card-author">${esc((book.authors || []).join(', ') || 'ไม่ทราบผู้แต่ง')}</p>
        ${metaLine(book) ? `<p class="card-meta">${esc(metaLine(book))}</p>` : ''}
        ${book.note ? `<p class="card-meta">📝 ${esc(book.note)}</p>` : ''}
        <div class="badges">${badges}</div>
      </div>
    </button>
    <div class="card-actions">${actions}</div>
  </article>`;
}

const chosenGenres = () => $$('input[name="genre"]:checked').map((i) => i.value);
const chosenMedia = () => $('input[name="media"]:checked')?.value || 'any';

/* ---------------------------------------------------------- arranging */

/** Prices arrive as display strings like "฿1,449" — pull the number out. */
function priceValue(book) {
  const digits = String(book.price || '').replace(/[^\d.]/g, '');
  const amount = Number(digits);
  return digits && Number.isFinite(amount) ? amount : null;
}

/* Books with nothing to sort on sink rather than bunching at the top: an
   unpriced catalogue entry should not lead a cheapest-first list. */
function byMissingLast(get, direction = 1) {
  return (a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * direction;
  };
}

const RESULT_SORTS = {
  relevance: null, // the order the sources returned
  'price-asc': byMissingLast(priceValue, 1),
  'price-desc': byMissingLast(priceValue, -1),
  title: (a, b) => a.title.localeCompare(b.title, 'th'),
  'year-desc': byMissingLast((b) => (b.year ? Number(b.year) : null), -1),
  free: (a, b) => Number(isFree(b)) - Number(isFree(a)),
  source: (a, b) => (a.sources?.[0] || '').localeCompare(b.sources?.[0] || '')
    || a.title.localeCompare(b.title, 'th'),
};

function arrangeResults(list) {
  const compare = RESULT_SORTS[$('#results-sort').value];
  // Sorting a copy keeps "ตรงที่สุด" able to restore the original order.
  return compare ? [...list].sort(compare) : list;
}

function renderResults() {
  const genres = chosenGenres();
  const media = chosenMedia();
  const lang = searchLang();

  const list = results.filter((b) => {
    if ($('#free-only').checked && !isFree(b)) return false;
    if (media !== 'any' && mediaOf(b) !== media) return false;
    // No genre ticked means no opinion, so everything stays.
    if (genres.length && !genres.includes(genreOf(b))) return false;
    if (lang !== 'any' && languageOf(b) !== lang) return false;
    return true;
  });

  const hidden = results.length - list.length;
  $('#filtered-note').hidden = hidden <= 0;
  if (hidden > 0) $('#filtered-note').textContent = `ซ่อนไว้ ${hidden} เล่มจากตัวกรอง`;

  $('#results-bar').hidden = results.length === 0;
  $('#results').innerHTML = arrangeResults(list).map((b) => cardHTML(b, 'search')).join('');
}

/* Keep the source row honest about the chosen รูปแบบ. Only sources this
   function switched off are switched back on, so neither the page's own
   defaults nor a shop the reader unticked get overridden. */
function updateSourceCount() {
  const boxes = $$('input[name="source"]');
  const on = boxes.filter((b) => b.checked).length;
  $('#source-count').textContent = `${on}/${boxes.length}`;
}

function syncSourcesToMedia() {
  const media = chosenMedia();
  $$('input[name="source"]').forEach((box) => {
    const fits = media === 'any' || (SOURCE_MEDIA[box.value] || []).includes(media);
    const chip = box.closest('.chip');
    box.disabled = !fits;
    chip.classList.toggle('chip-off', !fits);
    chip.title = fits ? '' : `แหล่งนี้ไม่มี${MEDIA_LABELS[media]}`;
    if (!fits) {
      if (box.checked) { chip.dataset.autoOff = '1'; box.checked = false; }
    } else if (chip.dataset.autoOff) {
      box.checked = true;
      delete chip.dataset.autoOff;
    }
  });
  updateSourceCount();
}


function renderLibrary() {
  const term = slug($('#library-filter').value);
  const sort = $('#library-sort').value;

  let list = library.filter((b) => (activeStatus === 'all' || b.status === activeStatus)
    && (activeCollection === null || (b.collections || []).includes(activeCollection)));
  if (term) {
    list = list.filter((b) => {
      const formats = bookTags(b).join(' ');
      return slug(`${b.title} ${(b.authors || []).join(' ')} ${b.note || ''} ${formats}`).includes(term);
    });
  }
  if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'author') {
    list = [...list].sort((a, b) =>
      ((a.authors || [])[0] || '').localeCompare((b.authors || [])[0] || ''));
  }

  const counts = { all: library.length, buy: 0, download: 0, have: 0 };
  for (const b of library) if (b.status in counts) counts[b.status]++;
  $$('#status-filters .filter').forEach((btn) => {
    btn.querySelector('span').textContent = counts[btn.dataset.status] || '';
  });
  $('#lib-count').textContent = library.length;

  const empty = $('#library-empty');
  if (!list.length) {
    empty.hidden = false;
    empty.innerHTML = library.length
      ? '<strong>ไม่มีเล่มที่ตรง</strong>ไม่มีหนังสือที่เก็บไว้ตรงกับตัวกรองนี้'
      : '<strong>กองดองยังว่าง</strong>ค้นหาหนังสือแล้วเก็บไว้ซื้อหรือโหลดทีหลัง';
  } else {
    empty.hidden = true;
  }
  renderCollections();
  $('#library').innerHTML = list.map((b) => cardHTML(b, 'library')).join('');
}

function renderAll() {
  renderResults();
  renderLibrary();
}

/* ------------------------------------------------------- collections */

/* A book's status says where it is in the buying process; a collection says
   which shelf it belongs on. They are separate axes, and a book can sit on
   several shelves at once. The names are persisted separately from the books,
   so a collection you have emptied does not quietly disappear. */
let activeCollection = null;

function allCollections() {
  const used = library.flatMap((b) => b.collections || []);
  return [...new Set([...(prefs.collections || []), ...used])]
    .sort((a, b) => a.localeCompare(b, 'th'));
}

function createCollection(name) {
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) return null;
  if (!prefs.collections.includes(clean)) {
    prefs.collections = [...prefs.collections, clean];
    applyPrefs();
  }
  return clean;
}

function toggleCollection(bookId, name) {
  const book = library.find((b) => b.id === bookId);
  if (!book) return;
  const current = book.collections || [];
  book.collections = current.includes(name)
    ? current.filter((c) => c !== name)
    : [...current, name];
  save();
  renderAll();
}

function deleteCollection(name) {
  prefs.collections = (prefs.collections || []).filter((c) => c !== name);
  applyPrefs();
  library.forEach((b) => {
    if (b.collections?.includes(name)) b.collections = b.collections.filter((c) => c !== name);
  });
  save();
  if (activeCollection === name) activeCollection = null;
  renderAll();
  toast(`ลบคอลเลกชัน “${name}” แล้ว`);
}

function renderCollections() {
  const names = allCollections();
  const counts = Object.fromEntries(names.map((n) =>
    [n, library.filter((b) => (b.collections || []).includes(n)).length]));

  $('#collections-row').innerHTML = `
    <button class="filter${activeCollection === null ? ' active' : ''}" data-collection="">ทุกคอลเลกชัน</button>
    ${names.map((n) => `<button class="filter${activeCollection === n ? ' active' : ''}"
         data-collection="${esc(n)}">${esc(n)} <span>${counts[n]}</span></button>`).join('')}
    <button class="filter add-collection" data-collection-new>+ สร้างคอลเลกชัน</button>
    ${activeCollection ? `<button class="btn small ghost" data-collection-delete="${esc(activeCollection)}">ลบคอลเลกชันนี้</button>` : ''}`;
}

/* ----------------------------------------------------------------- dialog */

function openDialog(id) {
  const book = findBook(id);
  if (!book) return;
  const saved = inLibrary(book.id);
  const free = book.freeLinks || [];
  const stores = storeLinks(book);
  // Shops we can report on are worth more space than the ones we cannot.
  const checkable = stores.filter((l) => !l.manual);
  const manual = stores.filter((l) => l.manual);

  const linkRow = (l) => `<a class="link-row${/free/i.test(l.kind) ? ' is-free' : ''}${
         l.state ? ` state-${l.state}` : ''}${l.manual ? ' state-manual' : ''}"${
         l.manual ? ' title="ตรวจสต็อกอัตโนมัติไม่ได้ กดเพื่อไปค้นหาเองในเว็บของร้าน"' : ''}${
         l.shop ? ` data-shop="${l.shop}"` : ''}
       href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
       ${l.state === 'check' ? '<span class="spinner"></span>' : ''}
       <span>${esc(l.label)}</span><span class="kind">${esc(l.kind)}</span></a>`;

  $('#dialog-body').innerHTML = `
    <button class="btn small ghost dialog-close" data-act="close">ปิด</button>
    <div class="dialog-head">
      ${coverHTML(book)}
      <div>
        <h2>${esc(book.title)}</h2>
        <p class="card-author">${esc((book.authors || []).join(', ') || 'ไม่ทราบผู้แต่ง')}</p>
        ${metaLine(book) ? `<p class="card-meta">${esc(metaLine(book))}</p>` : ''}
        ${book.isbn13 || book.isbn10 ? `<p class="card-meta">ISBN ${esc(book.isbn13 || book.isbn10)}</p>` : ''}
        <div class="badges">
          ${bookTags(book).map((t) => `<span class="badge format">${t}</span>`).join('')}
          ${isTranslated(book) ? '<span class="badge thai">แปลไทย</span>'
            : isThai(book) ? '<span class="badge thai">ภาษาไทย</span>' : ''}
          ${free.length ? '<span class="badge free">มีให้ฟรี</span>' : ''}
          ${(book.sources || []).map((s) => `<span class="badge">${esc(s)}</span>`).join('')}
        </div>
      </div>
    </div>
    ${book.description ? `<p class="desc">${esc(book.description).slice(0, 1400)}</p>` : ''}
    ${free.length ? `<p class="links-title">อ่านหรือโหลดฟรี</p>
      <div class="links">${free.map(linkRow).join('')}</div>` : ''}
    <div class="series-slot"></div>
    ${checkable.length ? `<p class="links-title">ซื้อหรือยืม</p>
      <div class="links">${checkable.map(linkRow).join('')}</div>` : ''}
    ${manual.length ? `<p class="links-title">ตรวจสต็อกให้ไม่ได้ — ค้นเอง
        <span class="muted-count">${manual.length}</span></p>
      <div class="links">${manual.map(linkRow).join('')}</div>` : ''}
    ${saved ? `
      <p class="links-title">คอลเลกชัน</p>
      <div class="collection-picker">
        ${allCollections().map((c) => `
          <button class="chip ghost-chip${(book.collections || []).includes(c) ? ' on' : ''}"
                  data-act="toggle-collection" data-id="${esc(book.id)}" data-name="${esc(c)}"
                  type="button">${esc(c)}</button>`).join('')}
        <button class="chip ghost-chip" data-act="new-collection" data-id="${esc(book.id)}" type="button">+ ใหม่</button>
      </div>
      <p class="links-title">โน้ตของฉัน</p>
      <textarea class="note-field" data-act="note" data-id="${esc(book.id)}"
        placeholder="ฉบับไหน ราคาที่เห็น ใครแนะนำ…">${esc(book.note || '')}</textarea>` : ''}
    <div class="dialog-actions">
      ${saved
        ? `<select data-act="status" data-id="${esc(book.id)}" aria-label="Status">
             ${Object.entries(STATUSES).map(([k, v]) =>
               `<option value="${k}"${book.status === k ? ' selected' : ''}>${v}</option>`).join('')}
           </select>
           <button class="btn" data-act="remove" data-id="${esc(book.id)}">เอาออกจากกองดอง</button>`
        : `<button class="btn primary" data-act="save" data-id="${esc(book.id)}">เก็บไว้ทีหลัง</button>`}
    </div>`;

  $('#book-dialog').showModal();
  verifyShops(book, ++dialogToken);
}

/* Lookups are slow enough that a second book can be opened before the first
   one's results arrive. Each dialog takes a token, and late results for a
   dialog that is no longer on screen are dropped. */
let dialogToken = 0;

/* ------------------------------------------------- live shop availability */

/* meb and SE-ED are the two shops we can actually query, so when a dialog
   opens we ask them whether they carry this book and update those rows in
   place: a direct product link if they do, greyed out if they do not. */
const shopChecks = new Map(); // book id -> { seed: url|null, meb: url|null }
const CHECKABLE = {
  seed: { run: searchSeed, source: 'SE-ED' },
  meb: { run: searchMeb, source: 'meb' },
  kino: { run: searchKinokuniya, source: 'Kinokuniya' },
};

/* One search per shop answers both questions a dialog asks: does this shop
   carry the book, and what else is in the series. Searching the series base
   rather than the exact title returns the sibling volumes too. */
async function verifyShops(book, token) {
  const base = seriesBase(book.title) || book.title;
  const rows = [...document.querySelectorAll('#dialog-body .link-row.state-check')];
  const cached = shopChecks.get(book.id) || (shopChecks.set(book.id, {}), shopChecks.get(book.id));
  const signal = new AbortController().signal;

  const found = await Promise.all(Object.keys(CHECKABLE).map(async (key) => {
    if (cached[key] === undefined) {
      try {
        cached[key] = await CHECKABLE[key].run({ field: 'all', term: base }, signal);
      } catch {
        cached[key] = null; // the check failed, which is not "not stocked"
      }
    }
    return [key, cached[key]];
  }));

  if (token !== dialogToken) return;

  for (const row of rows) {
    if (!row.isConnected) continue;
    const hits = cached[row.dataset.shop];
    const url = hits?.find((h) => sameBook(h.title, book.title))?.shopLinks?.[row.dataset.shop];
    row.querySelector('.spinner')?.remove();
    row.classList.remove('state-check');
    if (url) {
      row.href = url;
      row.classList.add('state-have');
      row.querySelector('.kind').textContent = 'มีเล่มนี้';
    } else if (hits) {
      row.classList.add('state-none');
      row.querySelector('.kind').textContent = 'ไม่พบ';
    } else {
      row.querySelector('.kind').textContent = 'ตรวจไม่ได้';
    }
  }

  renderSeries(book, found.flatMap(([, hits]) => hits || []), token);
}

/* --------------------------------------------------------- same series */

// Books shown only as series suggestions are not in `results`, so keep them
// reachable for when one is clicked.
const relatedBooks = new Map();

function renderSeries(book, candidates, token) {
  if (token !== dialogToken) return;
  const slot = document.querySelector('#dialog-body .series-slot');
  if (!slot || !slot.isConnected) return;

  const base = slug(seriesBase(book.title));
  const seen = new Set();
  const siblings = candidates
    .filter((b) => base && slug(seriesBase(b.title)) === base && !sameBook(b.title, book.title))
    .filter((b) => {
      const key = slug(b.title);
      return seen.has(key) ? false : seen.add(key);
    })
    .map((b) => ({ ...b, id: b.id || fingerprint(b) }))
    .sort((a, b2) => (volumeOf(a.title) ?? 1e6) - (volumeOf(b2.title) ?? 1e6))
    .slice(0, 12);

  if (!siblings.length) { slot.innerHTML = ''; return; }
  siblings.forEach((b) => relatedBooks.set(b.id, b));

  slot.innerHTML = `
    <p class="links-title">เล่มอื่นในชุดนี้ <span class="muted-count">${siblings.length}</span></p>
    <div class="series-strip">
      ${siblings.map((b) => `
        <button class="series-item" data-act="open" data-id="${esc(b.id)}" title="${esc(b.title)}">
          ${coverHTML(b, 'series-cover')}
          <span class="series-vol">${volumeOf(b.title) ? `เล่ม ${volumeOf(b.title)}` : esc(b.title.slice(0, 18))}</span>
          ${b.price ? `<span class="series-price">${esc(b.price)}</span>` : ''}
        </button>`).join('')}
    </div>`;
}


/* ------------------------------------------------------------ import/export */

function exportLibrary() {
  if (!library.length) return toast('ยังไม่มีอะไรให้ส่งออก');
  const blob = new Blob([JSON.stringify({ app: 'bookpile', version: 1, collections: prefs.collections, books: library }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `book-pile-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`ส่งออก ${library.length} เล่มแล้ว`);
}

async function importLibrary(file) {
  try {
    const data = JSON.parse(await file.text());
    const books = Array.isArray(data) ? data : data.books;
    if (!Array.isArray(books)) throw new Error('bad shape');
    // Carry over collection names too, so an emptied shelf survives the trip.
    for (const name of data.collections || []) createCollection(name);
    let added = 0;
    for (const b of books) {
      if (!b?.title) continue;
      const id = b.id || fingerprint(b);
      if (inLibrary(id)) continue;
      library.push({ status: 'buy', note: '', savedAt: Date.now(), ...b, id });
      added++;
    }
    save();
    renderAll();
    toast(added ? `นำเข้า ${added} เล่มแล้ว` : 'ไม่มีเล่มใหม่ให้นำเข้า');
  } catch {
    toast('ไฟล์นี้ไม่ใช่ไฟล์ส่งออกของกองดอง');
  }
}

/* ------------------------------------------------------------------ events */

/* ------------------------------------------------- appearance controls */

function buildSwatches() {
  $('#accent-swatches').innerHTML = ACCENTS.map((a) => `
    <button class="swatch" style="--h:${a.h}" data-h="${a.h}" type="button"
            title="${esc(a.name)}" aria-label="${esc(a.name)}"
            aria-pressed="${a.h === prefs.accent}"></button>`).join('');
}

function setAccent(h) {
  prefs.accent = h;
  applyPrefs();
  $$('#accent-swatches .swatch').forEach((s) => {
    s.setAttribute('aria-pressed', Number(s.dataset.h) === h);
  });
}

function toggleAccentMenu(open) {
  const menu = $('#accent-menu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('#accent-btn').setAttribute('aria-expanded', String(show));
}

$('#theme-btn').addEventListener('click', () => {
  // Start from whatever is on screen now, so the first click always flips it.
  const dark = prefs.theme === 'dark'
    || (prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  prefs.theme = dark ? 'light' : 'dark';
  applyPrefs();
});

$('#accent-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAccentMenu();
});

$('#accent-swatches').addEventListener('click', (e) => {
  const swatch = e.target.closest('.swatch');
  if (swatch) setAccent(Number(swatch.dataset.h));
});

document.addEventListener('click', (e) => {
  if (!$('#accent-menu').hidden && !e.target.closest('.accent-wrap')) toggleAccentMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#accent-menu').hidden) toggleAccentMenu(false);
});

buildSwatches();
syncSourcesToMedia();

/* ------------------------------------------------------------ the guide */

/* Shown once on a first visit. Dismissing without ticking the box leaves it
   to appear next time, and the ? button reopens it either way — so nobody
   can lose the explanation permanently by clicking the wrong thing. */
function openGuide() {
  $('#guide-hide').checked = !!prefs.seenGuide;
  $('#guide-dialog').showModal();
}

function closeGuide() {
  prefs.seenGuide = $('#guide-hide').checked;
  applyPrefs();
  $('#guide-dialog').close();
}

$('#help-btn').addEventListener('click', openGuide);
$('#guide-dialog').addEventListener('click', (e) => {
  if (e.target.id === 'guide-dialog' || e.target.closest('[data-guide-close]')) closeGuide();
});
// Escape closes the dialog natively; keep the checkbox honoured either way.
$('#guide-dialog').addEventListener('close', () => {
  prefs.seenGuide = $('#guide-hide').checked;
  applyPrefs();
});

if (!prefs.seenGuide) openGuide();


function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo({ top: 0 });
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const term = $('#search-input').value.trim();
  const sources = $$('input[name="source"]:checked').map((i) => i.value);
  if (!term) return;
  if (!sources.length) return setStatus('เลือกแหล่งค้นหาอย่างน้อยหนึ่งแหล่ง', true);
  runSearch({ term, field: $('#search-field').value, lang: searchLang() }, sources);
});

const searchLang = () => $('input[name="lang"]:checked')?.value || 'any';

$$('input[name="lang"]').forEach((radio) => radio.addEventListener('change', () => {
  // วิกิซอร์ซ only holds Thai texts, so it follows the language scope.
  const wiki = $('input[name="source"][value="wikisource"]');
  if (!wiki.disabled) wiki.checked = searchLang() === 'th';
  if ($('#search-input').value.trim()) $('#search-form').requestSubmit();
  else renderResults();
}));

$('#free-only').addEventListener('change', renderResults);
$('#results-sort').addEventListener('change', renderResults);
$$('input[name="source"]').forEach((box) => box.addEventListener('change', updateSourceCount));
$$('input[name="genre"]').forEach((box) => box.addEventListener('change', renderResults));
$$('input[name="media"]').forEach((radio) => radio.addEventListener('change', () => {
  syncSourcesToMedia();
  renderResults();
}));

$('#library-filter').addEventListener('input', renderLibrary);
$('#library-sort').addEventListener('change', renderLibrary);
$('#export-btn').addEventListener('click', exportLibrary);
$('#import-input').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) importLibrary(file);
  e.target.value = '';
});

$('#collections-row').addEventListener('click', (e) => {
  const del = e.target.closest('[data-collection-delete]');
  if (del) {
    const name = del.dataset.collectionDelete;
    const count = library.filter((b) => (b.collections || []).includes(name)).length;
    // Deleting a shelf must not delete the books standing on it.
    if (confirm(`ลบคอลเลกชัน “${name}”?
หนังสือ ${count} เล่มจะยังอยู่ในกองดอง เพียงแต่ไม่อยู่ในคอลเลกชันนี้`)) {
      deleteCollection(name);
    }
    return;
  }
  if (e.target.closest('[data-collection-new]')) {
    const name = createCollection(prompt('ชื่อคอลเลกชันใหม่'));
    if (name) { activeCollection = name; renderAll(); }
    return;
  }
  const btn = e.target.closest('[data-collection]');
  if (!btn) return;
  activeCollection = btn.dataset.collection || null;
  renderLibrary();
});

$('#status-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter');
  if (!btn) return;
  activeStatus = btn.dataset.status;
  $$('#status-filters .filter').forEach((b) => b.classList.toggle('active', b === btn));
  renderLibrary();
});

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-view]');
  if (tab) {
    e.preventDefault();
    showView(tab.dataset.view);
    return;
  }

  const suggest = e.target.closest('[data-suggest]');
  if (suggest) {
    $('#search-input').value = suggest.dataset.suggest;
    $('#search-form').requestSubmit();
    return;
  }

  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const { act, id } = el.dataset;

  if (act === 'toggle-collection') {
    toggleCollection(id, el.dataset.name);
    openDialog(id);
    return;
  }
  if (act === 'new-collection') {
    const name = createCollection(prompt('ชื่อคอลเลกชันใหม่'));
    if (name) { toggleCollection(id, name); openDialog(id); }
    return;
  }
  if (act === 'close') $('#book-dialog').close();
  if (act === 'open') openDialog(id);
  if (act === 'save') {
    const book = findBook(id);
    if (book) saveBook(book, isFree(book) ? 'download' : 'buy');
    if ($('#book-dialog').open) openDialog(id);
  }
  if (act === 'remove') {
    removeBook(id);
    if ($('#book-dialog').open) $('#book-dialog').close();
  }
});

document.addEventListener('change', (e) => {
  const el = e.target.closest('select[data-act="status"]');
  if (!el) return;
  updateBook(el.dataset.id, { status: el.value });
  toast(`ย้ายไป “${STATUSES[el.value]}” แล้ว`);
});

document.addEventListener('input', (e) => {
  const el = e.target.closest('textarea[data-act="note"]');
  if (!el) return;
  clearTimeout(el._t);
  el._t = setTimeout(() => updateBook(el.dataset.id, { note: el.value.trim() }), 400);
});

$('#book-dialog').addEventListener('click', (e) => {
  if (e.target.id === 'book-dialog') e.target.close();
});

renderAll();
