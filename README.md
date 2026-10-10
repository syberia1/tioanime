# TioAnime para Kino

Plugin para [Kino](https://github.com/kinotvapp/kino-light) (Android, celular y TV) que permite buscar anime subtitulado al español de [TioAnime](https://tioanime.com), ver su catálogo, abrir cada serie o película y reproducirla desde los servidores **Voe** y **YourUpload**, que es donde TioAnime aloja sus capítulos.

Este README explica qué hace el plugin, cómo está armado, de dónde saca cada dato, qué limitaciones tiene y cómo mantenerlo cuando TioAnime o Voe cambien. Está escrito para quien vaya a tocar el código, no para quien solo lo instala; para instalarlo basta con leer la sección [Instalación](#instalación).

---

## Índice

1. [Qué hace](#qué-hace)
2. [Instalación](#instalación)
3. [Cómo se ve en Kino](#cómo-se-ve-en-kino)
4. [Estructura del repositorio](#estructura-del-repositorio)
5. [Cómo funciona por dentro](#cómo-funciona-por-dentro)
   - [Lectura de TioAnime](#lectura-de-tioanime)
   - [Catálogo: inicio, Ver más y búsqueda](#catálogo-inicio-ver-más-y-búsqueda)
   - [En emisión](#en-emisión)
   - [Carátulas](#carátulas)
   - [Películas](#películas)
   - [Fondos y resúmenes (TMDB)](#fondos-y-resúmenes-tmdb)
   - [Ficha de un anime y capítulos](#ficha-de-un-anime-y-capítulos)
   - [Reproducción: Voe y YourUpload](#reproducción-voe-y-yourupload)
   - [Caché](#caché)
   - [Idioma](#idioma)
6. [Ajustes](#ajustes)
7. [Permisos y hosts](#permisos-y-hosts)
8. [Límites conocidos](#límites-conocidos)
9. [Mantenimiento: qué se rompe y dónde arreglarlo](#mantenimiento-qué-se-rompe-y-dónde-arreglarlo)
10. [Pruebas](#pruebas)
11. [Publicación y versiones](#publicación-y-versiones)
12. [Historial de cambios](#historial-de-cambios)
13. [Créditos y aviso legal](#créditos-y-aviso-legal)

---

## Qué hace

| Función de Kino | Qué hace este plugin |
| --- | --- |
| **Buscar** | Busca en el directorio de TioAnime. Devuelve animes y películas. |
| **Inicio (Home)** | Tres filas: **En emisión**, **Animes** y **Películas**, cada una con "Ver más". |
| **Ver más** | Pagina cada fila por el directorio de TioAnime. |
| **Ficha** | Muestra título, resumen, géneros, fondo y la lista de capítulos. |
| **Reproducir** | Abre el capítulo en Voe o YourUpload. El servidor que no elijas queda en el menú **Servidor** del reproductor. |

Lo que **no** hace: no descarga, no maneja cuentas de TioAnime, no pasa por Chromecast ni DLNA (no están disponibles para plugins en esta versión de Kino) y no guarda nada en la nube.

---

## Instalación

1. En Kino, abre **Ajustes ▸ Plugins**.
2. Escribe la dirección del repositorio: `usuario/tioanime-kino` (o la que corresponda).
3. Kino te mostrará los hosts a los que se conectará y pedirá tu aprobación. Acepta; sin eso el plugin no hace nada.
4. Opcional: en la pestaña del plugin elige el **Servidor preferido** (Voe o YourUpload).

Para actualizar, busca "Buscar actualización" en el mismo lugar.

---

## Cómo se ve en Kino

- **Inicio:** una sección propia "TioAnime" con tres filas (En emisión, Animes, Películas). Cada tarjeta muestra la carátula del anime.
- **Ficha de anime:** fondo del anime, título, año, botón "Reproducir episodio 1", géneros, resumen y la lista de capítulos. Cada capítulo tiene su propia imagen (captura) y una breve descripción cuando TMDB la tiene.
- **Ficha de película:** fondo, resumen y **un solo botón para reproducir**. No hay lista de capítulos porque una película es un solo video.

---

## Estructura del repositorio

```
tioanime-kino/
├── kino-plugin.json   Manifiesto: id, versión, hosts, capacidades, ajustes
├── plugin.js          Todo el código del plugin (un solo módulo)
├── README.md          Guía corta de publicación y pruebas
└── DOCUMENTACION.md   Este documento
```

Kino solo lee `kino-plugin.json` y `plugin.js`. Los demás archivos son para las personas que mantienen el repositorio.

Dentro de `plugin.js` el código está en diez bloques, en este orden:

1. **Constantes y textos**: URL base, User-Agent, mensajes en español e inglés.
2. **Utilidades de texto**: decodificación base64, ROT13, limpieza de búsquedas.
3. **HTTP**: `getPage()`, el único punto que habla con TioAnime.
4. **Lectura de TioAnime**: `cardsFrom()` convierte las tarjetas del HTML en elementos de Kino.
5. **Fondos y resúmenes (TMDB)**: `movieInfo()`, `seriesInfo()`, `enrichItems()`.
6. **Episodios**: `episodes()`, con la numeración y los datos de capítulo.
7. **Servidores**: `listServers()`, `voeStream()`, `yourUploadStream()`.
8. **Reproducción**: `resolve()`.

Además, `search`, `home`, `browse`, `episodes` y `resolve` son las funciones que Kino llama.

---

## Cómo funciona por dentro

### Lectura de TioAnime

TioAnime no tiene API pública, así que el plugin lee las páginas HTML y extrae datos con selectores CSS (`kino.html.select`). Los puntos de entrada son:

| Página | Para qué |
| --- | --- |
| `https://tioanime.com/` | Últimos capítulos publicados (bloque `ul.episodes`), que alimentan **En emisión**. |
| `https://tioanime.com/directorio` | Listado de animes y películas, paginado con `?p=N`. Búsqueda con `?q=`. Filtro de películas con `type[]=1`. |
| `https://tioanime.com/anime/<slug>` | Ficha: título, sinopsis, géneros, año y el arreglo de capítulos. |
| `https://tioanime.com/ver/<slug>-<n>` | Página de un capítulo, con la lista de servidores de video. |

Una tarjeta del directorio trae el enlace `/anime/<slug>`, el título y la carátula. Una tarjeta de capítulo trae `/ver/<slug>-<n>` y una captura del episodio (no la carátula). Por eso el plugin nunca usa la imagen de un capítulo como portada.

### Catálogo: inicio, Ver más y búsqueda

- **Inicio** (`home()`) arma tres filas en paralelo. Si una falla, las demás siguen y el error queda en el registro de Kino.
- **Ver más** (`browse()`) recibe la referencia de la fila (`dir:all`, `type:1`) y la página siguiente. Se detiene cuando el sitio ya no tiene más páginas.
- **Búsqueda** (`search()`) usa el directorio con `?q=`. Antes de buscar limpia el texto: quita símbolos que confunden la URL y exige al menos dos caracteres.

Kino recibe como máximo 50 resultados por búsqueda y 40 elementos por fila; el plugin recorta a esos números.

### En emisión

La fila **En emisión** no usa un filtro del directorio. Toma los últimos capítulos publicados de la página principal (`ul.episodes`) y los reduce a un anime por serie, en el orden en que aparecen. Así la fila muestra animes que tienen capítulos nuevos, como pidió el dueño del proyecto.

Como esos datos vienen de tarjetas de capítulo, la carátula real no está en la tarjeta. Por eso `coverFor()` busca el anime por su título en el directorio y toma la portada de esa tarjeta. El resultado se guarda una semana. Si no hay coincidencia exacta de slug, el anime sale sin carátula en vez de con una imagen equivocada.

### Carátulas

Regla general: **la carátula siempre es la de TioAnime**, nunca una imagen de capítulo ni una imagen de TMDB. TMDB solo aporta fondo y resumen. Las carátulas vienen de:

- el directorio, para Animes y Películas;
- `coverFor()`, para En emisión;
- `og:image` de la ficha, si la fila no tiene carátula propia.

### Películas

Una película se detecta de dos formas:

- en el **inicio** y en **Ver más** de la fila Películas, todo lo que sale es película (`type[]=1` del directorio);
- en la **búsqueda** y en las otras filas, cuando la tarjeta muestra la etiqueta "Película".

Una película se entrega a Kino con `kind: "movie"` y su `ref` apunta directo al capítulo 1 del sitio (`e:<slug>:1`). Así Kino muestra un solo botón "Reproducir" y no una lista de capítulos.

### Fondos y resúmenes (TMDB)

TioAnime ofrece carátula, pero no fondo horizontal ni resumen completo en todas las fichas. Para eso el plugin consulta TMDB con `kino.tmdb`, que es la API de TMDB que Kino ofrece a los plugins sin que el plugin tenga que guardar una llave.

- **Películas** (`movieInfo`): busca en `/search/movie` con el título en español. Si el título trae "Movie 3:" o similar, reintenta sin esa parte. Solo acepta resultados de género animación (id 16) para no confundir con películas reales de mismo nombre.
- **Series** (`seriesInfo`): busca en `/search/tv` con el título sin "Season N", "2nd Season" o "II". Solo acepta coincidencias de animación y de año cercano cuando hay año.
- **Fichas**: el fondo de TMDB reemplaza el de TioAnime; el resumen de TMDB se usa solo si el de TioAnime es corto (menos de 80 caracteres).

Las consultas se limitan a 8 títulos nuevos por carga de una fila, con 4 en paralelo, porque TMDB restringe cuántas llamadas puede hacer un plugin en pocos segundos. Lo que ya se consultó queda en caché, así que la segunda carga completa lo que faltó.

Si TMDB no responde, la función lanza error y **no** se guarda un "sin datos", para que la siguiente carga vuelva a intentarlo. Si TMDB responde pero no encuentra el título, sí se guarda "sin datos" durante un día.

### Ficha de un anime y capítulos

`episodes()` hace lo siguiente:

1. Lee la página `/anime/<slug>`.
2. Obtiene la lista de números de capítulo desde la variable JavaScript `episodes` de la página. Si no existe, toma los enlaces `/ver/<slug>-<n>`.
3. Pide a TMDB la imagen, el título y el resumen de cada capítulo (`tmdbEpisodes`). Para eso reconoce la temporada en el título del anime y, si la numeración de TioAnime es absoluta (el capítulo 50 de una serie que empieza en el 1 de la temporada 1), la convierte sumando los capítulos de las temporadas anteriores.
4. Si TMDB no tiene resumen en español, usa el de inglés.
5. Cada capítulo sale con su título ("Capítulo N" si TioAnime no tiene título real), imagen de TMDB, resumen, fecha de emisión y duración.

Los datos de TMDB por capítulo se guardan seis horas. Si el capítulo no tiene imagen o resumen en TMDB, sale solo con el número.

La temporada siempre es 1 en el plugin. TioAnime no separa temporadas dentro de una misma ficha; cuando una temporada es una serie aparte en TioAnime, aparece como otro anime con su propio slug.

### Reproducción: Voe y YourUpload

Cuando una persona pulsa reproducir, `resolve()` hace:

1. Lee `/ver/<slug>-<n>` y busca la variable `videos` de la página. Tiene una lista con el nombre del servidor y su URL de embed. El plugin se queda solo con **Voe** y **YourUpload**; otros servidores (como Mega o Okru) se ignoran.
2. Ordena los servidores según el ajuste **Servidor preferido**.
3. Intenta abrir el primero:
   - **Voe**: sigue hasta dos redirecciones, busca el bloque JSON ofuscado (`application/json`) y lo decodifica (ROT13, quitar marcas, base64, restar 3 a cada carácter, invertir, base64, JSON). Si no está, prueba el formato anterior (`'hls'` y `'mp4'` en base64) y, como último recurso, busca cualquier `.m3u8` o `.mp4` en el HTML.
   - **YourUpload**: lee `file:`, luego `og:video`, luego `<source>`.
4. Si ese servidor falla, prueba el siguiente.
5. El servidor que sí funcionó es el que Kino reproduce. Los demás quedan como **copias diferidas** en el menú **Servidor** del reproductor: Kino solo los resuelve cuando la persona los elige o cuando el primero falla.

Los encabezados `Referer` y `User-Agent` se envían con cada petición del video, porque Voe y YourUpload los exigen.

### Caché

El plugin usa `kino.storage` (límite de 256 KB por plugin) con estas claves:

| Clave | Contenido | Duración |
| --- | --- | --- |
| `cov1:<slug>` | Carátula encontrada para un anime de En emisión | 7 días |
| `mov1:<slug>` | Fondo, resumen y año de una película (TMDB) | 7 días, o 1 día si no hubo datos |
| `ser1:<slug>` | Fondo y resumen de una serie (TMDB) | 7 días, o 1 día si no hubo datos |
| `tmdb1:<slug>` | Imagen, título y resumen por capítulo (TMDB) | 6 horas |

Si el almacenamiento está lleno o da error, el plugin sigue funcionando sin caché; solo hace más consultas.

### Idioma

El plugin lee `kino.lang`. Los textos de la interfaz (encabezados de filas, mensajes de error y "Capítulo N") salen en español o en inglés. TioAnime y TMDB se consultan en español (`es-MX`), con respaldo en inglés (`en-US`) para resúmenes de capítulos que no tienen traducción.

---

## Ajustes

| Ajuste | Tipo | Valor por defecto | Qué hace |
| --- | --- | --- | --- |
| **Servidor preferido** | Lista | Voe | Servidor que se reproduce primero. El otro queda en el menú Servidor. |

El plugin no pide cuenta ni llave de API. La llave de TMDB la pone Kino, o la persona en Ajustes de Kino si Kino no tiene una propia.

---

## Permisos y hosts

El manifiesto declara:

- `tioanime.com` y `*.tioanime.com`: el sitio de catálogo.
- `fetchHosts: "any"` y `streamHosts: "any"`: Voe y YourUpload cambian de dominio y de servidor de video con frecuencia, así que no se pueden listar uno por uno.

Por eso Kino muestra al instalar que el plugin puede conectarse a cualquier host público. Eso es consecuencia directa de cómo funcionan esos servidores, no de algo que el plugin necesite para otra cosa. El plugin no envía datos personales a ningún lado: solo hace peticiones de lectura y pide el video.

TMDB no necesita entrada en `hosts`, porque se consulta a través de `kino.tmdb`.

---

## Límites conocidos

- **Sin temporadas separadas dentro de una ficha.** Cada temporada que TioAnime trata como serie aparte se muestra como otro anime.
- **Numeración absoluta sin confirmar.** Cuando TioAnime numera de forma absoluta, la conversión a temporadas de TMDB depende del orden de las temporadas. Puede fallar en series con temporadas especiales o con huecos.
- **En emisión por título.** La carátula de En emisión se busca por título. Dos animes con títulos casi iguales pueden confundirse; el plugin exige coincidencia de slug, así que en ese caso sale sin carátula.
- **TMDB limitado.** Las consultas a TMDB se reparten entre cargas; el primer inicio puede mostrar algunos títulos sin fondo o resumen.
- **Películas sin etiqueta.** En la búsqueda, una película que no tenga la etiqueta "Película" en TioAnime sale como serie.
- **Sin descargas, Chromecast ni DLNA.** Limitación de Kino para plugins en esta versión.
- **Dependencia de HTML.** El plugin funciona mientras TioAnime conserve su estructura de páginas. Un cambio de diseño puede vaciar filas o capítulos sin dar error visible.

---

## Mantenimiento: qué se rompe y dónde arreglarlo

| Síntoma | Causa probable | Dónde mirar |
| --- | --- | --- |
| Filas vacías en el inicio | TioAnime cambió las tarjetas o los enlaces | `cardsFrom()` (selectores `article`, `li`, `a[href]`, `h3`) |
| "En emisión" vacía | Cambió el bloque de últimos capítulos de la página principal | `airingItems()` y el selector `ul.episodes` |
| Capítulos no aparecen | Cambió la variable `episodes` o los enlaces `/ver/` | `episodes()` |
| Capítulos sin imagen ni resumen | TMDB no encontró la serie, o la numeración no coincide | `tmdbEpisodes()`, `splitTitle()`, `pickShow()` |
| Películas salen como serie | La tarjeta cambió la etiqueta "Película" | `cardsFrom()` (regex de la etiqueta) |
| Reproducción falla en ambos servidores | Voe o YourUpload cambiaron su código | `voeExtract()`, `decodeVoe()`, `yourUploadStream()` |
| Reproducción falla solo en Voe | Voe cambió la ofuscación del JSON | `decodeVoe()` (lista de marcas y desplazamiento) |
| "Servidor preferido" no tiene efecto | Cambió el nombre del servidor en `var videos` | `listServers()` |

Para depurar, activa **Modo debug** en la pestaña del plugin dentro de Kino: los errores aparecen en pantalla y el registro muestra qué URL falló.

Cuando algo cambie en TioAnime, lo más rápido es abrir la página en el navegador, ver qué selector ya no existe y ajustar solo esa función. Las funciones están separadas a propósito para que cada cambio toque poco código.

---

## Pruebas

El repositorio se prueba con el kit de Kino (Node 18 o más nuevo, sin instalar paquetes):

```
node sdk/validate.mjs .
node sdk/run.mjs . home
node sdk/run.mjs . search "one piece"
node sdk/run.mjs . episodes a:one-piece-tv
node sdk/run.mjs . resolve e:one-piece-tv:1
```

El kit no ejecuta `kino.html.select` ni `kino.tmdb`, así que `search`, `home` y `episodes` solo se prueban completos instalando el plugin en Kino.

Además, durante el desarrollo se comprobó sin red:

- el decodificador de Voe (ida y vuelta con un codificador de prueba);
- la lectura de la lista de servidores y la separación de temporadas;
- el manejo de caché de TMDB y el reparto de consultas por carga.

Antes de publicar una versión, prueba en la app: inicio, Ver más, búsqueda, una película, una serie con varias temporadas y la reproducción en los dos servidores.

---

## Publicación y versiones

- La versión está en `kino-plugin.json` (`version`). Cada cambio que llegue a las personas debe subir el número: Kino no actualiza si la versión no cambia.
- Cambios en `hosts` requieren que la persona apruebe la actualización en Kino.
- El `id` (`tioanime`) no debe cambiar: quien lo instaló lo perdería.

---

## Historial de cambios

| Versión | Cambios |
| --- | --- |
| 1.0.0 | Primera versión: búsqueda, inicio con "Últimos episodios", Animes, Películas y OVAs; capítulos; reproducción con Voe y YourUpload. |
| 1.1.0 | "Últimos episodios" pasa a **En emisión**; se quitan las OVAs; las carátulas dejan de venir de las capturas de capítulo; capítulos con imagen y resumen desde TMDB. |
| 1.2.0 | En emisión toma los animes de los últimos capítulos con su carátula real; las películas se muestran como película (un solo botón para reproducir). |
| 1.3.0 | Fondo y resumen de TMDB también en En emisión, Animes, búsqueda y fichas de anime. |

---

## Créditos y aviso legal

- **TioAnime** es el sitio que ofrece el catálogo y los enlaces; los capítulos están en sus servidores externos.
- **Voe** y **YourUpload** alojan los videos. Los derechos de cada anime pertenecen a sus autores y distribuidores.
- **TMDB** aporta fondos, resúmenes e imágenes de capítulos. Este plugin no está respaldado por TMDB.
- **Kino** y su API de plugins son de sus autores (kinotvapp).

Este plugin es un intermediario: no aloja videos ni guarda copias. Úsalo solo para contenido al que tengas derecho según tu país. El autor no se responsabiliza por el uso que se haga de él.
