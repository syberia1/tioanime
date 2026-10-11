// TioAnime para Kino (apiVersion 6): catálogo de tioanime.com, video por Voe y YourUpload.
// Un solo módulo, sin dependencias. Corre en QuickJS: sin URL, atob, TextDecoder ni timers.

// ---------- 1. Constantes y textos ----------

const BASE = "https://tioanime.com";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const ID_OK = /^[A-Za-z0-9._~-]{1,128}$/;

const TXT = {
  notFound: { es: "No encontramos esto en el sitio.", en: "We could not find this on the site." },
  siteDown: { es: "El sitio no responde ahora. Intenta más tarde.", en: "The site is not answering now. Try again later." },
  noServers: {
    es: "Este capítulo no tiene Voe ni YourUpload disponibles.",
    en: "This episode has no Voe or YourUpload available.",
  },
  serverFailed: {
    es: "No se pudo abrir el video en ese servidor. Prueba otro en el menú Servidor.",
    en: "The video could not be opened on that server. Try another one in the Servidor menu.",
  },
  badRef: { es: "Este título ya no es válido. Búscalo otra vez.", en: "This title is no longer valid. Search for it again." },
  episode: { es: "Capítulo ", en: "Episode " },
};

function lang() {
  return String(kino.lang || "es").toLowerCase().indexOf("en") === 0 ? "en" : "es";
}
function t(key) {
  return TXT[key][lang()];
}
function fail(code, detail, key) {
  return kino.error(code, detail, { userMessage: t(key) });
}

// Mensaje con datos concretos (servidores y motivo) para que la persona vea qué pasó sin abrir el registro.
function failWith(code, detail, text) {
  const clean = String(text).replace(/[^\p{L}\p{N} .,:;()!?'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return kino.error(code, detail, { userMessage: clean });
}

function reasonOf(e) {
  const m = String((e && e.message) || "");
  if (/borrad|deleted|not found|removed|HTTP 404/i.test(m)) return lang() === "en" ? "video removed" : "video borrado";
  const h = /HTTP (\d{3})/.exec(m);
  if (h) return "HTTP " + h[1];
  if (/tiempo agotado|timeout|took too long/i.test(m)) return lang() === "en" ? "timed out" : "tardó demasiado";
  if (/sin video/i.test(m)) return lang() === "en" ? "no video found" : "sin video";
  if (/red /.test(m)) return lang() === "en" ? "no connection" : "sin conexión";
  return lang() === "en" ? "failed" : "falló";
}

// ---------- 2. Utilidades de texto ----------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 (normal o url-safe) a bytes; ignora "=", espacios y cualquier carácter ajeno.
function b64bytes(s) {
  const out = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (c === "-") c = "+";
    else if (c === "_") c = "/";
    const v = B64.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
      buf &= (1 << bits) - 1;
    }
  }
  return out;
}

function utf8(bytes) {
  let s = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      s += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    } else if (b >= 0xe0 && b < 0xf0) {
      const b2 = bytes[i++] & 63;
      const b3 = bytes[i++] & 63;
      s += String.fromCharCode(((b & 15) << 12) | (b2 << 6) | b3);
    } else if (b >= 0xf0) {
      const b2 = bytes[i++] & 63;
      const b3 = bytes[i++] & 63;
      const b4 = bytes[i++] & 63;
      const cp = (((b & 7) << 18) | (b2 << 12) | (b3 << 6) | b4) - 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return s;
}

function b64text(s) {
  return utf8(b64bytes(s));
}

function rot13(s) {
  return s.replace(/[A-Za-z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function unslash(s) {
  return String(s).replace(/\\\//g, "/").replace(/\\u0026/g, "&");
}

function cleanQuery(q) {
  return String(q || "")
    .replace(/[^\p{L}\p{N}\s'.:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function abs(u, from) {
  if (!u) return "";
  u = String(u).trim();
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u[0] === "/") {
    const m = /^(https?:\/\/[^/]+)/i.exec(from || BASE);
    return (m ? m[1] : BASE) + u;
  }
  return BASE + "/" + u;
}

function originOf(u) {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(String(u));
  return m ? m[1] : "";
}

// ---------- 3. HTTP ----------

// Siempre hace el await antes de poder lanzar (regla de la trampa de rechazos).
async function getPage(url, headers, timeoutMs) {
  const opts = {
    headers: Object.assign(
      { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9", Accept: "text/html,application/xhtml+xml,*/*" },
      headers || {}
    ),
    timeoutMs: timeoutMs || 12000,
  };
  let r = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      r = await kino.fetch(url, opts);
    } catch (e) {
      // Falla de red: un solo reintento. Si el sitio ya agotó el tiempo no se insiste (no alcanzaría el tiempo).
      if (attempt === 1 || (e && e.code === "timeout")) throw fail("unavailable", (e && e.code === "timeout" ? "tiempo agotado " : "red ") + (e && e.message), "siteDown");
      await kino.sleep(600);
      continue;
    }
    // El sitio a veces responde 429 o 5xx a ráfagas de peticiones: se espera un poco y se reintenta una vez.
    if ((r.status === 429 || r.status >= 500) && attempt === 0) {
      await kino.sleep(900);
      continue;
    }
    break;
  }
  if (r.status === 404) throw fail("not_found", "HTTP 404 " + url, "notFound");
  if (!r.ok) throw fail("unavailable", "HTTP " + r.status + " " + url, "siteDown");
  return { html: r.text(), url: r.url || url };
}

// ---------- 4. Lectura de TioAnime ----------

function mkItem(slug, title, poster, movie) {
  if (!slug || !ID_OK.test(slug) || !title) return null;
  const item = {
    id: slug,
    // Una película se reproduce de una vez: su ref va directo a resolve (capítulo 1 del sitio).
    ref: movie ? "e:" + slug + ":1" : "a:" + slug,
    title: String(title).slice(0, 200),
    kind: movie ? "movie" : "series",
  };
  if (poster) item.poster = poster;
  return item;
}

// Tarjetas (<article>) de un listado. Sirven las de anime (/anime/slug) y las de capítulo (/ver/slug-N).
// opts.movies: todo lo que salga es película. opts.onlyEpisodes: solo tarjetas de capítulo.
function cardsFrom(html, opts) {
  opts = opts || {};
  let boxes = kino.html.select(html, "article").map((a) => a.html);
  if (!boxes.length) boxes = kino.html.select(html, "li").map((a) => a.html);
  const items = [];
  const seen = {};
  for (const box of boxes) {
    const link = kino.html.select(box, "a[href]")[0];
    if (!link) continue;
    const href = link.attrs.href || "";
    let slug = "";
    let isEpisode = false;
    let m = /\/anime\/([^/?#]+)/.exec(href);
    if (m) {
      slug = m[1];
    } else {
      m = /\/ver\/([^/?#]+)/.exec(href);
      if (!m) continue;
      isEpisode = true;
      slug = m[1].replace(/-\d+$/, "");
    }
    if (opts.onlyEpisodes && !isEpisode) continue;
    if (seen[slug]) continue;
    const h3 = kino.html.select(box, "h3")[0];
    const img = kino.html.select(box, "img")[0];
    let title = (h3 && h3.text) || (img && img.attrs.alt) || link.text || "";
    title = title.replace(/\s+/g, " ").trim();
    if (isEpisode) title = title.replace(/\s+\d+$/, "");
    // La imagen de una tarjeta de capítulo es una captura, no la carátula: no se usa.
    const src = img && !isEpisode ? img.attrs.src || img.attrs["data-src"] || "" : "";
    const movie = !isEpisode && (opts.movies || /anime-type-peli|>\s*Pel[ií]cula\s*</i.test(box));
    const item = mkItem(slug, title, src ? abs(src) : "", movie);
    if (!item) continue;
    seen[slug] = true;
    items.push(item);
  }
  return items;
}

function hasNextPage(html, page) {
  return new RegExp("[?&;]p=" + (page + 1) + "(?![0-9])").test(html);
}

function dirUrl(kind, page, query) {
  const parts = [];
  if (query) parts.push("q=" + encodeURIComponent(query));
  if (kind === "type:1") parts.push("type%5B%5D=1");
  if (page > 1) parts.push("p=" + page);
  return BASE + "/directorio" + (parts.length ? "?" + parts.join("&") : "");
}

// Corre fn sobre la lista con a lo más `limit` a la vez (Kino permite 6 fetches simultáneos).
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const k = next++;
      try {
        out[k] = await fn(list[k], k);
      } catch (e) {
        out[k] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

function cacheGet(key) {
  try {
    return kino.storage.get(key);
  } catch (e) {
    return null;
  }
}
function cacheSet(key, value, ttlMs) {
  try {
    kino.storage.set(key, value, { ttlMs });
  } catch (e) {
    /* sin caché */
  }
}

// Tiempo: Kino corta cualquier llamada a los 20 s y entonces la lista queda vacía. Lo que no es
// esencial (carátulas extra, TMDB) espera a lo sumo unos segundos y, si no llega, sale en la
// próxima carga desde la caché.
const LATE = { late: true };

async function nap(ms) {
  let left = ms;
  while (left > 0) {
    const d = Math.min(left, 5000);
    await kino.sleep(d);
    left -= d;
  }
}

async function within(promise, ms) {
  promise.catch(() => {});
  return Promise.race([promise, nap(ms).then(() => LATE)]);
}

// Carátula real de un anime que solo conocemos por un capítulo: se busca en el directorio
// (cuyas tarjetas sí traen la portada) y se recuerda una semana.
async function coverFor(item) {
  const key = "cov1:" + item.id;
  const hit = cacheGet(key);
  if (hit) return hit === "0" ? "" : hit;
  const q = cleanQuery(item.title);
  if (q.length < 2) return "";
  const page = await getPage(dirUrl("", 1, q));
  const match = cardsFrom(page.html).filter((c) => c.id === item.id && c.poster)[0];
  if (!match) {
    cacheSet(key, "0", 6 * 3600000);
    return "";
  }
  cacheSet(key, match.poster, 7 * 86400000);
  return match.poster;
}

// slug -> carátula de las tarjetas de una página del directorio ya leída.
function coversFrom(html) {
  const map = {};
  for (const c of cardsFrom(html)) if (c.poster) map[c.id] = c.poster;
  return map;
}

// ---------- 5. Fondo y resumen propios de cada título (TMDB) ----------

const TMDB_BACK = "https://image.tmdb.org/t/p/w780";

async function movieInfo(title) {
  if (typeof kino.tmdb !== "function") return null;
  const plain = title.replace(/\bmovie\s*\d*\s*:?\s*/i, " ").replace(/\s+/g, " ").trim();
  const tries = plain && plain !== title ? [title, plain] : [title];
  for (const q of tries) {
    const r = await kino.tmdb("/search/movie", { query: q, language: "es-MX", include_adult: false });
    const list = ((r && r.results) || []).filter((x) => x && x.id && x.original_language === "ja" && (x.genre_ids || []).indexOf(16) >= 0);
    const hit = list[0];
    if (hit) {
      return {
        overview: String(hit.overview || "").slice(0, 700),
        backdrop: hit.backdrop_path ? TMDB_BACK + hit.backdrop_path : "",
        year: String(hit.release_date || "").slice(0, 4),
      };
    }
  }
  return null;
}

// Series: se busca por el título sin "Season N" y se valida con el año del sitio (ver pickShow).
async function seriesInfo(title, year) {
  if (typeof kino.tmdb !== "function") return null;
  const sp = splitTitle(title);
  if (sp.base.length < 2) return null;
  const r = await kino.tmdb("/search/tv", { query: sp.base, language: "es-MX", include_adult: false });
  const hit = pickShow((r && r.results) || [], year || 0, sp.season, sp.marked);
  if (!hit) return null;
  return {
    overview: String(hit.overview || "").slice(0, 700),
    backdrop: hit.backdrop_path ? TMDB_BACK + hit.backdrop_path : "",
    year: "",
  };
}

// Con caché (una semana si hubo datos, un día si no). Lanza si TMDB falla: así no se guarda un "sin datos" falso.
async function infoFor(item) {
  const key = (item.kind === "movie" ? "mov2:" : "ser2:") + item.id;
  const hit = cacheGet(key);
  if (hit) return hit === "0" ? null : JSON.parse(hit);
  const info = item.kind === "movie" ? await movieInfo(item.title) : await seriesInfo(item.title, item.year);
  cacheSet(key, info ? JSON.stringify(info) : "0", info ? 7 * 86400000 : 86400000);
  return info;
}

// Pone resumen y fondo a los títulos de la lista. Las películas consultan TMDB (como mucho `cap`
// veces nuevas); las series solo usan lo que ya está en la caché, porque su ficha (episodes) lo
// consulta y guarda al abrirla. Así el inicio casi no gasta consultas de TMDB.
async function enrichItems(items, cap) {
  let fresh = 0;
  const todo = [];
  for (const it of items) {
    const hit = cacheGet((it.kind === "movie" ? "mov2:" : "ser2:") + it.id);
    if (hit) applyInfo(it, hit === "0" ? null : JSON.parse(hit));
    else if (it.kind === "movie" && fresh < cap) {
      fresh++;
      todo.push(it);
    }
  }
  await mapLimit(todo, 3, async (it) => {
    try {
      applyInfo(it, await infoFor(it));
    } catch (e) {
      kino.log("sin datos de TMDB: " + (e && e.message));
    }
  });
}

function applyInfo(item, info) {
  if (!info) return;
  if (info.overview) item.overview = info.overview;
  if (info.backdrop) item.backdrop = info.backdrop;
  if (/^\d{4}$/.test(info.year || "")) item.year = info.year;
}

// ---------- 5. search, home, browse ----------

export async function search(query) {
  const q = cleanQuery(query && query.q);
  if (q.length < 2) return [];
  const page = await getPage(dirUrl("", 1, q));
  const items = cardsFrom(page.html).slice(0, 50);
  await within(enrichItems(items, 6), 4000);
  return items;
}

// "En emisión": los animes de los últimos capítulos publicados, con su carátula real. Las carátulas
// salen de la caché, del directorio ya leído para la fila Animes y, solo para unas pocas, de una búsqueda.
async function airingItems(dirPage, deep) {
  const page = await getPage(BASE + "/");
  const ul = kino.html.select(page.html, "ul.episodes")[0];
  const items = cardsFrom(ul ? ul.html : page.html, { onlyEpisodes: true }).slice(0, 24);
  const dir = await dirPage;
  const seed = dir ? coversFrom(dir.html) : {};
  for (const it of items) {
    const hit = cacheGet("cov1:" + it.id);
    if (hit && hit !== "0") {
      it.poster = hit;
    } else if (seed[it.id]) {
      it.poster = seed[it.id];
      cacheSet("cov1:" + it.id, seed[it.id], 7 * 86400000);
    }
  }
  return items;
}

// Presupuesto del inicio: Kino corta la llamada a los 20 s y entonces no se ve nada. Todo lo opcional
// se mide contra este reloj.
const HOME_BUDGET_MS = 17000;
let T0 = 0;
function timeLeft() {
  return HOME_BUDGET_MS - (Date.now() - T0);
}

// Cada fila se guarda al llegar. Si está fresca (menos de 10 min) se usa sin pedir nada al sitio; si el
// sitio tarda o falla, se muestra la última copia (hasta 12 h) en vez de perder la fila.
const ROW_FRESH_MS = 10 * 60000;

function savedRow(id) {
  // "row2": las copias anteriores ("row1") podían traer fondos del sitio (casi negros) que bloqueaban los de TMDB.
  const raw = cacheGet("row2:" + id);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    // Solo se aceptan fondos de TMDB en las copias; cualquier otro se quita para que se vuelva a buscar el de TMDB.
    if (saved && saved.row && saved.row.items) {
      for (const it of saved.row.items) {
        if (it.backdrop && !/^https:\/\/image\.tmdb\.org\//.test(it.backdrop)) delete it.backdrop;
      }
    }
    return saved;
  } catch (e) {
    return null;
  }
}

function saveRow(row, t) {
  try {
    const raw = JSON.stringify({ t: t || Date.now(), row });
    if (raw.length < 40000) cacheSet("row2:" + row.id, raw, 12 * 3600000);
  } catch (e) {
    /* sin copia */
  }
}

// ---------- Fondos para las filas (la tele dibuja tarjetas horizontales si el título trae `backdrop`) ----------
// En la tele, una fila se ve horizontal cuando sus títulos traen fondo. Las películas lo traen de TMDB (movieInfo).
// Las series de En emisión y Animes ahora lo reciben igual, de TMDB, con la misma mecánica que las películas:
// búsqueda de animación japonesa, fondo y resumen, caché de una semana y un tope de consultas nuevas por apertura.
// (El fondo del propio sitio, /uploads/fondos, se descartó: varios salían casi negros.)

function norm(s) {
  let x = String(s || "").toLowerCase();
  if (x.normalize) x = x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return x.replace(/[^a-z0-9]+/g, " ").trim();
}
function wordsOf(s) {
  return norm(s).split(" ").filter((w) => w.length >= 3);
}
function looseMatch(r, base) {
  const q = wordsOf(base);
  if (!q.length) return false;
  const names = wordsOf((r.name || r.title || "") + " " + (r.original_name || r.original_title || ""));
  return q.filter((w) => names.indexOf(w) >= 0).length / q.length >= 0.6;
}

// Fondo y resumen de TMDB para una serie de la lista. Entre los resultados japoneses de animación se prefiere el que
// comparte la mayoría de las palabras del título; si ninguno lo hace, solo se acepta uno de estreno reciente (de los
// últimos 3 años) o, si el título es una temporada marcada ("... 4"), el primero, porque sin año en las tarjetas un
// resultado antiguo de una serie sin marcar suele ser otra serie de la misma franquicia (Steel Ball Run y JoJo 2012).
async function tmdbBackdrop(title) {
  if (typeof kino.tmdb !== "function") return null;
  const sp = splitTitle(title);
  let q = sp.base.length >= 2 ? sp.base : title;
  let marked = sp.marked && sp.season > 1;
  // Número al final ("Tensei shitara Slime Datta Ken 4"): es la temporada del sitio; se busca sin él.
  const tn = !sp.marked ? /^(.*\D)\s(\d{1,2})$/.exec(String(title).trim()) : null;
  if (tn && tn[1].trim().length >= 2) {
    q = tn[1].trim();
    marked = parseInt(tn[2], 10) > 1;
  }
  const r = await kino.tmdb("/search/tv", { query: q, language: "es-MX", include_adult: false });
  const list = ((r && r.results) || []).filter(
    (x) => x && x.id && x.original_language === "ja" && (x.genre_ids || []).indexOf(16) >= 0 && x.backdrop_path
  );
  const year = new Date().getFullYear();
  const hit =
    list.filter((x) => looseMatch(x, q))[0] ||
    list.filter((x) => parseInt(String(x.first_air_date || "").slice(0, 4), 10) >= year - 3)[0] ||
    // Temporada marcada ("... 4", "2nd Season"): su serie puede ser antigua, y una secuela rara vez se confunde con otra franquicia.
    (marked ? list[0] : null);
  if (!hit) return null;
  return { b: TMDB_BACK + hit.backdrop_path, o: String(hit.overview || "").slice(0, 700) };
}

// Con caché (7 días; 1 día si no hubo). Lanza ante un fallo de TMDB, para no guardar un "no hay" falso.
async function backdropFor(item) {
  const key = "bd2:" + item.id;
  const hit = cacheGet(key);
  if (hit) return hit === "0" ? null : JSON.parse(hit);
  const info = await tmdbBackdrop(item.title);
  cacheSet(key, info ? JSON.stringify(info) : "0", (info ? 7 : 1) * 86400000);
  return info;
}

function applyBackdrop(it, info) {
  if (!info) return false;
  if (info.b) it.backdrop = info.b;
  if (info.o && !it.overview) it.overview = info.o;
  return !!info.b;
}

// Pone el fondo guardado a las series de las filas y busca los que falten (`maxNew` por llamada, con tiempo máximo).
// Devuelve los ids de fila que cambiaron.
async function fillBackdrops(rows, maxNew, budgetMs) {
  const changed = {};
  const apply = () => {
    for (const row of rows) {
      for (const it of row.items) {
        if (it.backdrop || it.kind === "movie") continue;
        const hit = cacheGet("bd2:" + it.id);
        if (hit && hit !== "0" && applyBackdrop(it, JSON.parse(hit))) changed[row.id] = true;
      }
    }
  };
  apply();
  const todo = [];
  const seen = {};
  for (const row of rows) {
    for (const it of row.items) {
      if (it.backdrop || it.kind === "movie" || seen[it.id] || todo.length >= maxNew) continue;
      if (cacheGet("bd2:" + it.id)) continue;
      seen[it.id] = true;
      todo.push(it);
    }
  }
  if (todo.length && budgetMs > 800) {
    await within(
      mapLimit(todo, 4, async (it) => {
        try {
          await backdropFor(it);
        } catch (e) {
          kino.log("fondo: " + (e && e.message));
        }
      }),
      budgetMs
    );
    apply();
  }
  return changed;
}

// Completa las carátulas que falten en una fila (hoy solo En emisión, que nace de tarjetas de capítulo).
// Primero lo guardado (instantáneo); lo que siga faltando se busca en el directorio, `maxNew` por llamada y
// con un tiempo máximo. Cada hallazgo queda en la caché, así que unas pocas aperturas bastan para completarla.
async function fillCovers(row, maxNew, budgetMs) {
  const missing = row.items.filter((it) => !it.poster);
  if (!missing.length) return false;
  let changed = false;
  const todo = [];
  for (const it of missing) {
    const hit = cacheGet("cov1:" + it.id);
    if (hit && hit !== "0") {
      it.poster = hit;
      changed = true;
    } else if (!hit && todo.length < maxNew) {
      todo.push(it);
    }
  }
  if (todo.length && budgetMs > 800) {
    await within(
      mapLimit(todo, 4, async (it) => {
        const cover = await coverFor(it);
        if (cover) {
          it.poster = cover;
          changed = true;
        }
      }),
      budgetMs
    );
  }
  return changed;
}

// El inicio responde primero con lo guardado y solo espera al sitio una ventana corta:
//   copia de menos de 10 min  -> se usa tal cual, sin pedir nada (instantáneo);
//   copia de hasta 1 h        -> se intenta refrescar 2,5 s; si el sitio no alcanza, sale la copia;
//   copia de hasta 6 h        -> 6 s; más vieja -> 12 s;
//   sin copia (primera vez)   -> se espera lo necesario, dentro del presupuesto.
// Así el inicio casi nunca depende de lo rápido que responda TioAnime.
function refreshWindow(ageMs) {
  if (ageMs < 3600000) return 2500;
  if (ageMs < 6 * 3600000) return 6000;
  return 12000;
}

export async function home() {
  T0 = Date.now();
  const en = lang() === "en";
  // La primera página del directorio sirve a la fila Animes y a las carátulas de En emisión: una sola lectura, y solo si hace falta.
  let dirPromise = null;
  const dirPage = () => {
    if (!dirPromise) dirPromise = getPage(dirUrl("dir:all", 1)).catch(() => null);
    return dirPromise;
  };
  const defs = [
    { id: "en-emision", title: en ? "Airing now" : "En emisión", genre: "anime", load: (deep) => airingItems(dirPage(), deep) },
    {
      id: "animes",
      title: en ? "Anime" : "Animes",
      ref: "dir:all",
      load: async () => {
        const page = (await dirPage()) || (await getPage(dirUrl("dir:all", 1)));
        return cardsFrom(page.html).slice(0, 40);
      },
    },
    {
      id: "peliculas",
      title: en ? "Movies" : "Películas",
      ref: "type:1",
      genre: "peliculas",
      load: async () => cardsFrom((await getPage(dirUrl("type:1", 1))).html, { movies: true }).slice(0, 40),
    },
  ];
  const loaded = {};
  const copyTime = {};
  let deepAny = false;
  const rows = await Promise.all(
    defs.map(async (d) => {
      const mk = (items) => {
        const row = { id: d.id, title: d.title, items };
        if (d.ref) row.ref = d.ref;
        if (d.genre) row.genre = d.genre;
        return row;
      };
      const old = savedRow(d.id);
      const has = old && old.row && old.row.items && old.row.items.length;
      const age = has ? Date.now() - old.t : Infinity;
      if (has) copyTime[d.id] = old.t;
      if (has && age < ROW_FRESH_MS) return mk(old.row.items);
      const deep = !has; // búsquedas extra (carátulas, TMDB) solo cuando no hay nada guardado que mostrar
      try {
        const win = has ? refreshWindow(age) : Math.max(4000, timeLeft() - 2500);
        const items = await within(d.load(deep), win);
        if (items === LATE) throw new Error("el sitio no alcanzó en " + win + " ms");
        if (!items.length) throw new Error("sin elementos");
        loaded[d.id] = true;
        if (deep) deepAny = true;
        return mk(items);
      } catch (e) {
        kino.log("home: fila " + d.id + (has ? " (se muestra la copia guardada)" : "") + ": " + (e && e.message));
        return has ? mk(old.row.items) : null;
      }
    })
  );
  const shown = rows.filter(Boolean);
  // Datos de TMDB ya guardados: se aplican siempre (instantáneo). Consultas nuevas solo si no hay copia y sobra tiempo.
  const everything = [];
  for (const row of shown) if (loaded[row.id]) for (const it of row.items) everything.push(it);
  if (everything.length) {
    const fresh = deepAny && timeLeft() > 3500;
    await within(enrichItems(everything, fresh ? 10 : 0), fresh ? Math.min(2000, timeLeft() - 1500) : 500);
  }
  // Carátulas que falten en En emisión: se aplican las guardadas y se buscan algunas más (el tiempo que sobre).
  const airing = shown.filter((r) => r.id === "en-emision")[0];
  if (airing) {
    const budget = Math.min(loaded["en-emision"] ? 5000 : 3500, timeLeft() - 3000);
    try {
      if ((await fillCovers(airing, loaded["en-emision"] ? 8 : 6, budget)) && !loaded["en-emision"] && copyTime["en-emision"]) {
        saveRow(airing, copyTime["en-emision"]); // copia vieja con carátulas nuevas: conserva su edad
      }
    } catch (e) {
      kino.log("carátulas: " + (e && e.message));
    }
  }
  // Fondos de En emisión y Animes (tarjetas horizontales en la tele).
  try {
    const bdRows = shown.filter((r) => r.id === "en-emision" || r.id === "animes");
    if (bdRows.length) {
      const changed = await fillBackdrops(bdRows, 18, Math.min(3500, timeLeft() - 2500));
      for (const row of bdRows) {
        if (changed[row.id] && !loaded[row.id] && copyTime[row.id]) saveRow(row, copyTime[row.id]);
      }
    }
  } catch (e) {
    kino.log("fondos: " + (e && e.message));
  }
  // Se guarda cada fila ya completa para las próximas cargas.
  for (const row of shown) if (loaded[row.id]) saveRow(row);
  return shown;
}

export async function browse(ref, cursor) {
  const kind = String(ref);
  if (!/^(dir:all|type:1)$/.test(kind)) throw fail("not_found", "browse " + kind, "notFound");
  const n = parseInt(cursor, 10);
  const pageNo = n > 0 ? n : 1;
  const page = await getPage(dirUrl(kind, pageNo));
  const items = cardsFrom(page.html, { movies: kind === "type:1" });
  await within(enrichItems(items, 10), 4000);
  const out = { items };
  if (items.length && hasNextPage(page.html, pageNo)) out.next = String(pageNo + 1);
  return out;
}

// ---------- 6. episodes ----------

function parseList(src) {
  const out = [];
  const re = /["']([^"']*)["']|(-?\d+)/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

// Imagen y resumen por capítulo: TioAnime no los da, así que se piden a TMDB con kino.tmdb
// (Kino pone la llave). Si algo falla, los capítulos salen igual, sin imagen ni resumen.

const TMDB_IMG = "https://image.tmdb.org/t/p/w300";

function splitTitle(title) {
  let season = 1;
  let base = String(title);
  let marked = false;
  let m = /\b(\d+)(?:st|nd|rd|th)\s+season\b/i.exec(base) || /\bseason\s+(\d+)\b/i.exec(base);
  if (m) {
    season = parseInt(m[1], 10);
    base = base.replace(m[0], " ");
    marked = true;
  } else {
    m = /\s(II|III|IV|V|VI)$/.exec(base);
    if (m) {
      season = { II: 2, III: 3, IV: 4, V: 5, VI: 6 }[m[1]];
      base = base.replace(/\s(II|III|IV|V|VI)$/, "");
      marked = true;
    }
  }
  base = base.replace(/\(\d{4}\)/g, " ").replace(/\s+/g, " ").trim();
  return { base, season, marked };
}

// Elige la serie de TMDB que corresponde al anime del sitio. Reglas, para no confundir una serie con
// otra de su misma franquicia (por ejemplo, Steel Ball Run con la primera serie de JoJo):
//  - solo series japonesas (los animes de TioAnime lo son) y, si hay, de animación;
//  - temporada 1 sin marcar: su primer estreno debe estar cerca del año del sitio (hasta 4 años antes);
//  - temporada marcada (2nd Season, "... 3"): el primer estreno solo puede ser anterior o igual al año del sitio.
// Si nada cumple, no se usa TMDB: es mejor no mostrar datos que mostrar los de otra serie.
function pickShow(results, year, season, marked) {
  const list = (results || []).filter((r) => r && r.id && r.original_language === "ja");
  const anim = list.filter((r) => (r.genre_ids || []).indexOf(16) >= 0);
  for (const r of anim.length ? anim : list) {
    const y = parseInt(String(r.first_air_date || "").slice(0, 4), 10);
    if (!year || !y) return r;
    const diff = year - y;
    if (marked && season > 1 ? diff >= 0 : diff >= -1 && diff <= 4) return r;
  }
  return null;
}

async function tmdbSeason(id, season, language) {
  const d = await kino.tmdb("/tv/" + id + "/season/" + season, { language });
  return (d && d.episodes) || [];
}

// number -> { name, overview, still, air, rt } con la numeración de TioAnime.
async function tmdbEpisodes(title, year, maxNum) {
  const sp = splitTitle(title);
  if (sp.base.length < 2) return {};
  const found = await kino.tmdb("/search/tv", { query: sp.base, language: "es-MX", include_adult: false });
  const show = pickShow(found && found.results, year, sp.season, sp.marked);
  if (!show) return {};
  let eps = await tmdbSeason(show.id, sp.season, "es-MX");
  const byNum = {};
  if (!sp.marked && maxNum > eps.length) {
    // Numeración absoluta (capítulo 50 de una serie con varias temporadas).
    const detail = await kino.tmdb("/tv/" + show.id, { language: "es-MX" });
    const seasons = ((detail && detail.seasons) || []).filter((x) => x.season_number > 0).slice(0, 10);
    let offset = 0;
    for (const se of seasons) {
      const list = se.season_number === sp.season ? eps : await tmdbSeason(show.id, se.season_number, "es-MX");
      for (const e of list) byNum[offset + e.episode_number] = e;
      offset += list.length;
    }
  } else {
    for (const e of eps) byNum[e.episode_number] = e;
    const empty = eps.filter((e) => !e.overview).length;
    if (eps.length && empty > eps.length / 2) {
      try {
        const en = await tmdbSeason(show.id, sp.season, "en-US");
        for (const e of en) if (byNum[e.episode_number] && !byNum[e.episode_number].overview) byNum[e.episode_number].overview = e.overview;
      } catch (err) {
        /* sin respaldo en inglés */
      }
    }
  }
  const out = {};
  for (const k of Object.keys(byNum)) {
    const e = byNum[k];
    out[k] = {
      name: String(e.name || "").slice(0, 200),
      overview: String(e.overview || "").slice(0, 2000),
      still: e.still_path ? TMDB_IMG + e.still_path : "",
      air: /^\d{4}-\d{2}-\d{2}$/.test(e.air_date || "") ? e.air_date : "",
      rt: e.runtime > 0 && e.runtime <= 1000 ? e.runtime : 0,
    };
  }
  return out;
}

async function episodeExtras(slug, title, year, maxNum) {
  if (typeof kino.tmdb !== "function") return {};
  const key = "tmdb2:" + slug;
  try {
    const hit = kino.storage.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    /* sin caché */
  }
  let extras = {};
  try {
    extras = await tmdbEpisodes(title, year, maxNum);
  } catch (e) {
    kino.log("tmdb: " + (e && e.message));
    return {};
  }
  try {
    const raw = JSON.stringify(extras);
    if (Object.keys(extras).length && raw.length < 60000) kino.storage.set(key, raw, { ttlMs: 6 * 3600000 });
  } catch (e) {
    /* no cabe: se pide otra vez */
  }
  return extras;
}

// Lee la ficha del sitio: números de capítulo y datos de la serie.
function parseAnimePage(html, slug) {
  // Números de capítulo: "var episodes = [12,11,...]" y, si no está, los enlaces /ver/slug-N.
  const nums = {};
  const em = /var\s+episodes\s*=\s*\[([^\]]*)\]/.exec(html);
  if (em) {
    for (const v of parseList(em[1])) {
      const n = parseInt(v, 10);
      if (n >= 0 && n < 99999) nums[n] = true;
    }
  }
  if (!Object.keys(nums).length) {
    const re = new RegExp("/ver/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)", "g");
    let x;
    while ((x = re.exec(html))) nums[parseInt(x[1], 10)] = true;
  }
  const numbers = Object.keys(nums)
    .map(Number)
    .sort((a, b) => a - b)
    .slice(0, 2000);

  // Datos de la serie.
  const info = {};
  const h1 = kino.html.select(html, "h1")[0];
  if (h1 && h1.text.trim()) info.title = h1.text.replace(/\s+/g, " ").trim().slice(0, 200);
  const sin = kino.html.select(html, "p.sinopsis")[0];
  if (sin && sin.text.trim()) info.overview = sin.text.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!info.overview) {
    // La sinopsis también viene en la descripción de la página (sin el sufijo "- TioAnime ...").
    const ogd = kino.html.select(html, "meta[property=og:description]")[0];
    const text = ogd && ogd.attrs.content ? ogd.attrs.content.replace(/\s*-\s*TioAnime[^]*$/i, "").replace(/\s+/g, " ").trim() : "";
    if (text.length > 30) info.overview = text.slice(0, 2000);
  }
  const genres = kino.html.select(html, ".genres a").map((g) => g.text.trim()).filter(Boolean);
  if (genres.length) info.genres = genres.slice(0, 5).map((g) => g.slice(0, 30));
  const year = kino.html.select(html, "span.year")[0];
  if (year && /\d{4}/.test(year.text)) info.year = /\d{4}/.exec(year.text)[0];
  const am = /var\s+anime_info\s*=\s*\[([^\]]*)\]/.exec(html);
  if (am) {
    const parts = parseList(am[1]);
    if (/^\d+$/.test(parts[0] || "")) info.poster = BASE + "/uploads/portadas/" + parts[0] + ".jpg";
  }
  if (!info.poster) {
    const og = kino.html.select(html, "meta[property=og:image]")[0];
    if (og && og.attrs.content) info.poster = abs(og.attrs.content);
  }
  return { numbers, info };
}

function savedGet(key) {
  const raw = cacheGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export async function episodes(ref) {
  const T = Date.now();
  const left = () => 18500 - (Date.now() - T);
  const m = /^a:([A-Za-z0-9._~-]+)$/.exec(String(ref));
  if (!m) throw fail("not_found", "ref " + ref, "badRef");
  const slug = m[1];

  // La ficha del sitio se guarda: fresca 10 min (sin pedir nada), y de respaldo 12 h si el sitio tarda o falla.
  const key = "ep1:" + slug;
  const saved = savedGet(key);
  let data = saved && saved.data && Date.now() - saved.t < 10 * 60000 ? saved.data : null;
  if (!data) {
    try {
      const page = await getPage(BASE + "/anime/" + slug, null, 14000);
      data = parseAnimePage(page.html, slug);
      if (data.numbers.length) cacheSet(key, JSON.stringify({ t: Date.now(), data }), 12 * 3600000);
    } catch (e) {
      if (!saved || !saved.data) throw e;
      kino.log("episodes: se usa la copia guardada (" + (e && e.message) + ")");
      data = saved.data;
    }
  }
  const numbers = data.numbers;
  const info = Object.assign({}, data.info);
  const slugTitle = slug.replace(/-/g, " ");
  // TMDB solo si sobra tiempo (Kino corta la llamada a los 20 s); lo que no llegue sale en la próxima apertura.
  let extras = {};
  if (left() > 3000) {
    const got = await within(
      episodeExtras(slug, info.title || slugTitle, parseInt(info.year, 10) || 0, numbers.length ? numbers[numbers.length - 1] : 0),
      Math.min(6000, left() - 1500)
    );
    if (got !== LATE) extras = got || {};
  }
  const shift = numbers.length && numbers[0] === 0 ? 1 : 0;
  const list = numbers.map((n) => {
    // Kino numera desde 1 y no admite el capítulo 0: cuando existe, todos los números se
    // muestran +1 ("1. Capítulo 0", "2. Capítulo 1"...). El título y el ref llevan el número real
    // del sitio, y los datos de TMDB se buscan con ese número real.
    const ep = {
      season: 1,
      number: n + shift,
      ref: "e:" + slug + ":" + n,
      title: t("episode") + n,
    };
    const x = extras[n];
    if (x) {
      if (x.name && !/^(episode|episodio|cap[ií]tulo)\s*\d+$/i.test(x.name)) ep.title = x.name;
      if (x.overview) ep.overview = x.overview;
      if (x.still) ep.still = x.still;
      if (x.air) ep.airDate = x.air;
      if (x.rt) ep.runtimeMinutes = x.rt;
    }
    return ep;
  });
  try {
    const extra = left() > 2500 ? await within(infoFor({ id: slug, kind: "series", title: info.title || slugTitle, year: parseInt(info.year, 10) || 0 }), Math.min(3000, left() - 1000)) : null;
    if (extra && extra !== LATE) {
      if (extra.backdrop) info.backdrop = extra.backdrop;
      if (extra.overview && (info.overview || "").length < 80) info.overview = extra.overview;
    }
  } catch (e) {
    kino.log("ficha sin TMDB: " + (e && e.message));
  }
  return { series: info, episodes: list };
}

// ---------- 7. Servidores: Voe y YourUpload ----------

// "var videos = [["Voe","https:\/\/voe.sx\/e\/abc",0,0],["YourUpload","https:\/\/www.yourupload.com\/embed\/xyz",0,0]];"
function listServers(html) {
  const out = [];
  out.skipped = [];
  const m = /var\s+videos\s*=\s*(\[[\s\S]*?\])\s*;/.exec(html);
  if (!m) return out;
  let rows = [];
  try {
    rows = JSON.parse(m[1]);
  } catch (e) {
    rows = [];
  }
  if (!rows.length) {
    const re = /\[\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/g;
    let x;
    while ((x = re.exec(m[1]))) rows.push([x[1], x[2]]);
  }
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const name = String(row[0] || "");
    const url = unslash(row[1] || "");
    if (!/^https?:\/\//i.test(url)) continue;
    let kind = null;
    if (/voe/i.test(name) || /^https?:\/\/(?:www\.)?voe\./i.test(url)) kind = "voe";
    else if (/yourupload/i.test(name) || /yourupload\.com/i.test(url)) kind = "yourupload";
    if (kind) out.push({ kind, url, name });
    else out.skipped.push(name);
  }
  return out;
}

function serverLabel(s, all) {
  const base = s.kind === "voe" ? "Voe" : "YourUpload";
  const same = all.filter((x) => x.kind === s.kind);
  return same.length > 1 ? base + " " + (same.indexOf(s) + 1) : base;
}

// --- Voe ---

// Voe esconde el JSON del video en <script type="application/json">["..."]</script>:
// ROT13, quitar marcas, base64, restar 3 a cada carácter, invertir, base64, JSON.
function decodeVoe(enc) {
  let s = rot13(enc);
  s = s.replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g, "");
  s = b64text(s);
  let shifted = "";
  for (let i = 0; i < s.length; i++) shifted += String.fromCharCode(s.charCodeAt(i) - 3);
  shifted = shifted.split("").reverse().join("");
  return JSON.parse(b64text(shifted));
}

function pickUrls(obj) {
  const get = (k) => (typeof obj[k] === "string" ? obj[k] : "");
  const hls = get("source") || get("hls") || get("file");
  const mp4 = get("direct_access_url") || get("mp4");
  return { hls: /\.m3u8/i.test(hls) ? hls : "", mp4: mp4 || (hls && !/\.m3u8/i.test(hls) ? hls : "") };
}

function voeExtract(html) {
  // 1) Formato actual: JSON ofuscado.
  const re = /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      let raw = JSON.parse(m[1].trim());
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw !== "string") continue;
      const found = pickUrls(decodeVoe(raw));
      if (found.hls || found.mp4) return found;
    } catch (e) {
      /* siguiente script */
    }
  }
  // 2) Formato anterior: 'hls': 'base64' y 'mp4': 'base64' en el JS de la página.
  const val = (key) => {
    const x = new RegExp("[\"']" + key + "[\"']\\s*:\\s*[\"']([^\"']+)[\"']").exec(html);
    if (!x) return "";
    const v = unslash(x[1]);
    return /^https?:\/\//i.test(v) ? v : b64text(v);
  };
  const old = { hls: val("hls"), mp4: val("mp4") };
  if (/^https?:\/\//i.test(old.hls) || /^https?:\/\//i.test(old.mp4)) {
    return { hls: /^https?:\/\//i.test(old.hls) ? old.hls : "", mp4: /^https?:\/\//i.test(old.mp4) ? old.mp4 : "" };
  }
  // 3) Último recurso: cualquier .m3u8 o .mp4 a la vista.
  const flat = unslash(html);
  const hm = /https?:\/\/[^"'\s\\<>]+\.m3u8[^"'\s\\<>]*/i.exec(flat);
  if (hm) return { hls: hm[0], mp4: "" };
  const mm = /https?:\/\/[^"'\s\\<>]+\.mp4[^"'\s\\<>]*/i.exec(flat);
  if (mm) return { hls: "", mp4: mm[0] };
  return { hls: "", mp4: "" };
}

async function voeStream(embed) {
  let url = embed;
  let html = "";
  for (let hop = 0; hop < 3; hop++) {
    const page = await getPage(url, { Referer: BASE + "/" });
    html = page.html;
    url = page.url;
    const jm = /window\.location\.href\s*=\s*["']([^"']+)["']/.exec(html);
    if (jm && /^https?:\/\//i.test(jm[1]) && jm[1] !== url) {
      url = jm[1];
      continue;
    }
    break;
  }
  const found = voeExtract(html);
  const main = found.hls || found.mp4;
  if (!main) {
    const gone = /not\s*found|has been deleted|was deleted|removed|no longer available|copyright/i.test(html.slice(0, 20000));
    throw fail("unavailable", (gone ? "Voe video borrado en " : "Voe sin video en ") + url, "serverFailed");
  }
  const headers = { Referer: originOf(url) + "/", "User-Agent": UA };
  const res = { url: main, headers, alts: [] };
  if (found.hls && found.mp4) res.alts.push({ url: found.mp4, headers, label: "Voe MP4" });
  return res;
}

// --- YourUpload ---

async function yourUploadStream(embed) {
  const page = await getPage(embed, { Referer: "https://www.yourupload.com/" });
  const html = page.html;
  let file = "";
  let m = /file\s*:\s*["']([^"']+)["']/.exec(html);
  if (m) file = m[1];
  if (!file) {
    m =
      /property=["']og:video(?::url)?["'][^>]*content=["']([^"']+)["']/i.exec(html) ||
      /content=["']([^"']+)["'][^>]*property=["']og:video(?::url)?["']/i.exec(html);
    if (m) file = m[1];
  }
  if (!file) {
    m = /<source[^>]+src=["']([^"']+)["']/i.exec(html);
    if (m) file = m[1];
  }
  file = unslash(file).replace(/&amp;/g, "&");
  if (!file) {
    const gone = /not\s*found|has been deleted|was deleted|removed|no longer available|copyright/i.test(html.slice(0, 20000));
    throw fail("unavailable", gone ? "YourUpload video borrado" : "YourUpload sin video", "serverFailed");
  }
  file = abs(file, page.url).replace(/^http:\/\//i, "https://");
  return { url: file, headers: { Referer: "https://www.yourupload.com/", "User-Agent": UA }, alts: [] };
}

async function streamFor(s) {
  return s.kind === "voe" ? voeStream(s.url) : yourUploadStream(s.url);
}

// ---------- 8. resolve ----------

// "e:<slug>:<n>" = el capítulo; "s:<índice>:e:<slug>:<n>" = copia diferida de un servidor.
function parseRef(ref) {
  let m = /^s:(\d+):e:([A-Za-z0-9._~-]+):(\d+)$/.exec(ref);
  if (m) return { idx: parseInt(m[1], 10), slug: m[2], n: parseInt(m[3], 10) };
  m = /^e:([A-Za-z0-9._~-]+):(\d+)$/.exec(ref);
  if (m) return { idx: -1, slug: m[1], n: parseInt(m[2], 10) };
  return null;
}

export async function resolve(ref) {
  const p = parseRef(String(ref));
  if (!p) throw fail("not_found", "ref " + ref, "badRef");

  const page = await getPage(BASE + "/ver/" + p.slug + "-" + p.n);
  const all = listServers(page.html);
  kino.log(
    "resolve: " + p.slug + "-" + p.n + " servidores compatibles: " + (all.map((s) => s.name).join(", ") || "ninguno") +
      " | otros: " + ((all.skipped || []).join(", ") || "ninguno")
  );
  if (!all.length) {
    const others = (all.skipped || []).filter((n, i, a) => n && a.indexOf(n) === i).slice(0, 4);
    const text =
      (lang() === "en" ? "This episode has no Voe or YourUpload." : "Este capítulo no tiene Voe ni YourUpload.") +
      (others.length ? (lang() === "en" ? " Available: " : " Disponibles: ") + others.join(", ") + "." : "");
    throw failWith("not_found", "sin Voe ni YourUpload (otros: " + others.join(", ") + ")", text);
  }

  let order;
  if (p.idx >= 0) {
    order = all[p.idx] ? [all[p.idx]] : [];
  } else {
    const pref = String(kino.config.get("server") || "voe");
    order = all.slice().sort((a, b) => (a.kind === pref ? 0 : 1) - (b.kind === pref ? 0 : 1));
  }

  let main = null;
  let used = null;
  const rest = [];
  const failures = [];
  for (const s of order) {
    if (main) {
      rest.push(s);
      continue;
    }
    try {
      main = await streamFor(s);
      used = s;
    } catch (e) {
      kino.log("resolve: " + s.kind + " falló: " + (e && e.message));
      failures.push({ label: serverLabel(s, all), reason: reasonOf(e), detail: (e && e.message) || "" });
    }
  }
  if (!main) {
    const others = (all.skipped || []).filter((n, i, a) => n && a.indexOf(n) === i).slice(0, 3);
    const text =
      (lang() === "en" ? "The video could not be opened. " : "No se pudo abrir el video. ") +
      failures.map((f) => f.label + ": " + f.reason + ".").join(" ") +
      (others.length ? (lang() === "en" ? " Only on the site: " : " En el sitio solo hay: ") + others.join(", ") + "." : "");
    throw failWith("unavailable", "ningún servidor abrió (" + failures.map((f) => f.label + ": " + f.detail).join(" | ") + ")", text);
  }

  const stream = {
    url: main.url,
    headers: main.headers,
    label: serverLabel(used, all),
    expiresInSeconds: 1800,
  };
  if (p.idx < 0) {
    const alts = main.alts.slice();
    for (const s of rest) {
      alts.push({ label: serverLabel(s, all), ref: "s:" + all.indexOf(s) + ":e:" + p.slug + ":" + p.n });
    }
    if (alts.length) stream.alternatives = alts.slice(0, 8);
  }
  return stream;
}
