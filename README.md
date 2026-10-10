# TioAnime para Kino

Plugin de Kino (apiVersion 6) para [TioAnime](https://tioanime.com): busca, lista capítulos y reproduce por **Voe** y **YourUpload**.

| Función | Qué hace |
| --- | --- |
| `search` | Busca en `/directorio?q=` |
| `home` | Filas: En emisión (los animes de los últimos capítulos publicados), Animes y Películas, siempre con la carátula real |
| `browse` | "Ver más" paginado de cada fila |
| `episodes` | Capítulos de `/anime/<slug>`; imagen, título y resumen de cada uno se piden a TMDB con `kino.tmdb` (Kino 0.9.53+) |
| `resolve` | Lee `var videos` de `/ver/<slug>-<n>`, saca Voe y YourUpload; el servidor preferido suena primero y el otro queda como copia en el menú **Servidor** |

## Publicar e instalar

1. En `kino-plugin.json` cambia `author`.
2. Crea un repositorio **público** en GitHub y sube `kino-plugin.json` y `plugin.js` a la raíz (más un `.gitignore` con `.kino-storage.json`).
3. Opcional: agrega el topic `kino-plugin` para salir en "De la comunidad".
4. En Kino: **Ajustes ▸ Plugins** y escribe `tu-usuario/tu-repo`.

El plugin declara `fetchHosts` y `streamHosts` en `"any"`: Voe cambia de dominio y de CDN seguido, así que Kino te lo mostrará como permiso amplio al instalar.

## Probar

Copia la carpeta `sdk/` de `kinotvapp/kino-plugin-archive` junto a estos archivos (Node 18+):

```
node sdk/validate.mjs .
node sdk/run.mjs . search "one piece"
node sdk/run.mjs . home
node sdk/run.mjs . episodes a:one-piece-tv
node sdk/run.mjs . resolve e:one-piece-tv:1
```

`kino.html.select` solo existe dentro de la app, así que `search`, `home` y `episodes` hay que probarlos instalado en Kino.

## Si algo falla

- **En emisión sin carátula:** la carátula se busca en el directorio por título; si no hay coincidencia exacta, el anime sale sin imagen.
- **Fondo y resumen de series:** vienen de TMDB y se guardan una semana. La primera vez, cada fila consulta pocos títulos a la vez (el límite de TMDB es bajo), así que algunos se completan en la segunda o tercera carga del inicio.
- **Películas:** se muestran como película (un solo botón de reproducir, capítulo 1 del sitio). Fondo, resumen y año vienen de TMDB; si no la encuentra, quedan solo la carátula y el título.
- **Un capítulo sin imagen o resumen:** TMDB no encontró la serie (o la numeración no coincide). Sale como "Capítulo N" sin foto.
- **No salen resultados o capítulos:** TioAnime cambió su HTML. Los selectores están en `cardsFrom()` y `episodes()`.
- **Voe no abre:** Voe cambia su ofuscación. Ajusta `decodeVoe()` / `voeExtract()`.
- **YourUpload no abre:** el video suele estar en un puerto raro (`vidcache.net:8161`); si Kino lo rechaza, usa Voe.
- **Errores en pantalla:** enciende "Modo debug" en la pestaña del plugin y revisa el registro.
