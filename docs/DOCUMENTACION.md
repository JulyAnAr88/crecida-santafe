# Crecida · Santa Fe — Documentación técnica

Aplicación web para consultar el nivel del río Paraná en Santa Fe, simular crecidas y ver el avance del agua sobre el terreno y sobre los edificios en 3D.

[← Volver al README](../README.md)

> **Corte de esta documentación:** 22/10/2026.
> **Datos de edificios:** Overture Maps release `2026-10-21.0` y relevamiento municipal con imagen de 03/2022.
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
3. **Mapa 2D/3D:** muestra el polígono de agua, distritos y vecinales, un modelo de elevación con exageración, y edificios extruidos.
4. **Edificios afectados:** los edificios se pintan en rojo cuando su cota de terreno es menor o igual a la elevación del agua simulada. La leyenda muestra cuántos son sobre el total de edificios incluidos en el modelo 3D.

También incluye:

- gauge con umbrales de aguas bajas, alerta y evacuación;
- gráfico de la serie reciente;
- gráfico de máximas anuales 1925–2026;
- botones rápidos para alerta, evacuación y récord histórico;
- calibración manual de la cota del cero del hidrómetro;
- capas de distritos y vecinales;
- popups de zonas y de edificios.

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
| Datos estáticos | GeoJSON, PNG DEM, PBF vector tiles, binario de cotas |
| Datos dinámicos | INA, WFS municipal, tiles externos |

### Flujo general

```text
INA ───────────────┐
WFS municipales ───┤
DEM terrarium ─────┼──> React (App.jsx) ──> MapLibre (Mapa.jsx)
Tiles PBF ─────────┤         │
Cotas binarias ────┘         └──> estado, cálculo de inundación, leyenda
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
| `src/lib/zonas.js` | Cliente WFS de distritos y vecinales |
| `src/lib/geo.js` | Conversiones Web Mercator / tile / píxel |
| `src/lib/format.js` | Formateo de números y fechas en es-AR |
| `src/data/historia-santa-fe.json` | Máximas anuales históricas |
| `public/tiles/` | Vector tiles de edificios z13–z15 |
| `public/data/edificios-cotas.bin` | Cotas ordenadas para conteo rápido |

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

### 3.2. Serie histórica

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

### 3.3. Edificios municipales

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

### 3.4. Edificios de Overture Maps

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

### 3.5. Distritos y vecinales

Fuente: WFS municipal.

| Capa | Features | Uso |
|---|---:|---|
| `publico:distrito` | 8 | relleno, borde, etiqueta y popup |
| `publico:vecinal` | 87 | relleno, borde, etiqueta y popup |

Se consultan al iniciar la app con WFS 2.0.0, `outputFormat=application/json`, `srsName=EPSG:4326` y `count=1000`.

Las etiquetas se calculan en el cliente: se toma el anillo principal de cada polígono (el de mayor área) y se calcula su centroide con la fórmula del área firmada. El popup usa `nombre` y `numero`.

### 3.6. DEM y mapas de base

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

### 3.7. Fuentes oficiales enlazadas

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
   - distritos y vecinales;
   - DEM;
   - binario de cotas de edificios.
4. Cuando llega la serie, se toma el último valor como nivel en vivo.
5. Si el usuario no tocó el slider, la simulación se inicializa con ese valor.
6. Cuando el DEM está listo y hay un nivel, se calcula el polígono de inundación.
7. Cuando el mapa está listo y hay nivel, se actualiza el color de los edificios.

Si INA falla, el mapa y el simulador siguen funcionando con el nivel inicial de 3,85 m y se muestra un mensaje de error.

### 4.2. Estado de simulación

- `sim`: nivel elegido en el slider.
- `tocado`: indica si el usuario movió el slider o usó un botón.
- `live`: último valor del INA.
- `mostrado = sim ?? live ?? 3,85`.

Mientras `tocado` sea falso, cada actualización del INA actualiza la simulación. Cuando el usuario toca el slider, `tocado` pasa a verdadero y las actualizaciones del INA ya no pisan el valor elegido. “Volver a en vivo” limpia `tocado` y restaura el último valor del INA.

### 4.3. Cálculo y actualización

- El DEM se carga una vez.
- El polígono de agua se recalcula cuando cambian `dem`, `sim` o `cero`.
- Hay un debounce de 90 ms para no recalcular en cada evento del slider.
- El color y el conteo de edificios se actualizan en cada cambio de nivel, sin recalcular el DEM.
- La serie del INA se actualiza cada 10 minutos.
- Los tiles y el binario de cotas son estáticos; no se piden a un backend.

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

2. Cada semilla se convierte a celda. Si la celda está por encima del nivel, se busca la celda mojada más cercana en un radio de hasta 14 celdas (aproximadamente 455 m), eligiendo la más baja.
3. Si ninguna semilla queda mojada, se usa como semilla la celda más baja de toda la grilla.
4. Se hace un **BFS de 4 vecinos** (arriba, abajo, izquierda, derecha) desde las semillas.
5. Una celda se inunda si:

   ```text
   altura_DEM(celda) <= elevación_del_agua
   ```

   y además es alcanzable desde el río.

6. Se genera un campo binario `1` para celdas inundadas y `0` para el resto.
7. Se extraen los contornos con `d3-contour` en el umbral 0,5.
8. Cada anillo se convierte de coordenadas de grilla a longitud/latitud.
9. Se simplifica con Ramer–Douglas–Peucker con tolerancia de 0,00009° (unos 10 m en latitud y 8,5 m en longitud).
10. Se calcula el área sumando, por fila, la cantidad de celdas mojadas por el área de celda correspondiente a esa latitud:

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

El GeoJSON se carga en la fuente `agua` de MapLibre:

- relleno `#2b9fe0` con opacidad 0,5;
- borde `#9fe0ff` de 1 px;
- se dibuja sobre el terreno con `fill` normal, por lo que **sigue la topografía** y no forma una superficie plana horizontal.

Las capas de edificios se dibujan por encima del agua.

### 5.6. Áreas de referencia

Valores calculados con este DEM y este algoritmo:

| Nivel INA | Elevación | Área estimada |
|---:|---:|---:|
| 3,85 m | 12,228 m | 95,8 km² |
| 5,30 m | 13,678 m | 240,9 km² |
| 5,70 m | 14,078 m | 306,0 km² |
| 7,43 m | 15,808 m | 366,4 km² |

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

En `Mapa.jsx`, la expresión de color es:

```js
[
  'case',
  ['<=', ['coalesce', ['get', 'cota'], 100000], nivel],
  '#dc2626', // afectado
  '#d5e0e8'  // no afectado
]
```

Donde `nivel` es la **elevación del agua** (`nivel INA + cero`).

El conteo no recorre las features: se descarga un binario ordenado de cotas y se hace búsqueda binaria del límite superior:

```text
afectados = cantidad de cotas <= elevación del agua
```

El binario tiene **75.808 Float32 little-endian**, ordenados de menor a mayor, y ocupa **303.232 bytes**.

### 6.6. Popup de edificio

Muestra:

- altura (`a`), con la palabra “estimada” si `e = 1`;
- cota del terreno, con un decimal;
- “Bajo el agua simulada” o “Fuera del agua simulada”.

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

Esquema de propiedades:

| Propiedad | Tipo | Significado |
|---|---|---|
| `id` | entero | ID interno secuencial |
| `a` | número | altura en metros |
| `e` | 0/1 | 0 = altura conocida/derivada; 1 = estimada |
| `cota` | número | elevación del terreno en metros |

La consulta base es:

```sql
WITH t AS (
  SELECT id, a, e, cota,
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
| 13 | 30 | 2,6 MB |
| 14 | 99 | 2,6 MB |
| 15 | 340 | 2,7 MB |
| **Total** | **469** | **7,9 MB** |

Tamaño máximo de un tile: **584.325 bytes**.

En disco, por el tamaño de bloque del sistema de archivos, `du` puede mostrar ~9,2 MB.

El zoom 12 se descartó: generaba tiles de hasta 4,68 MB y solo 9 tiles sumaban 7,2 MB, sin aportar detalle útil.

### 7.3. Carga en la app

La fuente vectorial usa:

```js
{
  type: 'vector',
  tiles: [publicUrl('tiles/{z}/{x}/{y}.pbf')],
  minzoom: 13,
  maxzoom: 15
}
```

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
| Leyenda inicial | ~381–394 afectados |
| Récord | 28.195 afectados |
| FPS tras asentarse | 61 |
| Tamaño de tiles | 7,9 MB |

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
- Se pueden activar/desactivar por separado.
- Si el WFS falla, el mapa sigue funcionando y se muestra el error en el `title` de los botones.

### 8.4. Marcador e hidrómetro

Hay un marcador en:

```text
[-60.7002319185745, -31.6514772196376]
```

Etiquetado “Hidrómetro / Puerto Santa Fe”. La cámara 3D se centra ahí.

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

Igual para `publico:vecinal`.

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

---

## 10. Estructura de archivos

```text
crecida-santa-fe/
├── index.html
├── package.json
├── vite.config.js
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
│   │   └── historia-santa-fe.json
│   └── lib/
│       ├── dem.js
│       ├── flood.js
│       ├── format.js
│       ├── geo.js
│       ├── ina.js
│       └── zonas.js
├── public/
│   ├── data/
│   │   └── edificios-cotas.bin
│   └── tiles/
│       ├── 13/...
│       ├── 14/...
│       └── 15/...
└── dist/                 # build de producción
```

Archivos de datos relevantes:

| Archivo | Tamaño | Contenido |
|---|---:|---|
| `public/data/edificios-cotas.bin` | 303.232 B | 75.808 cotas Float32 ordenadas |
| `public/tiles/` | 7,9 MB | 469 tiles MVT |
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
dist/data/edificios-cotas.bin
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
6. generar `edificios-cotas.bin`;
7. generar tiles z13–z15 con `ST_AsMVTGeom` + `ST_AsMVT`.

Los scripts de generación se usaron fuera del repositorio (DuckDB Spatial, Python con NumPy/Shapely, Pillow/requests para el DEM). Si se actualiza Overture o el relevamiento municipal, hay que repetir el proceso y volver a generar los tiles y el binario.

---

## 12. Limitaciones y advertencias

### Modelo de inundación

- Es un modelo geométrico de tipo “bañera con conectividad”, no un modelo hidráulico.
- No simula velocidad, caudal, duración, oleaje, viento ni lluvia local.
- No modela defensas, terraplenes, bombas, compuertas ni obras de protección.
- El agua se conecta al río por BFS de 4 vecinos; una depresión baja aislada no se inunda si no es alcanzable.
- El polígono de agua se drapa sobre el terreno; no es una superficie plana.
- El DEM tiene ~30 m de resolución y errores de décimas de metro o más.
- La cota del cero es un supuesto de calibración; un cambio incorrecto desplaza toda la inundación.

### Edificios

- El rojo se asigna por **cota del terreno ≤ elevación del agua**, sin comprobar que el edificio esté dentro del polígono conectado. Un edificio en una depresión aislada puede quedar rojo aunque el agua del polígono no lo alcance.
- La cota se muestrea alrededor de la huella, no en la planta baja.
- El DEM puede incluir techos, árboles o terraplenes.
- Las alturas municipales son declaradas, no medidas.
- La mayoría de Overture no tiene altura: se usa 3 m y se marca como estimada.
- `num_floors × 3 m` es una convención.
- El filtro cota ≤ 18 m asume el cero oficial y el máximo de 8 m. Si se sube mucho la calibración del cero, el agua puede superar los 18 m y haber edificios afectados que no estén en el dataset 3D. Para cambiar el rango del simulador o el cero de forma permanente, hay que regenerar el filtro.
- No hay identificación de edificio individual ni datos de población, vulnerabilidad o uso.
- Puede haber duplicados en la franja de cruce entre Overture y municipio.

### Datos y actualización

- Los tiles y las cotas son una foto estática: no se actualizan solos.
- INA se actualiza cada 10 minutos; el resto no.
- La serie histórica tiene 2026 incompleto al corte.
- El WFS municipal y el INA pueden fallar o cambiar sin aviso.
- Overture y OpenStreetMap tienen sus propias licencias y atribuciones.
- La app no reemplaza información oficial de Defensa Civil, INA, Prefectura o Municipalidad.

### Visualización

- La exageración del terreno es 2,2; los edificios no se exageran.
- El satélite y el DEM son fuentes externas; pueden tener desalineaciones.
- Los tiles se cortan en z15; a zoom mayor se escalan.
- La vista 3D prioriza el área del hidrómetro y la franja inundable; no muestra los edificios de cota > 18 m.

---

## 13. Créditos y licencias

| Fuente | Crédito |
|---|---|
| Nivel del río | INA–SIyAH, serie 30; datos primarios de Prefectura Naval Argentina |
| Edificios municipales | Municipalidad de Santa Fe, Geoservicios |
| Distritos y vecinales | Municipalidad de Santa Fe, Geoservicios |
| Edificios del oeste | Overture Maps Foundation |
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

| Nivel INA | Elevación | Edificios afectados | Área del modelo |
|---:|---:|---:|---:|
| 3,85 m | 12,228 m | 381 | 95,8 km² |
| 5,30 m | 13,678 m | 3.992 | 240,9 km² |
| 5,70 m | 14,078 m | 7.321 | 306,0 km² |
| 7,43 m | 15,808 m | 28.195 | 366,4 km² |
| 8,00 m | 16,378 m | 38.926 | — |

El nivel en vivo del ejemplo de validación fue 3,88 m, que da **394** edificios afectados.

### Tiles

| Concepto | Valor |
|---|---:|
| Tiles | 469 |
| z13 | 30 tiles / 2,6 MB |
| z14 | 99 tiles / 2,6 MB |
| z15 | 340 tiles / 2,7 MB |
| Total | 7,9 MB |
| Tile máximo | 584.325 B |
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
- Conteo 394 al nivel en vivo y 28.195 en el récord.
- 61 fps tras asentarse.
- Tiles con huellas reales: promedio ~6,3 puntos por feature en las muestras verificadas.
