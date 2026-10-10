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
async function getPage(url, headers) {
  const r = await kino.fetch(url, {
    headers: Object.assign(
      { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9", Accept: "text/html,application/xhtml+xml,*/*" },
      headers || {}
    ),
  });
  if (r.status === 404) throw fail("not_found", "HTTP 404 " + url, "notFound");
  if (!r.ok) throw fail("unavailable", "HTTP " + r.status + " " + url, "siteDown");
  return { html: r.text(), url: r.url || url };
}

// ---------- 4. Lectura de TioAnime ----------

function mkItem(slug, title, poster) {
  if (!slug || !ID_OK.test(slug) || !title) return null;
  const item = { id: slug, ref: "a:" + slug, title: String(title).slice(0, 200), kind: "series" };
  if (poster) item.poster = poster;
  return item;
}

// Tarjetas (<article>) de un listado. Sirven las de anime (/anime/slug) y las de capítulo (/ver/slug-N).
function cardsFrom(html) {
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
    if (seen[slug]) continue;
    const h3 = kino.html.select(box, "h3")[0];
    const img = kino.html.select(box, "img")[0];
    let title = (h3 && h3.text) || (img && img.attrs.alt) || link.text || "";
    title = title.replace(/\s+/g, " ").trim();
    if (isEpisode) title = title.replace(/\s+\d+$/, "");
    const src = img ? img.attrs.src || img.attrs["data-src"] || "" : "";
    const item = mkItem(slug, title, src ? abs(src) : "");
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
  let u = BASE + "/directorio?";
  if (query) u += "q=" + encodeURIComponent(query) + "&";
  if (kind === "type:1" || kind === "type:2" || kind === "type:3") u += "type%5B%5D=" + kind.slice(5) + "&";
  if (page > 1) u += "p=" + page;
  return u.replace(/[?&]$/, "");
}

// ---------- 5. search, home, browse ----------

export async function search(query) {
  const q = cleanQuery(query && query.q);
  if (q.length < 2) return [];
  const page = await getPage(dirUrl("", 1, q));
  return cardsFrom(page.html).slice(0, 50);
}

export async function home() {
  const defs = [
    { id: "ultimos-episodios", title: lang() === "en" ? "Latest episodes" : "Últimos episodios", url: BASE + "/", pick: "ul.episodes" },
    { id: "animes", title: lang() === "en" ? "Anime" : "Animes", url: dirUrl("", 1), ref: "dir:all" },
    { id: "peliculas", title: lang() === "en" ? "Movies" : "Películas", url: dirUrl("type:1", 1), ref: "type:1", genre: "peliculas" },
    { id: "ovas", title: "OVAs", url: dirUrl("type:2", 1), ref: "type:2" },
  ];
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        const page = await getPage(d.url);
        let html = page.html;
        if (d.pick) {
          const ul = kino.html.select(html, d.pick)[0];
          if (ul) html = ul.html;
        }
        const items = cardsFrom(html).slice(0, 40);
        if (!items.length) return null;
        const row = { id: d.id, title: d.title, items };
        if (d.ref) row.ref = d.ref;
        if (d.genre) row.genre = d.genre;
        return row;
      } catch (e) {
        kino.log("home: fila " + d.id + " falló: " + (e && e.message));
        return null;
      }
    })
  );
  return rows.filter(Boolean);
}

export async function browse(ref, cursor) {
  const kind = String(ref);
  if (kind !== "dir:all" && !/^type:[123]$/.test(kind)) throw fail("not_found", "browse " + kind, "notFound");
  const n = parseInt(cursor, 10);
  const pageNo = n > 0 ? n : 1;
  const page = await getPage(dirUrl(kind, pageNo));
  const items = cardsFrom(page.html);
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

export async function episodes(ref) {
  const m = /^a:([A-Za-z0-9._~-]+)$/.exec(String(ref));
  if (!m) throw fail("not_found", "ref " + ref, "badRef");
  const slug = m[1];
  const page = await getPage(BASE + "/anime/" + slug);
  const html = page.html;

  // Números de capítulo: "var episodes = [12,11,...]" y, si no está, los enlaces /ver/slug-N.
  const nums = {};
  const em = /var\s+episodes\s*=\s*\[([^\]]*)\]/.exec(html);
  if (em) {
    for (const v of parseList(em[1])) {
      const n = parseInt(v, 10);
      if (n > 0 && n < 100000) nums[n] = true;
    }
  }
  if (!Object.keys(nums).length) {
    const re = new RegExp("/ver/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)", "g");
    let x;
    while ((x = re.exec(html))) nums[parseInt(x[1], 10)] = true;
  }
  const list = Object.keys(nums)
    .map(Number)
    .sort((a, b) => a - b)
    .slice(0, 2000)
    .map((n) => ({ season: 1, number: n, ref: "e:" + slug + ":" + n, title: t("episode") + n }));

  // Datos de la serie.
  const info = {};
  const h1 = kino.html.select(html, "h1")[0];
  if (h1 && h1.text.trim()) info.title = h1.text.replace(/\s+/g, " ").trim().slice(0, 200);
  const sin = kino.html.select(html, "p.sinopsis")[0];
  if (sin && sin.text.trim()) info.overview = sin.text.replace(/\s+/g, " ").trim().slice(0, 2000);
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
  return { series: info, episodes: list };
}

// ---------- 7. Servidores: Voe y YourUpload ----------

// "var videos = [["Voe","https:\/\/voe.sx\/e\/abc",0,0],["YourUpload","https:\/\/www.yourupload.com\/embed\/xyz",0,0]];"
function listServers(html) {
  const out = [];
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
  if (!main) throw fail("unavailable", "Voe sin video en " + url, "serverFailed");
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
  if (!file) throw fail("unavailable", "YourUpload sin video", "serverFailed");
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
  if (!all.length) throw fail("not_found", "sin Voe ni YourUpload", "noServers");

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
    }
  }
  if (!main) throw fail("unavailable", "ningún servidor abrió", "serverFailed");

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
