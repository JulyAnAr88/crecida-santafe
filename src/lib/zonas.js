function areaAnillo(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function centroide(ring) {
  let x = 0;
  let y = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
  }
  if (!a) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    ];
  }
  a *= 3;
  return [x / a, y / a];
}

function anilloPrincipal(geometry) {
  const polys =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let mejor = null;
  let mayor = -Infinity;
  for (const poly of polys) {
    if (!poly?.[0]?.length) continue;
    const a = Math.abs(areaAnillo(poly[0]));
    if (a > mayor) {
      mayor = a;
      mejor = poly[0];
    }
  }
  return mejor;
}

function etiquetas(geojson) {
  const features = [];
  for (const f of geojson.features || []) {
    const ring = anilloPrincipal(f.geometry);
    if (!ring) continue;
    const [lng, lat] = centroide(ring);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { ...f.properties },
    });
  }
  return { type: 'FeatureCollection', features };
}

export async function fetchZona(layer, signal) {
  const url =
    'https://geoservicios.santafeciudad.gov.ar/geoserver/publico/wfs' +
    `?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(layer)}` +
    '&outputFormat=application/json&srsName=EPSG:4326&count=1000';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`WFS ${res.status}`);
  const geojson = await res.json();
  if (!geojson?.features?.length) throw new Error('Capa vacía');
  return { geojson, etiquetas: etiquetas(geojson) };
}
