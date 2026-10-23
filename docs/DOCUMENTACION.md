# Crecida · Santa Fe — Documentación técnica

Aplicación web para consultar el nivel del río Paraná en Santa Fe, simular crecidas y ver el avance del agua sobre el terreno y sobre los edificios en 3D.

[← Volver al README](../README.md)

> **Corte de esta documentación:** 23/10/2026.
> **Datos de edificios:** Overture Maps release `2026-10-21.0` y relevamiento municipal con imagen de 03/2022.
> **Terraplenes:** Municipalidad de Santa Fe, levantamiento de cotas del 10/02/2020 (12 sectores, 313 puntos).
> **Serie histórica:** INA–SIyAH, actualizada al 01/09/2026.
> **Advertencia:** es una estimación geométrica, no un pronóstico ni un estudio hidráulico oficial.

---

## Índice

1. [Qué hace la aplicación](#1-qué-hace-la-aplicación)
2. [Arquitectura](#2-arquitectura)
3. [Fuentes de datos](#3-fuentes-de-datos)
4. [Flujo de datos y estados](#4-flujo-de-datos-y-estados)
5. [DEM y cálculo de inundación](#5-dem-y-cálculo-de-inundación)
6. [Edificios 3D: alturas y cotas](#6-edificios-3d-alturas-y-cotas)
7. [Tiles, conteos y rendimiento](#7-tiles-conteos-y-rendimiento)
8. [Interfaz y comportamiento](#8-interfaz-y-comportamiento)
9. [Endpoints y parámetros](#9-endpoints-y-parámetros)
10. [Estructura de archivos](#10-estructura-de-archivos)
11. [Cómo ejecutar](#11-cómo-ejecutar)
12. [Limitaciones y advertencias](#12-limitaciones-y-advertencias)
13. [Créditos y licencias](#13-créditos-y-licencias)
14. [Anexo: cifras de referencia](#14-anexo-cifras-de-referencia)

---

## 1. Qué hace la aplicación

La app combina cuatro cosas:

1. **Nivel del río en vivo:** consulta la serie 30 del INA (hidrómetro Puerto Santa Fe) y muestra el último valor, la variación diaria y la serie de los últimos 120 días.
2. **Simulación de crecida:** un slider entre 3,00 m y 8,00 m permite elegir un nivel y calcular qué celdas del terreno quedarían bajo el agua.
3. **Mapa 2D/3D:** muestra el polígono de agua, la hidrografía permanente, distritos y vecinales, un modelo de elevación con exageración, y edificios extruidos. Hay capas opcionales de **zona de seguridad hídrica** y **terraplenes** (apagadas por defecto).
4. **Edificios afectados:** los edificios se pintan en rojo cuando la **máscara de inundación** (ya con los terraplenes como barrera) los alcanza. La leyenda muestra cuántos son sobre el total de edificios incluidos en el modelo 3D.

También incluye:

- gauge con umbrales de aguas bajas, alerta y evacuación;
- gráfico de la serie reciente;
- gráfico de máximas anuales 1925–2026;
- tarjeta del **río Salado** (estación Recreo): nivel en vivo, estado, serie de 120 días y máximas anuales 2001–2026;
- botones rápidos para alerta, evacuación y récord histórico;
- calibración manual de la cota del cero del hidrómetro;
- capas de distritos y vecinales;
- capas de zona de seguridad hídrica y terraplenes (apagadas por defecto);
- popups de zonas, terraplenes y de edificios.

No hay backend ni base de datos en línea para la app: es una SPA estática que consume APIs públicas y archivos estáticos.

---

## 2. Arquitectura

### Stack

| Componente | Tecnología |
|---|---|
| Framework | React 19 |
| Bundler | Vite 7 |
| Mapa | MapLibre GL JS 5.6 |
| Contornos de agua | `d3-contour` 4 |
| Estilos | CSS propio |
| Datos estáticos | GeoJSON, PNG DEM, PBF vector tiles, binario de alcanze |
| Datos dinámicos | INA, WFS municipal, tiles externos |

### Flujo general

```text
INA ───────────────┐
WFS municipales ───┤
DEM terrarium ─────┼──> React (App.jsx) ──> MapLibre (Mapa.jsx)
Tiles PBF ─────────┤         │
Alcanze binario ────┘         └──> estado, cálculo de inundación, leyenda
```

### Componentes principales

| Archivo | Rol |
|---|---|
| `src/App.jsx` | Estado global, carga de INA, DEM, zonas, simulación, gauge, gráficos y leyenda |
| `src/components/Mapa.jsx` | Mapa MapLibre, capas, edificios, agua, popups, marcador, 2D/3D |
| `src/components/SerieChart.jsx` | Gráfico de los últimos 120 días |
| `src/components/AnualesChart.jsx` | Gráfico de máximas anuales |
| `src/config/santaFe.js` | Configuración geográfica, umbrales, semillas, capas y fuentes |
| `src/lib/dem.js` | Descarga y procesamiento del DEM |
| `src/lib/flood.js` | BFS, contorno, simplificación y área inundada |
| `src/lib/ina.js` | Cliente de la API del INA |
| `src/lib/zonas.js` | Cliente WFS de distritos, vecinales y zona de seguridad hídrica |
| `src/lib/terraplenes.js` | Rasteriza los alineamientos de terraplenes como barrera del BFS |
| `src/lib/publicUrl.js` | URLs relativas para funcionar en subdirectorios |
| `src/lib/geo.js` | Conversiones Web Mercator / tile / píxel |
| `src/lib/format.js` | Formateo de números y fechas en es-AR |
| `src/data/historia-santa-fe.json` | Máximas anuales históricas del Paraná |
| `src/data/historia-salado.json` | Máximas anuales del río Salado (2001–2026) |
| `public/tiles/` | Vector tiles de edificios z13–z15 |
| `public/data/edificios-alcance.bin` | Cota de alcanze ordenada para conteo rápido |
| `scripts/` | Regeneración de terraplenes e historia del Salado |

---

## 3. Fuentes de datos

### 3.1. Nivel del río: INA–SIyAH

| Dato | Valor |
|---|---|
| Organismo | Instituto Nacional del Agua (INA) |
| Sistema | SIyAH |
| Serie | 30 |
| Estación | Santa Fe / Puerto Santa Fe |
| Propietario | Prefectura Naval Argentina (PNA) |
| Variable | Altura hidrométrica, medición directa |
| Unidad | metros sobre el cero del hidrómetro |
| Cero IGN | 8,378 m |
| Alerta | 5,3 m |
| Evacuación | 5,7 m |
| Aguas bajas | 2,0 m |

La app consulta:

- metadatos de la estación: `https://alerta.ina.gob.ar/a5/obs/puntual/series/30`;
- observaciones de los últimos 120 días: `https://alerta.ina.gob.ar/a5/obs/puntual/observaciones?series_id=30&timestart=...&timeend=...&format=json`.

Cada **10 minutos** se repite la consulta. El último valor se usa como “nivel en vivo”. Los umbrales se toman de los metadatos de INA (`nivel_alerta`, `nivel_evacuacion`, `nivel_aguas_bajas`) y, si faltan, de `src/config/santaFe.js`.

La serie que devuelve INA es diaria para esta estación. El gráfico “Nivel reciente” muestra los últimos 120 días.

### 3.2. Nivel del río Salado: estación Recreo

| Dato | Valor |
|---|---|
| Río / estación | Río Salado — “Recreo - Ruta Provincial nº 70” |
| Serie / unid | 103 |
| Posición | `[-60.78055556, -31.49122222]` |
| Cero IGN | 11,09 m |
| Alerta | 4,7 m |
| Evacuación / aguas bajas | no publicadas (0 en WFS y `null` en a5 ⇒ se ignoran) |
| Fuentes | API a5 serie 103 (serie larga) + WFS `public2:ultimas_alturas_con_timeseries` (valor actual y 14 días) |

Se piden en paralelo y se combinan (ver §9.5): el valor mostrado sale del WFS, que está más actualizado que a5; la serie de 120 días se arma mezclando las dos fuentes. Refresco cada 10 minutos. La tarjeta **no modula la simulación** del Paraná: es otra cuenca con otro cero.

### 3.3. Serie histórica

Archivo local: `src/data/historia-santa-fe.json`.

Fue generado a partir de la serie completa del INA:

```text
https://alerta.ina.gob.ar/a5/obs/puntual/series/30/observaciones
  ?timestart=1900-01-01&timeend=2100-01-01
```

Contenido:

| Campo | Significado |
|---|---|
| `desde` / `hasta` | 1925-01-02 a 2026-09-01 |
| `dias` | 36.922 observaciones diarias |
| `anios` | 102 registros anuales |
| `incompletos` | 2026 (año parcial al corte) |
| `anios[i]` | `[año, máximo, fecha_máximo, mínimo, fecha_mínimo, días, días_alerta, días_evacuación]` |

El máximo histórico registrado es **7,43 m el 22/06/1992**. Los seis máximos anuales principales son:

| Año | Máximo | Fecha |
|---|---:|---|
| 1992 | 7,43 m | 22/06/1992 |
| 1983 | 7,35 m | 05/07/1983 |
| 1998 | 7,26 m | 02/05/1998 |
| 1982 | 6,95 m | 28/12/1982 |
| 1966 | 6,94 m | 17/03/1966 |
| 2016 | 6,61 m | 05/01/2016 |

El archivo se importa en el bundle; no se consulta en tiempo de ejecución.

### 3.4. Edificios municipales

Fuente: Geoservicios de la Municipalidad de Santa Fe.

- Servicio: WFS 1.1.0.
- Capa: `publico:3dprueba`.
- Registros descargados: **26.241**.
- Campos usados: `id`, `the_geom`, `altura_min`, `altura_max`, `nivel`, `fecha_imagen`.
- Sistema de referencia: EPSG:4326.
- Imagen del relevamiento: 03/2022.

La capa municipal cubre el **este** de la ciudad, desde el meridiano de corte -60,642 hacia el este. Se descargó paginando de a 2.000 features, ordenando por `id`, porque el WFS 1.1.0 requiere `sortBy` y `startIndex` para paginar de forma estable.

El campo `nivel` del WFS es un nivel municipal de referencia (por ejemplo “Nivel 44”), **no** el nivel del río. El campo `fecha_imagen` indica la fecha de la imagen del relevamiento.

Alturas municipales:

| `altura_max` | Cantidad en el relevamiento | Uso |
|---:|---:|---|
| 2,5 m | 24.202 | altura de la construcción |
| 5,0 m | 2.030 | altura de la construcción |
| 7,5 m | 9 | altura de la construcción |

Se usa `altura_max`. `altura_min` no se usa para el modelo 3D.

### 3.5. Edificios de Overture Maps

Fuente: Overture Maps Foundation, release **`2026-10-21.0`**.

```text
s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*.parquet
```

Se descargaron **222.159** edificios del oeste de la ciudad con DuckDB + extensión `spatial` + `httpfs`, en la región `us-west-2`.

Filtros de la descarga:

- `bbox.xmin < -60.642`: recorta el oeste y evita superponerse con el relevamiento municipal del este;
- límites generales del área de la ciudad;
- `ST_Intersects` con la unión de distritos municipales, para descartar edificios fuera del ejido.

Campos usados:

| Campo | Uso |
|---|---|
| `geometry` | huella real del edificio |
| `height` | altura declarada en metros, si existe |
| `num_floors` | cantidad de pisos, si existe |
| `is_underground` | no se usa; en este recorte todas eran `false` |

Las huellas de Overture son geometrías reales, no bounding boxes. En el recorte:

- mediana de **5 puntos** por huella;
- percentil 90 de **7 puntos**;
- máximo de **90 puntos**.

Muchas son rectángulos simples, pero representan la forma real del edificio.

### 3.6. Distritos, vecinales y zona de seguridad hídrica

Fuente: WFS municipal.

| Capa | Features | Uso |
|---|---:|---|
| `publico:distrito` | 8 | relleno, borde, etiqueta y popup |
| `publico:vecinal` | 87 | relleno, borde, etiqueta y popup |

Se consultan al iniciar la app con WFS 2.0.0, `outputFormat=application/json`, `srsName=EPSG:4326` y `count=1000`.

La **zona de seguridad hídrica** se pide por el mismo WFS (`publico:zona_seguridad_hidrica`, 19 polígonos, DefaultSRS `EPSG:22185`, reproyectados a `EPSG:4326`). Se carga en paralelo y en forma independiente: si falla, distritos y vecinales siguen disponibles.

Las etiquetas se calculan en el cliente: se toma el anillo principal de cada polígono (el de mayor área) y se calcula su centroide con la fórmula del área firmada. El popup usa `nombre` y `numero`.

### 3.7. DEM y mapas de base

| Dato | Fuente |
|---|---|
| Relieve / terreno | Mapzen Terrain Tiles en AWS Open Data, formato terrarium |
| Imágenes satelitales | EOX `s2cloudless-2025`, Sentinel-2 |
| Calles | OpenFreeMap, estilo Positron |
| Relieve 3D | El mismo DEM terrarium, como `raster-dem` de MapLibre |

URLs:

```text
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg
https://tiles.openfreemap.org/styles/positron
```

### 3.8. Hidrografía permanente

La app incluye una capa de agua permanente independiente del DEM y del nivel del río. Se usa para que el Paraná, la Laguna Setúbal y el Río Coronda se vean aunque el área esté fuera del modelo de inundación o el DEM no represente bien el espejo de agua.

| Dato | Valor |
|---|---|
| Fuente | Overture Maps, `theme=base`, `type=water`, release `2026-10-21.0` |
| Archivo | `public/data/agua-permanente.geojson` |
| Cobertura | `[-61.10, -32.30, -60.30, -31.30]` |
| Features | 810 (1 polígono disuelto + 809 líneas) |
| Tamaño | ~1,2 MB |
| Simplificación | `ST_Union_Agg` y luego `ST_SimplifyPreserveTopology` a 0,00012° |
| Clases incluidas | `river`, `lake`, `lagoon`, `reservoir`, `water`, `canal`, `pond`, `basin`, `tidal_channel` |

Los polígonos se disuelven con `ST_Union_Agg` antes de simplificar para eliminar las costuras internas entre teselas. La capa se dibuja debajo de la inundación simulada. No implica que el agua esté cubriendo esa superficie: es una referencia visual de hidrografía. El modelo de crecida sigue dependiendo del DEM y del BFS.

### 3.9. Terraplenes

Fuente: levantamiento municipal de cotas (10/02/2020), entregado como shapefile.

- Crudos en `fuentes/terraplenes/10022020_Cotas_Terraplenes.{shp,dbf}` (no se publican: Vite solo empaqueta `public/`).
- `scripts/terraplenes_geojson.py` los convierte a `public/data/terraplenes.geojson` (`EPSG:22185 → EPSG:4326` con `gdaltransform`).
- Son **313 puntos PointZ** con `Elevation` (0–24,4 m) agrupados en 12 sectores y **desordenados** dentro de cada sector: el script reconstruye el alineamiento con cadena de vecino más cercano (4 candidatos a extremo, se elige la cadena con el salto máximo menor; salto mediano ≈ 230 m).
- Salida: 12 `LineString` con `properties.z` (cota por vértice; `0` = sin dato) y `cota_min` / `cota_max` / `cota_med` por sector.

| Sector | Pts | Cotas (m) |
|---|---:|---|
| Circunvalación Oeste | 65 | 15,76–24,40 |
| Alto Verde (9-10-11) | 56 | 12,28–18,46 |
| Zona portuaria | 37 | 15,93–16,86 |
| Costanera Oeste | 33 | 16,10–17,94 |
| Avenida Mar Argentino | 20 | 15,90–20,62 |
| Terraplén French | 18 | 16,48–17,14 |
| El Pozo | 18 | 16,70–19,92 |
| Colastine Sur | 17 | 15,27–17,92 |
| Ceride | 15 | 16,69–17,73 |
| Varadero Sarsotti | 12 | 15,41–17,05 |
| Bajada Distefano | 11 | 16,83–17,99 |
| La Guardia | 11 | 17,32–17,83 |

La misma geometría alimenta la **barrera del BFS** (§5.4) y la **capa visual** del mapa (§8.3).

### 3.10. Fuentes oficiales enlazadas

La app enlaza, sin consumirlas directamente:

- INA–SIyAH: `https://alerta.ina.gob.ar/a5`
- Prefectura Naval Argentina: `https://contenidosweb.prefecturanaval.gob.ar/alturas/`
- Municipalidad de Santa Fe: `https://geoservicios.santafeciudad.gov.ar`

La Prefectura es la fuente primaria de la serie de alturas, pero la app usa la API del INA porque es la que provee los datos en un formato accesible desde el navegador.

---

## 4. Flujo de datos y estados

### 4.1. Al iniciar

1. Se lee `?vista=3d` o `?vista=2d` de la URL. Sin parámetro, arranca en 2D.
2. Se crea el mapa MapLibre.
3. Se consultan en paralelo:
   - metadatos y serie de 120 días del INA;
   - estación Recreo: WFS del Salado (14 días) y serie larga a5 (120 días);
   - distritos, vecinales y zona de seguridad hídrica;
   - DEM;
   - binario de alcanze de edificios;
   - geojson de terraplenes.
4. Cuando llega la serie, se toma el último valor como nivel en vivo.
5. Si el usuario no tocó el slider, la simulación se inicializa con ese valor.
6. Cuando el DEM está listo, se rasterizan los terraplenes como barrera.
7. Cuando el DEM, las barreras y un nivel están listos, se calcula el polígono de inundación.
8. Cuando el mapa está listo y hay nivel, se actualiza el color de los edificios.

Si INA falla, el mapa y el simulador siguen funcionando con el nivel inicial de 3,85 m y se muestra un mensaje de error. Si falla la consulta del Salado se intenta la otra fuente (WFS o a5) y, en última instancia, se muestra el error en la tarjeta.

### 4.2. Estado de simulación

- `sim`: nivel elegido en el slider.
- `tocado`: indica si el usuario movió el slider o usó un botón.
- `live`: último valor del INA.
- `mostrado = sim ?? live ?? 3,85`.

Mientras `tocado` sea falso, cada actualización del INA actualiza la simulación. Cuando el usuario toca el slider, `tocado` pasa a verdadero y las actualizaciones del INA ya no pisan el valor elegido. “Volver a en vivo” limpia `tocado` y restaura el último valor del INA.

### 4.3. Cálculo y actualización

- El DEM se carga una vez.
- El polígono de agua se recalcula cuando cambian `dem`, `sim`, `cero` o las `barreras` de terraplenes.
- Hay un debounce de 90 ms para no recalcular en cada evento del slider.
- El color y el conteo de edificios se actualizan en cada cambio de nivel, sin recalcular el DEM.
- La serie del INA y la estación Recreo se actualizan cada 10 minutos.
- Los tiles y el binario de alcanze son estáticos; no se piden a un backend.

### 4.4. URL

La app mantiene:

```text
?vista=2d|3d&localidad=santa-fe
```

Se usa `history.replaceState`, sin recargar.

---

## 5. DEM y cálculo de inundación

### 5.1. Carga del DEM

Archivo: `src/lib/dem.js`.

Parámetros de `src/config/santaFe.js`:

| Parámetro | Valor |
|---|---|
| Bounding box | `[-60,79, -31,735, -60,50, -31,55]` |
| Zoom | 13 |
| Decimación | 2 |
| Tolerancia de simplificación | 0,00009° |

Proceso:

1. Se calculan los tiles z13 que cubren la bbox: **48 tiles** (8 columnas × 6 filas).
2. Se descargan en paralelo y se pegan en un canvas de 2.048 × 1.536 px.
3. Se recorta la bbox exacta.
4. Se decodifica terrarium:

   ```text
   altura = R * 256 + G + B / 256 - 32768
   ```

5. Se agrupa cada bloque de 2 × 2 px y se toma la **mediana**.
6. Se aplica un filtro de **mediana 3 × 3** sobre la grilla resultante.

Resultado:

| Dato | Valor |
|---|---|
| Grilla | **844 × 633** celdas |
| Celdas | 534.252 |
| Resolución aproximada | **32,5 m/píxel** en la latitud de Santa Fe |
| Extensión aproximada | 27,5 km × 20,6 km |

La mediana se usa para evitar que el suavizado de baja resolución mezcle el río con la barranca. El filtro 3 × 3 elimina píxeles aislados.

### 5.2. Consulta de altura

`dem.alturaEn(lon, lat)` hace una interpolación **bilineal** sobre las cuatro celdas vecinas, con clamp en los bordes.

También existen:

- `lonLatToGrid(lon, lat)`: pasa de coordenadas a celda de la grilla;
- `gridToLngLat(x, y)`: pasa de celda a coordenadas;
- `metersPerPixel(lat)`: resolución en metros a una latitud dada.

### 5.3. Nivel del agua

El INA mide sobre el cero del hidrómetro. Para comparar con el DEM:

```text
elevación del agua = nivel del hidrómetro + cota del cero
```

Por defecto:

```text
elevación = nivel + 8,378 m
```

Ejemplos:

| Nivel INA | Elevación del agua |
|---:|---:|
| 3,85 m | 12,228 m |
| 5,30 m | 13,678 m |
| 5,70 m | 14,078 m |
| 7,43 m (récord) | 15,808 m |
| 8,00 m (máximo del slider) | 16,378 m |

El valor `cero` se puede ajustar en la interfaz para calibrar el desfase entre el DEM y la cota IGN.

### 5.4. Algoritmo de inundación

Archivo: `src/lib/flood.js`.

1. Se parte de cinco **semillas** sobre el río Paraná:

   ```text
   [-60.682, -31.640]
   [-60.678, -31.660]
   [-60.678, -31.620]
   [-60.545, -31.630]
   [-60.525, -31.700]
   ```

2. Cada semilla se convierte a celda y se activa si su altura efectiva ≤ elevación del agua y no es muro.
3. Si ninguna semilla queda mojada, se usa como semilla la celda más baja de toda la grilla que no sea muro.

Esta regla hace que la máscara sea exactamente el conjunto de celdas con `distancia_minimax ≤ elevación`, que es la misma condición que usa el rojo de los edificios (§6.5).
4. Se hace un **BFS de 4 vecinos** (arriba, abajo, izquierda, derecha) desde las semillas.
5. Antes del BFS se rasteriza la **barrera de terraplenes** (`src/lib/terraplenes.js`, un raster por grilla, ~2.400 celdas con cota):

   - cada alineamiento se muestrea cada 0,34 celda y las celdas se encadenan con camino 4-conectado (sin escaleras diagonales por las que el BFS se escaparía);
   - cada celda de terraplén toma `altura_efectiva = max(altura_DEM, cota_terraplén)` (la cota levantada manda cuando el DEM de 30 m promedia la cresta);
   - los tramos sin cota (los5 puntos con `Elevation = 0`) quedan como **muro absoluto**: no se inundan nunca;
   - si una celda tiene cota y muro, manda la cota (puede ser sobrepasada).

6. Una celda se inunda si:

   ```text
   altura_efectiva(celda) <= elevación_del_agua
   ```

   no es muro absoluto, y además es alcanzable desde el río.

7. Se genera un campo binario `1` para celdas inundadas y `0` para el resto.
8. Se extraen los contornos con `d3-contour` en el umbral 0,5.
9. Cada anillo se convierte de coordenadas de grilla a longitud/latitud.
10. Se simplifica con Ramer–Douglas–Peucker con tolerancia de 0,00009° (unos 10 m en latitud y 8,5 m en longitud).
11. Se calcula el área sumando, por fila, la cantidad de celdas mojadas por el área de celda correspondiente a esa latitud:

    ```text
    área = Σ (celdas_mojadas_fila × mpp(lat)²)
    ```

El resultado incluye:

```js
{
  geojson,       // FeatureCollection de polígonos
  mask,          // Uint8Array de celdas
  areaKm2,       // área calculada
  floodedCells,  // cantidad de celdas
  waterLevel     // elevación usada
}
```

### 5.5. Visualización del agua

Hay dos capas de agua:

1. **Hidrografía permanente** (`agua-base`): se carga desde `public/data/agua-permanente.geojson` y se dibuja primero, debajo de distritos, vecinales y de la inundación.
   - relleno `#1b6f95` con opacidad 0,55;
   - borde `rgba(125,211,252,0.45)`;
   - líneas `#7dd3fc` de 0,8 px para ríos y arroyos.
2. **Inundación simulada** (`agua`): es el GeoJSON que sale del BFS y `d3-contour`.
   - relleno `#2b9fe0` con opacidad 0,5;
   - borde `#9fe0ff` de 1 px;
   - se dibuja sobre el terreno con `fill` normal, por lo que **sigue la topografía** y no forma una superficie plana horizontal.

Las capas de edificios se dibujan por encima de ambas. La hidrografía permanente no se recalcula cuando cambia el nivel: solo la capa `agua` responde al slider.

### 5.6. Áreas de referencia

Valores calculados con este DEM, este algoritmo **y los terraplenes como barrera**:

| Nivel INA | Elevación | Área estimada |
|---:|---:|---:|
| 3,85 m | 12,228 m | ≈ 96,6 km² |
| 5,30 m | 13,678 m | ≈ 249,5 km² |
| 5,70 m | 14,078 m | ≈ 310,1 km² |
| 7,43 m | 15,808 m | ≈ 364,4 km² |

Con los terraplenes el área baja entre 4 y 9 km² respecto al modelo sin barreras a partir de la alerta; a nivel normal la diferencia es mínima porque el propio DEM ya muestra la mayoría de las crestes. A nivel mínimo del slider (3,00 m; elevación 11,378 m) el área cae a ≈ 32 km²: solo queda mojado lo conectado al río. Los espejos permanentes (Ensenada, lagunas) los dibuja la capa de hidrografía, no la de inundación.

Son áreas del **modelo**, no superficies oficiales de emergencia.

---

## 6. Edificios 3D: alturas y cotas

### 6.1. Composición del dataset final

| Origen | Features |
|---|---:|
| Overture Maps, huellas reales | 54.353 |
| Municipalidad de Santa Fe | 21.455 |
| **Total incluido en 3D** | **75.808** |

El dataset original completo tenía **248.197** edificios:

- 221.956 bounding boxes de Overture;
- 26.241 polígonos municipales.

Se descartaron los bounding boxes de Overture y se reemplazaron por las huellas reales. Luego se aplicó el filtro de cota que se explica más abajo.

Composición final por marca `e`:

| `e` | Significado | Cantidad |
|---|---|---:|
| 0 | altura conocida o derivada | 21.484 |
| 1 | altura estimada por defecto (3 m) | 54.324 |

Dentro de `e = 0`:

- 21.455 son municipales;
- 29 son Overture con `height` o `num_floors`.

### 6.2. De dónde sale la altura

La altura se guarda en el campo `a` de cada feature.

| Fuente | Regla | `e` | Cantidad final |
|---|---|---|---:|
| Municipal | `a = altura_max` | 0 | 21.455 |
| Overture | `a = height` si existe | 0 | dentro de los 29 |
| Overture | si no, `a = num_floors × 3,0` | 0 | dentro de los 29 |
| Overture | si no hay ninguno, `a = 3,0` | 1 | 54.324 |

Detalles:

- Municipal: `altura_max` es una altura declarada en el relevamiento, no una medición LiDAR. Se usa como altura de la construcción.
- Overture `height`: altura en metros, cuando el dato existe.
- Overture `num_floors`: se multiplica por **3,0 m por piso**. Es una convención, no la altura real de cada piso.
- Sin altura ni pisos: se usa **3,0 m** y se marca `e = 1`.
- En el popup, `e = 1` se muestra como “Altura estimada”.

Distribución municipal conservada:

| `altura_max` | Cantidad |
|---:|---:|
| 2,5 m | 19.744 |
| 5,0 m | 1.703 |
| 7,5 m | 8 |

Las alturas se usan **solo para el volumen 3D**. No intervienen en el cálculo de inundación ni en el conteo de edificios afectados.

### 6.3. Cómo se calcula la cota del edificio

La cota es la elevación del terreno alrededor de la huella, no la altura del edificio ni la cota del piso interior.

Para cada edificio:

1. Se toma el anillo exterior. Si es un `MultiPolygon`, se usa el polígono de mayor área.
2. Se calcula su bounding box.
3. Se generan **9 puntos de muestra**:
   - 4 esquinas desplazadas 35 % hacia afuera;
   - 4 puntos medios de los bordes, también desplazados;
   - el centro.
4. Para huellas muy pequeñas se impone un semi-ancho mínimo de `0,00022°` en longitud y `0,0002°` en latitud, para que las muestras no caigan todas dentro del mismo píxel.
5. Se consulta el DEM en cada punto con interpolación bilineal.
6. Se ordenan las alturas y se aplica una regla de robustez:

   ```text
   bajo = promedio de las 3 alturas más bajas
   si la 4.ª altura - bajo > 5 m:
       cota = 4.ª altura        // descarta muestras bajas anómalas (agua, sombra)
   si no:
       cota = 2.ª altura        // valor conservador, evita el mínimo aislado
   ```

7. La cota se redondea a 2 decimales.

La misma función se usa para Overture y para el municipio.

Limitaciones de esta cota:

- El DEM es un modelo de superficie de ~30 m; puede incluir techos, árboles o terraplenes.
- La muestra es alrededor de la huella, no el punto de acceso o la planta baja.
- En manzanas densas, varias muestras pueden caer sobre techos vecinos.
- La cota no reemplaza un relevamiento altimétrico de precisión.

### 6.4. Filtro cota ≤ 18 m

El máximo del simulador es 8,00 m. Con el cero oficial:

```text
8,00 + 8,378 = 16,378 m
```

Se agregó un margen de **1,622 m** para absorber errores del DEM y de la cota:

```text
cota máxima incluida = 18,00 m
```

Resultado:

- 248.197 → **75.808** edificios;
- reducción del **69,5 %**;
- no se excluye ningún edificio que pueda afectarse con el máximo del simulador;
- los edificios por encima de 18 m no se muestran en 3D.

El filtro es de **visualización/rendimiento**, no un filtro del modelo de inundación. El polígono de agua se sigue calculando sobre toda la grilla DEM.

Cotas del dataset final:

| Estadístico | Valor |
|---|---:|
| Mínima | 8,44 m |
| Percentil 25 | 15,04 m |
| Mediana | 16,28 m |
| Percentil 75 | 17,38 m |
| Máxima | 18,00 m |

### 6.5. Color y conteo

El color no usa la cota del terreno sino la **cota de alcanze** (`alc`): la elevación mínima del agua a la que la máscara (BFS + terraplenes) alcanza ese edificio. Se hornea offline con `scripts/alcance_edificios.py`, que:

1. rasteriza los terraplenes igual que el navegador (misma paridad: 2.397 celdas con cota);
2. corre un **Dijkstra minimax** desde las semillas: `dist[celda] = max(altura_efectiva, dist[vecino])`, con muros sin cota excluidos (validado contra `computeFlood`: **0 discrepancias** en 3,00 / 3,85 / 5,30 / 5,70 / 7,43 m);
3. por edificio toma el **mínimo de `dist` sobre los mismos 9 puntos de muestreo** de la cota (si el agua toca un borde, el edificio queda alcanzado) y redondea a 2 decimales.

En `Mapa.jsx`, la expresión de color es:

```js
[
  'case',
  ['<=', ['coalesce', ['get', 'alc'], 999], nivel],
  '#dc2626', // alcanzado
  '#d5e0e8'  // no alcanzado
]
```

Donde `nivel` es la **elevación del agua** (`nivel INA + cero`) y `999` marca “sin alcance” (en la práctica ningún edificio lo usa: el simulador termina en 16,378 m y la cota de alcanze máxima es 20,0 m).

El conteo no recorre las features: se descarga el binario ordenado de alcanze y se hace búsqueda binaria del límite superior:

```text
afectados = cantidad de alcanze <= elevación del agua
```

El binario `edificios-alcance.bin` tiene **75.808 Float32 little-endian**, ordenados de menor a mayor, y ocupa **303.232 bytes**.

Conteos por nivel (regla vieja por cota → regla nueva por alcanze):

| Nivel | Elevación | Antes | Ahora |
|---:|---:|---:|---:|
| 3,85 / en vivo | 12,228 / 12,258 m | 381 / 394 | **27** |
| 5,30 (alerta) | 13,678 m | 3.992 | **254** |
| 5,70 (evacuación) | 14,078 m | 7.321 | **1.992** |
| 7,43 (récord) | 15,808 m | 28.195 | **9.380** |
| 8,00 (máximo) | 16,378 m | 38.926 | **17.440** |

### 6.6. Popup de edificio

Muestra:

- altura (`a`), con la palabra “estimada” si `e = 1`;
- cota del terreno, con un decimal;
- estado por cota de alcanze: “Bajo el agua simulada”, “Se alcanza con agua desde X,X m de elevación” o “No alcanzado con el rango del simulador”.

No muestra número de floors, ID de Overture ni fecha del dato.

---

## 7. Tiles, conteos y rendimiento

### 7.1. Generación de tiles

Los tiles se generan offline con DuckDB Spatial y se sirven como archivos estáticos.

- Zoom: **13, 14 y 15**.
- Bounding box de generación: `[-60,785, -31,70, -60,575, -31,55]`.
- Extensión MVT: **4096**.
- Buffer: **64**.
- Recorte: sí (`clip=true`).
- Capa: `edificios`.
- ID de feature: columna `id`.
- Generador: `scripts/build_tiles.py`. Su bbox es el `bboxTiles` de la config, que MapLibre usa como `bounds` de la fuente.

Esquema de propiedades:

| Propiedad | Tipo | Significado |
|---|---|---|
| `id` | entero | ID interno secuencial |
| `a` | número | altura en metros |
| `e` | 0/1 | 0 = altura conocida/derivada; 1 = estimada |
| `cota` | número | elevación del terreno en metros |
| `alc` | número | cota de alcanze: elevación a la que la máscara lo alcanza |

La consulta base es:

```sql
WITH t AS (
  SELECT id, a, e, cota, alc,
    ST_AsMVTGeom(
      ST_Transform(geom, 'EPSG:4326', 'EPSG:3857'),
      ST_MakeBox2D(ST_Point(xm, ym), ST_Point(xM, yM)),
      4096, 64, true
    ) AS geom
  FROM edificios
  WHERE x1 >= lon0 AND x0 <= lon1 AND y1 >= lat0 AND y0 <= lat1
)
SELECT ST_AsMVT(t, 'edificios', 4096, 'geom', 'id') AS mvt
FROM t;
```

Detalle técnico: `ST_TileEnvelope` devuelve una geometría, no un `BOX_2D`; por eso se usa `ST_MakeBox2D` en EPSG:3857.

### 7.2. Tamaño y cantidad

| Zoom | Tiles | Tamaño |
|---:|---:|---:|
| 13 | 30 | 2,7 MB |
| 14 | 99 | 2,8 MB |
| 15 | 340 | 2,9 MB |
| **Total** | **469** | **8,4 MB** |

Tamaño máximo de un tile: **618.641 bytes**.

En disco, por el tamaño de bloque del sistema de archivos, `du` puede mostrar ~9,7 MB.

El zoom 12 se descartó: generaba tiles de hasta 4,68 MB y solo 9 tiles sumaban 7,2 MB, sin aportar detalle útil.

### 7.3. Carga en la app

La fuente vectorial usa:

```js
{
  type: 'vector',
  tiles: [publicUrl('tiles/{z}/{x}/{y}.pbf')],
  minzoom: 13,
  maxzoom: 15,
  bounds: cfg.bboxTiles // [-60.785, -31.7, -60.575, -31.55]
}
```

`bounds` restringe los pedidos al área que realmente tiene tiles (`bboxTiles`, el bbox de generación), más chica que el bbox del DEM: sin eso, al volar fuera de la cobertura MapLibre pide tiles inexistentes y el servidor responde con `index.html`, que el parser MVT rechaza.

`publicUrl()` resuelve correctamente la base cuando la app se publica en un subdirectorio. MapLibre exige URLs absolutas; con `BASE_URL = './'`, concatenar `origin + './tiles'` producía URLs inválidas como `http://host./tiles`. La función usa `new URL(import.meta.env.BASE_URL, window.location.href)`.

La capa 3D es `fill-extrusion`:

- `fill-extrusion-height = max(2.5, a)`;
- `fill-extrusion-base = 0`;
- opacidad 0,9;
- gradiente vertical;
- `minzoom: 13`.

### 7.4. Rendimiento medido

Con el dataset final, en producción:

| Métrica | Valor |
|---|---:|
| Tiles cargados al inicio (z13/z14) | 6 + 9 |
| Leyenda inicial | 27 afectados (nivel en vivo, 3,88 m) |
| Récord | 9.380 afectados |
| FPS tras asentarse | 61 |
| Tamaño de tiles | 8,4 MB |

La versión anterior, con 248.197 bounding boxes y 26 MB de tiles, también llegaba a 61 fps una vez asentada, pero tardaba mucho más en cargar y procesar.

---

## 8. Interfaz y comportamiento

### 8.1. Vista 2D / 3D

- **2D:** cámara en `centro`, zoom 12,7, sin terreno, sin edificios, sin hillshade.
- **3D:** cámara en el hidrómetro, zoom 14,2, pitch 58°, bearing -18°, terreno con exageración 2,2, hillshade visible y edificios visibles.

Al pasar a 3D:

```js
m.setTerrain({ source: 'terreno', exaggeration: 2.2 });
m.setLayoutProperty('relieve', 'visibility', 'visible');
m.setLayoutProperty('edificios-3d', 'visibility', 'visible');
m.easeTo({
  center: cfg.centro3d,
  pitch: 58,
  bearing: -18,
  zoom: Math.max(m.getZoom(), 14.2),
  duration: 900
});
```

Al volver a 2D se quita el terreno, se ocultan edificios y hillshade, y se vuelve a pitch 0 y bearing 0.

La exageración 2,2 afecta al terreno. Las extrusiones de edificios mantienen su altura en metros, por lo que la relación visual entre terreno y edificios no es 1:1.

### 8.2. Mapas de base

- Satélite: EOX Sentinel-2 cloudless, activo por defecto.
- Calles: OpenFreeMap Positron.
- El botón cambia la visibilidad de la capa ráster de satélite; el estilo de calles queda debajo.

### 8.3. Capas municipales

- Distritos: relleno celeste muy transparente, borde discontinuo, etiqueta y popup.
- Vecinales: relleno violeta muy transparente, borde fino, etiqueta a partir de zoom 12,8 y popup.
- Zona de seguridad hídrica: 19 polígonos del WFS `publico:zona_seguridad_hidrica`, relleno naranja tenue y borde discontinuo; popup con el id. Apagada por defecto. Se carga en paralelo e independiente: si falla, distritos y vecinales siguen disponibles.
- Terraplenes: `public/data/terraplenes.geojson` (12 alineamientos), línea ámbar con contorno marrón, dibujada **encima** del agua simulada; popup con sector, cota mín/máx/media y cantidad de puntos. Apagado por defecto. La misma geometría es la barrera del BFS.
- Se pueden activar/desactivar por separado (Distritos, Vecinales, Seg. hídrica, Terraplenes).
- Si el WFS falla, el mapa sigue funcionando y se muestra el error en el `title` de los botones.
- Orden de dibujo: relieve → hidrografía permanente → distritos/vecinales → seguridad hídrica → inundación → terraplenes → etiquetas → edificios.

### 8.4. Marcador e hidrómetro

Hay un marcador en:

```text
[-60.7002319185745, -31.6514772196376]
```

Etiquetado “Hidrómetro / Puerto Santa Fe”. La cámara 3D se centra ahí.

Hay un segundo marcador en:

```text
[-60.78055556, -31.49122222]
```

Etiquetado “Recreo / Río Salado” (punto verde). Queda unos 7 km al norte de la vista inicial: el botón “Ver en el mapa” de la tarjeta del Salado vuela hasta ahí (zoom ≈ 13,4).

### 8.5. Gauge y umbrales

El gauge va de 0 a 8 m y muestra:

- zona normal hasta alerta;
- zona de alerta entre alerta y evacuación;
- zona de evacuación por encima;
- marca del nivel actual;
- marca del nivel en vivo cuando se está simulando.

Estados:

| Nivel | Estado |
|---|---|
| ≥ 5,7 m | Evacuación |
| ≥ 5,3 m | Alerta |
| < 5,3 m | Normal |

“Aguas bajas” (2,0 m) está configurado, pero no se usa como estado visual principal.

### 8.6. Slider y botones

- Rango: 3,00 m a 8,00 m.
- Paso: 0,05 m.
- Botones:
  - Alerta (5,30 m);
  - Evacuación (5,70 m);
  - Récord 1992 (7,43 m).

El slider también muestra marcas de alerta, evacuación y récord.

### 8.7. Calibración del cero

El input permite cambiar la cota del cero entre 0 y 20 m. El valor oficial es 8,378 m.

Al cambiarlo:

- se recalcula la elevación del agua;
- se vuelve a calcular el polígono de inundación;
- se actualiza el color de los edificios;
- se actualiza el conteo.

Sirve para corregir el desfase entre el DEM y la cota IGN. **No** cambia los datos de INA: solo la conversión a elevación.

### 8.8. Gráficos

- **Nivel reciente:** últimos 120 días, con líneas de alerta y evacuación, tooltip al pasar el puntero y fecha del último dato.
- **Máximas anuales:** barras 1925–2026; color según alerta/evacuación; al hacer clic en una barra se simula ese máximo.
- **Top 6:** lista de las seis crecidas mayores; al hacer clic se simula ese nivel.

### 8.9. Manejo de errores

| Falla | Comportamiento |
|---|---|
| INA no responde | Mensaje de error; slider y mapa siguen con 3,85 m |
| DEM no carga | Mensaje y botón “Reintentar”; no hay inundación |
| WFS de zonas falla | El mapa sigue; error en el título de los botones |
| Binario de cotas falla | Leyenda “Edificios no disponibles”; el mapa sigue |
| Tiles no cargan | No se ven edificios; el resto del mapa sigue |

### 8.10. Tarjeta Río Salado

Tres tarjetas después de las del Paraná:

- **Nivel del río · Río Salado — Estación Recreo:** valor en metros, chip de estado (Normal/Alerta según4,7 m), variación contra la lectura anterior, gauge 0–8 m (zona de alerta desde4,7 m; como la evacuación no está publicada no se dibuja zona roja), pie con último dato, serie n.º 103, cero IGN 11,09 m y el link “Ver en el mapa”.
- **Nivel reciente · Río Salado:** `SerieChart` con120 días.
- **Máximas anuales · Río Salado:** `AnualesChart` con escala parametrizada2–8 m (el récord de 2003, 7,89 m, se sale de la escala por defecto del Paraná) y filas **no clicables**: el nivel del Salado no modula la simulación del Paraná.

Los umbrales faltantes se normalizan a `null` y `estadoDe`, `Gauge` y `AnualesChart` los ignoran (sin zona roja ni línea de evacuación fantasma).

---

## 9. Endpoints y parámetros

### 9.1. INA

Metadatos:

```text
GET https://alerta.ina.gob.ar/a5/obs/puntual/series/30
```

Observaciones:

```text
GET https://alerta.ina.gob.ar/a5/obs/puntual/observaciones
  ?series_id=30
  &timestart=YYYY-MM-DD
  &timeend=YYYY-MM-DD
  &format=json
```

La app pide 120 días y filtra valores no finitos. El último punto es el nivel en vivo.

### 9.2. WFS municipal

Base:

```text
https://geoservicios.santafeciudad.gov.ar/geoserver/publico/wfs
```

Zonas:

```text
?service=WFS
&version=2.0.0
&request=GetFeature
&typeNames=publico:distrito
&outputFormat=application/json
&srsName=EPSG:4326
&count=1000
```

Igual para `publico:vecinal` y para `publico:zona_seguridad_hidrica` (DefaultSRS `EPSG:22185`, reproyectado con `srsName=EPSG:4326`).

Edificios:

```text
https://geoservicios.santafeciudad.gov.ar/geoserver/publico/ows
  ?service=WFS
  &version=1.1.0
  &request=GetFeature
  &typeName=publico:3dprueba
  &outputFormat=application/json
  &srsName=EPSG:4326
  &propertyName=the_geom,altura_min,altura_max,id,nivel,fecha_imagen
  &sortBy=id
  &maxFeatures=2000
  &startIndex=...
```

La descarga de edificios fue offline; la app no consume este WFS en runtime.

### 9.3. Overture

```text
s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*.parquet
```

Configuración DuckDB:

```sql
LOAD httpfs;
LOAD spatial;
SET s3_region = 'us-west-2';
```

### 9.4. DEM, satélite y calles

```text
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg
https://tiles.openfreemap.org/styles/positron
```

### 9.5. Estación Recreo (río Salado)

Serie/unid **103**. Se consultan en paralelo dos fuentes y se combinan:

API a5 (serie larga, la misma que usa el Puerto):

```text
https://alerta.ina.gob.ar/a5/obs/puntual/series/103
https://alerta.ina.gob.ar/a5/obs/puntual/observaciones?series_id=103&timestart=…&timeend=…&format=json
```

WFS con timeseries (valor actual, umbrales y últimos 14 días; CORS `*`):

```text
https://alerta.ina.gob.ar/geoserver/public2/ows
  ?service=WFS
  &version=1.0.0
  &request=GetFeature
  &typeName=public2:ultimas_alturas_con_timeseries
  &viewParams=timeStart:AAAA-MM-DD;timeEnd:AAAA-MM-DD
  &CQL_FILTER=unid=103
  &outputFormat=application/json
```

El WFS con ventana de 120 días tarda ~20–60 s, por eso solo se le pide 14 días (≈2 s) y la serie larga viene de a5; ambas se mezclan desuplicando por hora. Timeout del WFS: 15 s. Fallbacks: si el WFS falla se usa solo a5; si a5 falla, solo WFS.

---

## 10. Estructura de archivos

```text
crecida-santa-fe/
├── index.html
├── package.json
├── vite.config.js
├── fuentes/
│   └── terraplenes/        # .shp y .dbf originales (no se publican)
├── scripts/
│   ├── terraplenes_geojson.py
│   ├── historia_salado.py
│   ├── alcance_edificios.py
│   └── build_tiles.py
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── styles.css
│   ├── components/
│   │   ├── Mapa.jsx
│   │   ├── SerieChart.jsx
│   │   └── AnualesChart.jsx
│   ├── config/
│   │   └── santaFe.js
│   ├── data/
│   │   ├── historia-santa-fe.json
│   │   └── historia-salado.json
│   └── lib/
│       ├── dem.js
│       ├── flood.js
│       ├── format.js
│       ├── geo.js
│       ├── ina.js
│       ├── publicUrl.js
│       ├── terraplenes.js
│       └── zonas.js
├── public/
│   ├── data/
│   │   ├── agua-permanente.geojson
│   │   ├── edificios-alcance.bin
│   │   └── terraplenes.geojson
│   └── tiles/
│       ├── 13/...
│       ├── 14/...
│       └── 15/...
└── dist/                 # build de producción
```

Archivos de datos relevantes:

| Archivo | Tamaño | Contenido |
|---|---:|---|
| `public/data/edificios-alcance.bin` | 303.232 B | 75.808 cotas de alcanze Float32 ordenadas |
| `public/data/terraplenes.geojson` | ~12 KB | 12 alineamientos de terraplén con cotas por vértice |
| `src/data/historia-salado.json` | ~1,6 KB | 26 años de máximas del Salado (2001–2026) |
| `public/data/agua-permanente.geojson` | ~1,2 MB | Polígono disuelto y 809 líneas de hidrografía permanente |
| `public/tiles/` | 8,4 MB | 469 tiles MVT |
| `src/data/historia-santa-fe.json` | 7,7 KB | 102 años de máximas |
| `dist/` | ~11 MB | build estático completo |

No se publica ningún GeoJSON de edificios: los edificios viajan en los PBF y las cotas en el binario.

---

## 11. Cómo ejecutar

### Desarrollo

```bash
cd crecida-santa-fe
npm install
npm run dev
```

Abre `http://localhost:5173/`. Para arrancar en 3D:

```text
http://localhost:5173/?vista=3d
```

### Build de producción

```bash
npm run build
npm run preview
```

El build queda en `dist/`. La app usa `base: './'`, por lo que puede servirse desde un subdirectorio, siempre que se conserven:

```text
dist/index.html
dist/assets/...
dist/data/edificios-alcance.bin
dist/tiles/...
```

### Requisitos de red

El navegador necesita acceso a:

- INA;
- geoservicios municipales;
- OpenFreeMap;
- EOX;
- AWS elevation tiles.

No hay variables de entorno ni claves de API.

### Regeneración de datos

Los tiles y el binario no se generan en el build de Vite: son archivos estáticos preparados aparte.

El flujo usado fue:

1. descargar edificios municipales por WFS;
2. descargar edificios de Overture con DuckDB;
3. construir la grilla DEM de referencia;
4. calcular la cota de cada edificio;
5. filtrar cota ≤ 18 m;
6. calcular la cota de alcanze y generar `edificios-alcance.bin` (`scripts/alcance_edificios.py`);
7. generar tiles z13–z15 con `ST_AsMVTGeom` + `ST_AsMVT` (`scripts/build_tiles.py`).

Los scripts originales de edificios se usaron fuera del repositorio (DuckDB Spatial, Python con NumPy/Shapely, Pillow/requests para el DEM); los de alcance y tiles ahora están en `scripts/`. Si se actualiza Overture o el relevamiento municipal, hay que repetir el proceso y volver a generar el binario y los tiles.

Regeneraciones puntuales, sí incluidas en el repo (solo stdlib de Python + `gdal-bin`):

```bash
# fuentes/terraplenes/*.shp -> public/data/terraplenes.geojson
python3 scripts/terraplenes_geojson.py

# serie103 del INA -> src/data/historia-salado.json
python3 scripts/historia_salado.py

# cota de alcanze -> public/data/edificios-alcance.bin + columna alc (duckdb)
python3 scripts/alcance_edificios.py

# tiles z13-z15 con alc (borra y reescribe public/tiles)
python3 scripts/build_tiles.py
```

Después de regenerar tiles hay que reiniciar `npm run dev` (o `preview`): Vite mantiene la lista de `public/` por eventos del watcher y, ante un `rmtree`+reescritura masiva, puede quedar desactualizada y servir `index.html` en vez del `.pbf`.

---

## 12. Limitaciones y advertencias

### Modelo de inundación

- Es un modelo geométrico de tipo “bañera con conectividad”, no un modelo hidráulico.
- No simula velocidad, caudal, duración, oleaje, viento ni lluvia local.
- Los terraplenes **sí** actúan como barrera (cota levantada sobre el DEM), pero solo donde el levantamiento tiene puntos: los huecos entre sectores, las zonas fuera de la bbox y los tramos sin cota levantada no frenan el agua (los pocos tramos sin cota quedan como muro absoluto).
- Las cotas de los terraplenes están en metros IGN y se comparan con `nivel + cero`; un desfase de datum afecta igual que la calibración del cero.
- No se modelan bombas, compuertas, defensas activas ni obras de protección.
- El agua se conecta al río por BFS de 4 vecinos; una depresión baja aislada no se inunda si no es alcanzable.
- El polígono de agua se drapa sobre el terreno; no es una superficie plana.
- El DEM tiene ~30 m de resolución y errores de décimas de metro o más.
- La cota del cero es un supuesto de calibración; un cambio incorrecto desplaza toda la inundación.

### Edificios

- El rojo usa la **cota de alcanze**, así que coincide con el polígono de inundación; la única diferencia posible es el redondeo de 0,01 m del valor horneado (y la muestra de 9 puntos, un poco más generosa que el centro exacto del edificio).
- La cota de alcanze se hornea contra la grilla DEM de referencia: si cambia el DEM de los tiles de AWS, hay que regenerar el binario y los tiles para que siga coincidiendo.
- La cota se muestrea alrededor de la huella, no en la planta baja.
- El DEM puede incluir techos, árboles o terraplenes.
- Las alturas municipales son declaradas, no medidas.
- La mayoría de Overture no tiene altura: se usa 3 m y se marca como estimada.
- `num_floors × 3 m` es una convención.
- El filtro cota ≤ 18 m asume el cero oficial y el máximo de 8 m. Si se sube mucho la calibración del cero, el agua puede superar los 18 m y haber edificios afectados que no estén en el dataset 3D. Para cambiar el rango del simulador o el cero de forma permanente, hay que regenerar el filtro.
- No hay identificación de edificio individual ni datos de población, vulnerabilidad o uso.
- Puede haber duplicados en la franja de cruce entre Overture y municipio.

### Datos y actualización

- Los tiles, las cotas, la hidrografía y los terraplenes son una foto estática: no se actualizan solos.
- INA se actualiza cada 10 minutos; el resto no.
- La serie histórica del Paraná tiene 2026 incompleto al corte; la del Salado es un snapshot generado (`historia-salado.json`), de2001 en adelante.
- La API a5 de la serie103 llega rezagada respecto al WFS del INA (por eso el valor en vivo sale del WFS con ventana corta).
- El WFS municipal y el INA pueden fallar o cambiar sin aviso.
- Overture y OpenStreetMap tienen sus propias licencias y atribuciones.
- La hidrografía permanente es una referencia de Overture/OSM; no se actualiza con el nivel ni con el DEM.
- El Río Coronda se ve en la hidrografía permanente, pero no está incluido en el modelo de inundación porque queda fuera del bbox del DEM.
- La app no reemplaza información oficial de Defensa Civil, INA, Prefectura o Municipalidad.

### Visualización

- La exageración del terreno es 2,2; los edificios no se exageran.
- El satélite y el DEM son fuentes externas; pueden tener desalineaciones.
- Los tiles se cortan en z15; a zoom mayor se escalan.
- La vista 3D prioriza el área del hidrómetro y la franja inundable; no muestra los edificios de cota > 18 m.
- La hidrografía permanente cubre un bbox más amplio que el DEM; fuera de ese recorte no hay agua base dibujada.

---

## 13. Créditos y licencias

| Fuente | Crédito |
|---|---|
| Nivel del río | INA–SIyAH, serie 30; datos primarios de Prefectura Naval Argentina |
| Río Salado (Recreo) | INA–SIyAH, serie 103; datos primarios de Prefectura Naval Argentina |
| Edificios municipales | Municipalidad de Santa Fe, Geoservicios |
| Distritos y vecinales | Municipalidad de Santa Fe, Geoservicios |
| Zona de seguridad hídrica | Municipalidad de Santa Fe, Geoservicios |
| Terraplenes | Municipalidad de Santa Fe, levantamiento de cotas 10/02/2020 |
| Edificios del oeste | Overture Maps Foundation |
| Hidrografía permanente | Overture Maps Foundation / OpenStreetMap contributors |
| Relieve | Mapzen Terrain Tiles / AWS Open Data; SRTM y otras fuentes |
| Satélite | Sentinel-2 cloudless © EOX IT Services GmbH; contiene datos modificados de Copernicus Sentinel-2 |
| Calles | OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors |
| Contornos | `d3-contour` |
| Mapas | MapLibre GL JS |

Las licencias de Overture, OpenStreetMap, EOX y Mapzen deben respetarse al redistribuir la app o los datos derivados. OpenStreetMap se usa bajo ODbL y requiere atribución.

---

## 14. Anexo: cifras de referencia

### Edificios

| Concepto | Valor |
|---|---:|
| Dataset original | 248.197 |
| Overture original (bboxes) | 221.956 |
| Municipal original | 26.241 |
| Overture descargado con huellas reales | 222.159 |
| Overture final | 54.353 |
| Municipal final | 21.455 |
| **Total final 3D** | **75.808** |
| Reducción por filtro | 69,5 % |
| `e = 0` | 21.484 |
| `e = 1` | 54.324 |
| Cota mínima | 8,44 m |
| Cota mediana | 16,28 m |
| Cota máxima | 18,00 m |

### Inundación y edificios afectados

| Nivel INA | Elevación | Edificios afectados | Área del modelo (con terraplenes) |
|---:|---:|---:|---:|
| 3,85 m | 12,228 m | 27 | ≈ 96,6 km² |
| 5,30 m | 13,678 m | 254 | ≈ 249,5 km² |
| 5,70 m | 14,078 m | 1.992 | ≈ 310,1 km² |
| 7,43 m | 15,808 m | 9.380 | ≈ 364,4 km² |
| 8,00 m | 16,378 m | 17.440 | — |

Los edificios afectados salen de la cota de alcanze: coinciden con la máscara (incluidos los terraplenes). Bajan respecto a la regla anterior por cota porque muchos edificios quedan detrás de un terraplén o fuera de la conectividad con el río.

El nivel en vivo del ejemplo de validación fue 3,88 m, que da **394** edificios afectados.

### Tiles

| Concepto | Valor |
|---|---:|
| Tiles | 469 |
| z13 | 30 tiles / 2,7 MB |
| z14 | 99 tiles / 2,8 MB |
| z15 | 340 tiles / 2,9 MB |
| Total | 8,4 MB |
| Tile máximo | 618.641 B |
| Extensión MVT | 4096 |
| Buffer | 64 |

### Grilla DEM

| Concepto | Valor |
|---|---:|
| Zoom | 13 |
| Tiles | 48 |
| Decimación | 2 |
| Filtro | mediana 3 × 3 |
| Celdas | 844 × 633 |
| Total de celdas | 534.252 |
| Resolución | ~32,5 m |
| Extensión | ~27,5 × 20,6 km |

### Serie histórica

| Concepto | Valor |
|---|---:|
| Período | 1925-01-02 a 2026-09-01 |
| Observaciones diarias | 36.922 |
| Años | 102 |
| Año incompleto | 2026 |
| Récord | 7,43 m (1992-06-22) |

### Estado de validación al corte

- Build de producción correcto.
- Sin errores de consola ni de red propios.
- 2D y 3D verificados.
- Popup de edificio y de zonas verificado.
- Conteo 27 al nivel en vivo y 9.380 en el récord (regla por cota de alcanze).
- 61 fps tras asentarse.
- Tiles con huellas reales: promedio ~6,3 puntos por feature en las muestras verificadas.
