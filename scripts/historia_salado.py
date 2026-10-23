#!/usr/bin/env python3
"""Regenera src/data/historia-salado.json (máximas anuales, estación Recreo).

Lee toda la serie puntual103 de la API a5 del INA y agrupa por año.

Uso: python3 scripts/historia_salado.py
"""
import datetime
import json
import os
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(RAIZ, 'src', 'data', 'historia-salado.json')
URL = (
    'https://alerta.ina.gob.ar/a5/obs/puntual/observaciones'
    '?series_id=103&timestart=1900-01-01&timeend=2100-01-01&format=json'
)


def main():
    with urllib.request.urlopen(URL, timeout=180) as res:
        datos = json.load(res)
    obs = [o for o in datos if o.get('valor') is not None]
    if not obs:
        raise SystemExit('sin observaciones de la serie103')
    mejor = {}
    for o in obs:
        anio = o['timestart'][:4]
        v = float(o['valor'])
        if anio not in mejor or v > mejor[anio][0]:
            mejor[anio] = (v, o['timestart'][:10])
    out = {
        'fuente': (
            'Instituto Nacional del Agua — SIyAH, serie103 (altura hidrométrica), '
            'Recreo - Ruta Provincial nº 70, río Salado'
        ),
        'url': URL,
        'estacion': {
            'nombre': 'Recreo - Ruta Provincial nº 70',
            'id': 103,
            'rio': 'Río Salado',
            'cero_ign_ina': 11.09,
        },
        'unidad': 'm',
        'alerta': 4.7,
        'generado': datetime.date.today().isoformat(),
        'desde': min(a for a in mejor),
        'hasta': max(mejor[a][1] for a in mejor),
        'anios': [[int(a), mejor[a][0], mejor[a][1]] for a in sorted(mejor)],
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'{len(out["anios"])} años -> {OUT} ({os.path.getsize(OUT)} bytes)')


if __name__ == '__main__':
    main()
