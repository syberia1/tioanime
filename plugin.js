/// <reference path="./kino.d.ts" />

const BASE = "https://tioanime.com";

export async function search(query) {
  await null; 
  if (!query.q) return [];

  const url = `${BASE}/directorio?q=${encodeURIComponent(query.q)}`;
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("unavailable", `TioAnime respondió ${r.status}`);

  const html = await r.text();
  const elements = kino.html.select(html, "ul.anime-list li article.anime");

  return elements.map(el => {
    const a = kino.html.select(el.html, "a[href]")[0];
    const img = kino.html.select(el.html, "figure img[src]")[0];
    const title = kino.html.select(el.html, "h3.title")[0];
    
    // Extraer el slug de la URL (/anime/nombre-del-anime)
    const href = a?.attrs?.href || "";
    const ref = href.split("/").pop();

    return {
      id: ref,
      ref: ref,
      title: title?.text?.trim() || "Desconocido",
      kind: "series",
      poster: img?.attrs?.src ? (BASE + img.attrs.src) : undefined
    };
  }).filter(item => item.ref);
}

export async function home() {
  await null;
  const r = await kino.fetch(BASE);
  if (!r.ok) throw kino.error("unavailable", `TioAnime respondió ${r.status}`);

  const html = await r.text();
  const episodes = kino.html.select(html, "ul.episodes-list li article.episode");
  
  const items = episodes.map(el => {
    const a = kino.html.select(el.html, "a[href]")[0];
    const img = kino.html.select(el.html, "figure img[src]")[0];
    const title = kino.html.select(el.html, "h3.title")[0];
    
    const href = a?.attrs?.href || "";
    const ref = href.split("/").pop(); // Ej: nombre-del-anime-1

    return {
      id: ref,
      ref: ref,
      title: title?.text?.trim() || "Episodio",
      kind: "movie", // Tratamos los episodios sueltos como "movie" para reproducción directa
      poster: img?.attrs?.src ? (BASE + img.attrs.src) : undefined
    };
  }).filter(item => item.ref);

  return [
    {
      id: "ultimos-episodios",
      title: "Últimos Episodios",
      genre: "anime",
      items: items
    }
  ];
}

export async function episodes(ref) {
  await null;
  const url = `${BASE}/anime/${encodeURIComponent(ref)}`;
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("not_found", `No se encontró el anime ${ref}`);

  const html = await r.text();
  
  // TioAnime almacena los episodios en variables globales de Javascript
  const animeInfoMatch = html.match(/var\s+anime_info\s*=\s*(\[.*?\]);/);
  const episodesMatch = html.match(/var\s+episodes\s*=\s*(\[.*?\]);/);
  
  if (!animeInfoMatch || !episodesMatch) {
    throw kino.error("not_found", "No se pudieron extraer los episodios");
  }

  const animeInfo = JSON.parse(animeInfoMatch[1]);
  const eps = JSON.parse(episodesMatch[1]);
  const slug = animeInfo[1]; // Nombre base del anime

  const episodeList = eps.map(num => {
    return {
      season: 1,
      number: num,
      ref: `${slug}-${num}`,
      title: `Episodio ${num}`
    };
  }).reverse(); // Revertimos para que el 1 quede de primero

  return { episodes: episodeList };
}

export async function resolve(ref) {
  await null;

  // Si la petición es para una copia "lazy" elegida por el usuario (slug-episodio|url)
  if (ref.includes("|")) {
    const parts = ref.split("|", 2);
    return resolveServer(parts[1]);
  }

  const url = `${BASE}/ver/${encodeURIComponent(ref)}`;
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("not_found", `No se encontró el episodio ${ref}`);

  const html = await r.text();
  
  // Extraemos la lista de servidores de Javascript
  const videosMatch = html.match(/var\s+videos\s*=\s*(\[.*?\]);/);
  if (!videosMatch) {
    throw kino.error("not_found", "No se encontraron servidores de video", { userMessage: "El episodio aún no tiene servidores disponibles." });
  }

  const videos = JSON.parse(videosMatch[1]);
  if (videos.length === 0) {
    throw kino.error("unavailable", "Lista de servidores vacía");
  }
  
  const servers = [];
  for (const v of videos) {
    let name = "Servidor";
    let link = "";
    
    // El formato varía ligeramente, revisamos el array o el objeto
    if (Array.isArray(v) && v.length >= 2) {
      name = v[0];
      link = String(v[1]).replace(/\\\//g, "/");
    } else if (typeof v === "object" && v.code) {
      name = v.server || "Servidor";
      link = String(v.code).replace(/\\\//g, "/");
    }
    
    // Limpiamos etiquetas iframe en caso de venir completas
    const iframeMatch = link.match(/src=["'](.*?)["']/);
    if (iframeMatch) link = iframeMatch[1];
    
    if (link.startsWith("http")) {
      servers.push({ name, link });
    }
  }

  if (servers.length === 0) {
    throw kino.error("unavailable", "No hay servidores compatibles");
  }

  // Resolvemos el primero automáticamente a través del navegador oculto
  const firstStream = await resolveServer(servers[0].link);

  return {
    ...firstStream,
    label: servers[0].name,
    alternatives: servers.slice(1, 8).map((s) => ({
      label: s.name,
      ref: `${ref}|${s.link}` // Copias "perezosas" para que no bloqueen la carga[cite: 2]
    }))
  };
}

async function resolveServer(url) {
  try {
    // El navegador oculto espera que cargue la página y detecta las peticiones de medios[cite: 2]
    const capture = await kino.browser.capture(url, { timeoutMs: 15000 });
    if (!capture.media || capture.media.length === 0) {
      throw kino.error("unavailable", "No se pudo extraer el video de este servidor");
    }
    
    return {
      url: capture.media[0].url,
      headers: capture.media[0].headers || {}
    };
  } catch (e) {
    if (e.code) throw e;
    throw kino.error("unavailable", e.message || "Error al capturar servidor");
  }
}