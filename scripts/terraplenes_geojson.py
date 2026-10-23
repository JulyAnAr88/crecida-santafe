#!/usr/bin/env python3
"""Convierte los crudos de cotas de terraplenes a GeoJSON para la app.

Entrada:  fuentes/terraplenes/10022020_Cotas_Terraplenes.shp (+ .dbf)
Salida:   public/data/terraplenes.geojson

Los .shp son puntos de levantamiento (PointZ, EPSG:22185) desordenados dentro
de cada sector. Por eso por sector se reconstruye el alineamiento con una
cadena de vecino más cercano (los extremos se prueban como inicios posibles y
se elige la cadena con el salto máximo menor). Los vértices llevan su cota en
properties.z; 0 = sin dato (el rasterizador del navegador la trata como muro
sin cota, siempre bloqueante).

Requiere: python3 y gdal-bin (gdaltransform) en el PATH.

Uso: python3 scripts/terraplenes_geojson.py
"""
import json
import math
import os
import struct
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHP = os.path.join(RAIZ, 'fuentes', 'terraplenes', '10022020_Cotas_Terraplenes.shp')
DBF = os.path.join(SHP[:-4] + '.dbf')
OUT = os.path.join(RAIZ, 'public', 'data', 'terraplenes.geojson')
EPSG_ORIGEN = 'EPSG:22185'


def leer_shp(path):
    b = open(path, 'rb').read()
    shapetype = struct.unpack('<i', b[32:36])[0]
    if shapetype != 11:
        raise SystemExit(f'shapetype {shapetype} != 11 (PointZ)')
    pts = []
    off = 100
    while off + 8 <= len(b):
        _, cl = struct.unpack('>ii', b[off:off + 8])
        body = off + 8
        st = struct.unpack('<i', b[body:body + 4])[0]
        if st == 11:
            x, y, z = struct.unpack('<3d', b[body + 4:body + 28])
            pts.append((x, y, z))
        off = body + cl * 2
    return pts


def leer_dbf(path):
    b = open(path, 'rb').read()
    nrec, hlen, rlen = struct.unpack('<IHH', b[4:12])
    campos = []
    off = 32
    while b[off] != 0x0D:
        nombre = b[off:off + 11].split(b'\x00')[0].decode('latin-1')
        tipo = chr(b[off + 11])
        largo = b[off + 16]
        campos.append((nombre, tipo, largo))
        off += 32
    filas = []
    for i in range(nrec):
        reg = b[hlen + i * rlen: hlen + (i + 1) * rlen]
        if not reg or reg[0:1] == b'*':
            continue
        p = 1
        fila = {}
        for nombre, tipo, largo in campos:
            crudo = reg[p:p + largo].decode('latin-1').strip()
            p += largo
            if tipo in 'NF':
                try:
                    fila[nombre] = float(crudo) if crudo else 0.0
                except ValueError:
                    fila[nombre] = 0.0
            else:
                fila[nombre] = crudo
        filas.append(fila)
    return filas


def a_wgs84(pares):
    if not pares:
        return []
    entrada = '\n'.join(f'{x:.4f} {y:.4f}' for x, y in pares)
    res = subprocess.run(
        ['gdaltransform', '-s_srs', EPSG_ORIGEN, '-t_srs', 'EPSG:4326'],
        input=entrada, capture_output=True, text=True, check=True,
    )
    salida = []
    for linea in res.stdout.splitlines():
        partes = linea.split()
        if len(partes) >= 2:
            salida.append((float(partes[0]), float(partes[1])))
    if len(salida) != len(pares):
        raise SystemExit('gdaltransform devolvió menos puntos de los esperados')
    return salida


def metros(a, b):
    R = 6371000.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp = math.radians(b[1] - a[1])
    dl = math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def cadena_nn(puntos):
    """puntos: [(lon, lat, z)] -> misma lista ordenada a lo largo de la línea."""
    n = len(puntos)
    if n <= 2:
        return list(range(n))
    d = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            m = metros(puntos[i][:2], puntos[j][:2])
            d[i][j] = d[j][i] = m
    minnn = [sorted(row)[1] for row in d]
    candidatos = sorted(range(n), key=lambda i: -minnn[i])[:4]
    mejor, mejor_score = None, None
    for start in candidatos:
        usado = {start}
        cadena = [start]
        actual = start
        while len(cadena) < n:
            nxt = min((j for j in range(n) if j not in usado), key=lambda j: d[actual][j])
            usado.add(nxt)
            cadena.append(nxt)
            actual = nxt
        saltos = [d[cadena[k]][cadena[k + 1]] for k in range(n - 1)]
        score = (max(saltos), sum(saltos))
        if mejor_score is None or score < mejor_score:
            mejor, mejor_score = cadena, score
    return mejor


def nombre_sector(layer):
    base = layer
    if base.startswith('sector'):
        base = base.split('_', 1)[1] if '_' in base else base
    return base.replace('_', ' ').replace('-', ' ').strip().capitalize()


def main():
    if not os.path.exists(SHP):
        raise SystemExit(f'falta {SHP}')
    if not os.path.exists(DBF):
        raise SystemExit(f'falta {DBF}')
    pts = leer_shp(SHP)
    attrs = leer_dbf(DBF)
    if len(pts) != len(attrs):
        raise SystemExit(f'shp/dbf desalineados: {len(pts)} vs {len(attrs)}')
    print(f'puntos: {len(pts)}')

    lonlat = a_wgs84([(x, y) for x, y, _ in pts])

    sectores = {}
    for i, ((lon, lat), (_, _, z), a) in enumerate(zip(lonlat, pts, attrs)):
        sec = a.get('layer') or 'sin_sector'
        sectores.setdefault(sec, []).append((lon, lat, z, a.get('Elevation') or z))

    features = []
    total_saltos = []
    for sec, items in sorted(sectores.items()):
        puntos = [(it[0], it[1], it[2]) for it in items]
        orden = cadena_nn(puntos)
        cadena = [puntos[k] for k in orden]
        saltos = [metros(cadena[k][:2], cadena[k + 1][:2]) for k in range(len(cadena) - 1)]
        total_saltos.extend(saltos)
        z = [round(c[2], 2) for c in cadena]
        validos = [v for v in z if v > 0]
        props = {
            'sector': sec,
            'nombre': nombre_sector(sec),
            'n_puntos': len(cadena),
            'cota_min': round(min(validos), 2) if validos else 0,
            'cota_max': round(max(validos), 2) if validos else 0,
            'cota_med': round(sum(validos) / len(validos), 2) if validos else 0,
            'z': z,
        }
        features.append({
            'type': 'Feature',
            'properties': props,
            'geometry': {
                'type': 'LineString',
                'coordinates': [[round(c[0], 7), round(c[1], 7)] for c in cadena],
            },
        })
        if saltos:
            print(
                f'  {sec}: {len(cadena)} pts, salto med {sorted(saltos)[len(saltos)//2]:.0f} m, '
                f'max {max(saltos):.0f} m, cotas {props["cota_min"]}–{props["cota_max"]}'
            )
        else:
            print(f'  {sec}: {len(cadena)} pts (sin saltos)')

    fc = {'type': 'FeatureCollection', 'features': features}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(fc, f, separators=(',', ':'), ensure_ascii=False)
    vertices = sum(len(f['geometry']['coordinates']) for f in features)
    sin_cota = sum(1 for f in features for z in f['properties']['z'] if z <= 0)
    print(f'features: {len(features)}, vértices: {vertices}, cotas=0: {sin_cota}')
    print(f'salto global: med {sorted(total_saltos)[len(total_saltos)//2]:.0f} m, '
          f'max {max(total_saltos):.0f} m')
    print(f'escrito: {OUT} ({os.path.getsize(OUT)} bytes)')


if __name__ == '__main__':
    sys.exit(main())
