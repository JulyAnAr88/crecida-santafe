#!/usr/bin/env python3
"""Calcula la "cota de alcanze" por edificio y regenera el binario de conteo.

Para cada celda de la grilla DEM se calcula la elevación mínima del agua a la
que la máscara (BFS conectado desde las semillas del Paraná, con los
terraplenes como barrera) la alcanza. Es el equivalente offline exacto del
BFS de src/lib/flood.js: un Dijkstra minimax donde el costo de entrar a una
celda es su altura efectiva (máximo entre DEM y cota de terraplén).

Luego, por edificio, se toma el MÍNIMO sobre los mismos 9 puntos de muestreo
que bake_cotas.py usó para la cota: si el agua toca un borde de la muestra,
el edificio queda alcanzado. Inalcanzables = 999 (nunca se pinta de rojo).

Salidas:
  - public/data/edificios-alcance.bin   (75.808 Float32 ordenados, reemplaza
    a edificios-cotas.bin; el conteo sigue siendo una búsqueda binaria)
  - columna `alc` en /tmp/opencode/edificios_final.duckdb (para los tiles)
  - /tmp/opencode/dist_grid.f32          (grilla de alcanze, para validar
    contra el BFS real con Node)

Requiere: dem_grid.npz, terraplenes.geojson, edificios_final.duckdb y el
entorno con duckdb/shapely/numpy.

Uso: python3 scripts/alcance_edificios.py
"""
import math
import os
import sys

import duckdb
import numpy as np
from shapely import wkb

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZOOM = 13
DEC = 2
SEMILLAS = [
    (-60.682, -31.640),
    (-60.678, -31.660),
    (-60.678, -31.620),
    (-60.545, -31.630),
    (-60.525, -31.700),
]
NPZ = '/tmp/opencode/dem_grid.npz'
GEOJSON = os.path.join(RAIZ, 'public', 'data', 'terraplenes.geojson')
DUCKDB = '/tmp/opencode/edificios_final.duckdb'
OUT_BIN = os.path.join(RAIZ, 'public', 'data', 'edificios-alcance.bin')
DIST_OUT = '/tmp/opencode/dist_grid.f32'
PASO = 0.34
SIN_ALCANCE = 999.0
NIVELES = [
    (3.85, 12.228), (3.88, 12.258), (5.30, 13.678),
    (5.70, 14.078), (7.43, 15.808), (8.00, 16.378),
]


def lonx(lon, z):
    return ((lon + 180) / 360) * 2 ** z


def laty(lat, z):
    r = math.radians(lat)
    return ((1 - math.asinh(math.tan(r)) / math.pi) / 2) * 2 ** z


def cargar_grilla():
    z = np.load(NPZ)
    heights = np.asarray(z['heights'], dtype=np.float32)
    return {
        'heights': heights,
        'width': int(z['width']),
        'height': int(z['height']),
        'gx0': int(z['gx0']),
        'gy0': int(z['gy0']),
    }


def rasterizar_terraplenes(g, geojson):
    """Puerto fiel de src/lib/terraplenes.js (paso0,34 celda + camino4-vecino)."""
    W, H = g['width'], g['height']
    cota = np.zeros(W * H, dtype=np.float32)
    muro = np.zeros(W * H, dtype=np.uint8)
    celdas_cota = [0]
    celdas_muro = [0]

    def a_grid(lon, lat):
        return (
            (lonx(lon, ZOOM) * 256 - g['gx0']) / DEC,
            (laty(lat, ZOOM) * 256 - g['gy0']) / DEC,
        )

    def caminar(x, y, con_cota):
        if x < 0 or y < 0 or x >= W or y >= H:
            return
        i = y * W + x
        if con_cota > 0:
            if con_cota > cota[i]:
                if cota[i] == 0:
                    celdas_cota[0] += 1
                cota[i] = con_cota
        elif not muro[i]:
            muro[i] = 1
            if cota[i] == 0:
                celdas_muro[0] += 1

    def marcar(ix, iy, con_cota, anterior):
        if anterior is None:
            caminar(ix, iy, con_cota)
            return (ix, iy)
        cx, cy = anterior
        while cx != ix or cy != iy:
            if cx != ix:
                cx += 1 if ix > cx else -1
            else:
                cy += 1 if iy > cy else -1
            caminar(cx, cy, con_cota)
        return (ix, iy)

    for f in geojson['features']:
        if f['geometry']['type'] != 'LineString':
            continue
        coords = f['geometry']['coordinates']
        z = f['properties'].get('z') or []
        anterior = None
        for k in range(len(coords) - 1):
            x0, y0 = a_grid(*coords[k])
            x1, y1 = a_grid(*coords[k + 1])
            z0 = z[k] if k < len(z) else 0
            z1 = z[k + 1] if k + 1 < len(z) else 0
            n = max(1, math.ceil(math.hypot(x1 - x0, y1 - y0) / PASO))
            for s in range(n + 1):
                t = s / n
                ix = math.floor(x0 + (x1 - x0) * t)
                iy = math.floor(y0 + (y1 - y0) * t)
                if z0 > 0 and z1 > 0:
                    con_cota = z0 + (z1 - z0) * t
                elif z0 > 0:
                    con_cota = z0
                elif z1 > 0:
                    con_cota = z1
                else:
                    con_cota = 0
                anterior = marcar(ix, iy, con_cota, anterior)
    return cota, muro, celdas_cota[0], celdas_muro[0]


def alcanze_grilla(g, cota_t, muro_t):
    """Dijkstra minimax: dist[celda] = elevación mínima del agua que la moja."""
    import heapq

    W, H, N = g['width'], g['height'], g['width'] * g['height']
    heights = g['heights']
    eff = np.where(
        (cota_t > 0) & (cota_t > heights),
        cota_t.astype(np.float64),
        heights.astype(np.float64),
    )
    bloqueado = (muro_t == 1) & ~(cota_t > 0)
    INF = np.float64(np.inf)
    dist = np.full(N, INF)

    heap = []
    semillas_ok = 0
    seed_effs = []
    for lon, lat in SEMILLAS:
        gx = lonx(lon, ZOOM) * 256 - g['gx0']
        gy = laty(lat, ZOOM) * 256 - g['gy0']
        x, y = math.floor(gx / DEC), math.floor(gy / DEC)
        if x < 0 or y < 0 or x >= W or y >= H:
            continue
        i = y * W + x
        if bloqueado[i]:
            continue
        semillas_ok += 1
        seed_effs.append(float(eff[i]))
        if eff[i] < dist[i]:
            dist[i] = eff[i]
            heapq.heappush(heap, (float(eff[i]), i))
    if semillas_ok == 0:
        raise SystemExit('ninguna semilla válida')

    while heap:
        d, i = heapq.heappop(heap)
        if d > dist[i]:
            continue
        x = i % W
        for j in (i - 1, i + 1, i - W, i + W):
            if j < 0 or j >= N:
                continue
            if j == i - 1 and x == 0:
                continue
            if j == i + 1 and x == W - 1:
                continue
            if bloqueado[j]:
                continue
            nd = max(d, float(eff[j]))
            if nd < dist[j]:
                dist[j] = nd
                heapq.heappush(heap, (nd, j))
    return dist, min(seed_effs)


def anillo(geom):
    if geom.geom_type == 'Polygon':
        return list(geom.exterior.coords)
    if geom.geom_type == 'MultiPolygon':
        mejor, mejor_a = None, -1
        for poly in geom.geoms:
            ring = list(poly.exterior.coords)
            a = 0.0
            for i in range(len(ring)):
                x1, y1 = ring[i - 1]
                x2, y2 = ring[i]
                a += x1 * y2 - x2 * y1
            if abs(a) > mejor_a:
                mejor_a, mejor = abs(a), ring
        return mejor
    return None


def muestras(ring):
    """Los mismos 9 puntos que bake_cotas.py usa para la cota."""
    minlon = min(p[0] for p in ring)
    maxlon = max(p[0] for p in ring)
    minlat = min(p[1] for p in ring)
    maxlat = max(p[1] for p in ring)
    if not math.isfinite(minlon):
        return []
    clon = (minlon + maxlon) / 2
    clat = (minlat + maxlat) / 2
    dlon = max((maxlon - minlon) / 2, 0.00022)
    dlat = max((maxlat - minlat) / 2, 0.0002)
    return [
        (minlon - dlon * 0.35, minlat - dlat * 0.35),
        (maxlon + dlon * 0.35, minlat - dlat * 0.35),
        (minlon - dlon * 0.35, maxlat + dlat * 0.35),
        (maxlon + dlon * 0.35, maxlat + dlat * 0.35),
        (clon, minlat - dlat * 0.35),
        (clon, maxlat + dlat * 0.35),
        (minlon - dlon * 0.35, clat),
        (maxlon + dlon * 0.35, clat),
        (clon, clat),
    ]


def main():
    import json
    g = cargar_grilla()
    W, H, N = g['width'], g['height'], g['width'] * g['height']
    print(f'grilla {W}x{H} ({N} celdas)')

    with open(GEOJSON, encoding='utf-8') as f:
        geojson = json.load(f)
    cota_t, muro_t, n_cota, n_muro = rasterizar_terraplenes(g, geojson)
    print(f'raster terraplenes: {n_cota} celdas con cota, {n_muro} muros')
    if (n_cota, n_muro) != (2397, 0):
        raise SystemExit(
            f'PARIDAD RASTER FALLÓ: esperado (2397, 0), obtenido ({n_cota}, {n_muro})'
        )

    t0 = __import__('time').time()
    dist, seed_min = alcanze_grilla(g, cota_t, muro_t)
    print(f'dijkstra minimax: {round(__import__("time").time() - t0, 1)} s, '
          f'mín. elev. de semilla {seed_min:.3f} m')
    if seed_min > 11.378:
        raise SystemExit('las semillas quedan sobre el nivel mínimo de prueba: '
                         'el fallback del BFS podría divergir')
    dist.astype('<f4').tofile(DIST_OUT)
    alcance = np.where(np.isfinite(dist), dist, SIN_ALCANCE)
    con = duckdb.connect(DUCKDB, read_only=True)
    cotas = np.sort(np.asarray(
        con.execute('SELECT cota FROM edificios').fetchall(), dtype=np.float64
    ).ravel())

    # alcance por edificio: mínimo sobre los mismos9 puntos de la cota
    rows = con.execute(
        'SELECT id, ST_AsWKB(geom) FROM edificios ORDER BY id'
    ).fetchall()
    con.close()
    print(f'edificios: {len(rows):,}')
    import csv
    t0 = __import__('time').time()
    out = []
    for bid, b in rows:
        ring = anillo(wkb.loads(b))
        vals = []
        if ring:
            for lon, lat in muestras(ring):
                x = math.floor((lonx(lon, ZOOM) * 256 - g['gx0']) / DEC)
                y = math.floor((laty(lat, ZOOM) * 256 - g['gy0']) / DEC)
                if 0 <= x < W and 0 <= y < H:
                    d = alcance[y * W + x]
                    if np.isfinite(d):
                        vals.append(float(d))
        out.append((int(bid), round(min(vals), 2) if vals else SIN_ALCANCE))
    print(f'alcance por edificio: {round(__import__("time").time() - t0, 1)} s')
    arr = np.array([v for _, v in out], dtype=np.float64)
    print(f'alc min/med/max: {arr.min():.2f} / {np.median(arr):.2f} / {arr.max():.2f}, '
          f'999: {int((arr >= SIN_ALCANCE).sum()):,}')

    # conteos por nivel: regla vieja (cota) vs nueva (alcance), ambos por edificio
    cotas = np.sort(cotas)
    print(f'\n{"nivel":>6} {"elev":>7} {"viejo (cota)":>13} {"nuevo (alc)":>12} {"delta":>9}')
    for nombre, elev in NIVELES:
        v = int((cotas <= elev).sum())
        x = int((arr <= elev).sum())
        print(f'{nombre:>6.2f} {elev:>7.3f} {v:>13,} {x:>12,} {x - v:>9,}')
    print(f'alc > 16,378 (nunca con el simulador): {int((arr > 16.378).sum()):,}')

    os.makedirs(os.path.dirname(OUT_BIN), exist_ok=True)
    np.sort(arr).astype('<f4').tofile(OUT_BIN)
    print(f'bin: {OUT_BIN} ({os.path.getsize(OUT_BIN)} bytes)')

    csv_path = '/tmp/opencode/alcance.csv'
    with open(csv_path, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'alc'])
        w.writerows(out)
    con = duckdb.connect(DUCKDB)
    con.execute('DROP TABLE IF EXISTS alcance')
    con.execute('CREATE TABLE alcance(id BIGINT, alc DOUBLE)')
    con.execute(f"COPY alcance FROM '{csv_path}' (HEADER)")
    try:
        con.execute('ALTER TABLE edificios DROP COLUMN alc')
    except Exception:
        pass
    con.execute('ALTER TABLE edificios ADD COLUMN alc DOUBLE')
    con.execute('UPDATE edificios SET alc = a.alc FROM alcance a '
                'WHERE a.id = edificios.id')
    nulos = con.execute('SELECT count(*) FROM edificios WHERE alc IS NULL').fetchone()[0]
    print('duckdb: alc cargada, sin datos =', nulos)
    if nulos:
        raise SystemExit('hay edificios sin alc')
    con.close()


if __name__ == '__main__':
    sys.exit(main())
