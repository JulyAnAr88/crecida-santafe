import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { publicUrl } from '../lib/publicUrl.js';

const SATELLITE =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg';
const DEM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const STYLE = 'https://tiles.openfreemap.org/styles/positron';

const COLOR_EDIFICIO = '#d5e0e8';
const COLOR_AFECTADO = '#dc2626';

export default function Mapa({
  cfg,
  flood,
  vista3d,
  satelite,
  zonas,
  capas,
  terraplenes,
  foco,
  nivel,
  onEdificios,
}) {
  const cont = useRef(null);
  const map = useRef(null);
  const marcador = useRef(null);
  const [ready, setReady] = useState(false);
  const cotas = useRef(null);
  const nivelRef = useRef(nivel);
  const onEdificiosRef = useRef(onEdificios);
  nivelRef.current = nivel;
  onEdificiosRef.current = onEdificios;

  const refrescar = useCallback(() => {
    const m = map.current;
    const arr = cotas.current;
    if (arr) {
      let lo = 0;
      let hi = arr.length;
      const n = nivelRef.current ?? 0;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= n) lo = mid + 1;
        else hi = mid;
      }
      onEdificiosRef.current?.({ total: arr.length, afectados: lo });
    }
    if (!m || !m.getLayer('edificios-3d')) return;
    m.setPaintProperty('edificios-3d', 'fill-extrusion-color', [
      'case',
      ['<=', ['coalesce', ['get', 'alc'], 999], nivelRef.current ?? 0],
      COLOR_AFECTADO,
      COLOR_EDIFICIO,
    ]);
  }, []);

  useEffect(() => {
    let cancelado = false;
    fetch(
      publicUrl('data/edificios-alcance.bin'),
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (cancelado) return;
        cotas.current = new Float32Array(buf);
        refrescar();
      })
      .catch(() => {
        if (!cancelado) {
          onEdificiosRef.current?.({ total: 0, afectados: 0, error: true });
        }
      });
    return () => {
      cancelado = true;
    };
  }, [refrescar]);

  useEffect(() => {
    const m = new maplibregl.Map({
      container: cont.current,
      style: STYLE,
      center: vista3d ? (cfg.centro3d ?? cfg.centro) : cfg.centro,
      zoom: vista3d ? (cfg.zoom3d ?? cfg.zoom) : cfg.zoom,
      pitch: vista3d ? 55 : 0,
      bearing: vista3d ? -18 : 0,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    map.current = m;
    if (import.meta.env.DEV) window.__mapa = m;

    m.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'bottom-right',
    );
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    m.on('load', () => {
      m.addSource('satelite', {
        type: 'raster',
        tiles: [SATELLITE],
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Sentinel-2 cloudless © EOX',
      });
      m.addLayer({
        id: 'satelite',
        type: 'raster',
        source: 'satelite',
      });

      m.addSource('terreno', {
        type: 'raster-dem',
        tiles: [DEM_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
        attribution: 'Relieve: Mapzen · SRTM/Copernicus',
      });
      m.addLayer({
        id: 'relieve',
        type: 'hillshade',
        source: 'terreno',
        paint: {
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': '#04121c',
          'hillshade-highlight-color': '#cfe6f2',
          'hillshade-accent-color': '#1b3a4a',
        },
        layout: { visibility: 'none' },
      });

      m.addSource('agua-base', {
        type: 'geojson',
        data: publicUrl('data/agua-permanente.geojson'),
        attribution: 'Hidrografía: Overture Maps · OpenStreetMap',
      });
      m.addLayer({
        id: 'agua-base-fill',
        type: 'fill',
        source: 'agua-base',
        paint: {
          'fill-color': '#1b6f95',
          'fill-opacity': 0.55,
        },
      });
      m.addLayer({
        id: 'agua-base-line',
        type: 'line',
        source: 'agua-base',
        filter: ['==', '$type', 'LineString'],
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#7dd3fc',
          'line-width': 0.8,
          'line-opacity': 0.5,
        },
      });

      for (const tipo of ['distritos', 'vecinales', 'seguridad', 'terraplenes']) {
        const atribucion =
          tipo === 'terraplenes'
            ? 'Terraplenes: Municipalidad de Santa Fe (levantamiento 2020)'
            : tipo === 'seguridad'
              ? 'Zona de seguridad hídrica: Municipalidad de Santa Fe'
              : 'Distritos y vecinales: Municipalidad de Santa Fe';
        m.addSource(tipo, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          attribution: atribucion,
        });
        if (tipo === 'distritos' || tipo === 'vecinales') {
          m.addSource(`${tipo}-etiquetas`, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }
      }

      m.addLayer({
        id: 'distrito-fill',
        type: 'fill',
        source: 'distritos',
        paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.05 },
        layout: { visibility: 'none' },
      });
      m.addLayer({
        id: 'distrito-line',
        type: 'line',
        source: 'distritos',
        paint: {
          'line-color': '#67cdf5',
          'line-width': 1.4,
          'line-opacity': 0.7,
          'line-dasharray': [5, 3],
        },
        layout: { visibility: 'none' },
      });
      m.addLayer({
        id: 'vecinal-fill',
        type: 'fill',
        source: 'vecinales',
        paint: { 'fill-color': '#c084fc', 'fill-opacity': 0.035 },
        layout: { visibility: 'none' },
      });
      m.addLayer({
        id: 'vecinal-line',
        type: 'line',
        source: 'vecinales',
        paint: {
          'line-color': '#d8b4fe',
          'line-width': 0.8,
          'line-opacity': 0.5,
        },
        layout: { visibility: 'none' },
      });

      m.addLayer({
        id: 'seguridad-fill',
        type: 'fill',
        source: 'seguridad',
        layout: { visibility: 'none' },
        paint: {
          'fill-color': '#f97316',
          'fill-opacity': 0.1,
        },
      });
      m.addLayer({
        id: 'seguridad-line',
        type: 'line',
        source: 'seguridad',
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#fb923c',
          'line-width': 1.2,
          'line-opacity': 0.85,
          'line-dasharray': [4, 3],
        },
      });

      m.addSource('agua', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: 'agua-fill',
        type: 'fill',
        source: 'agua',
        paint: {
          'fill-color': '#2b9fe0',
          'fill-opacity': 0.5,
        },
      });
      m.addLayer({
        id: 'agua-borde',
        type: 'line',
        source: 'agua',
        paint: {
          'line-color': '#9fe0ff',
          'line-width': 1,
          'line-opacity': 0.8,
        },
      });

      m.addLayer({
        id: 'terraplenes-borde',
        type: 'line',
        source: 'terraplenes',
        layout: {
          visibility: 'none',
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#451a03',
          'line-width': 5,
          'line-opacity': 0.85,
        },
      });
      m.addLayer({
        id: 'terraplenes-linea',
        type: 'line',
        source: 'terraplenes',
        layout: {
          visibility: 'none',
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 2.4,
          'line-opacity': 1,
        },
      });

      m.addLayer({
        id: 'distrito-label',
        type: 'symbol',
        source: 'distritos-etiquetas',
        layout: {
          visibility: 'none',
          'text-field': ['get', 'nombre'],
          'text-size': 12,
          'text-letter-spacing': 0.06,
        },
        paint: {
          'text-color': '#e6f6ff',
          'text-halo-color': '#06131b',
          'text-halo-width': 2.4,
        },
      });
      m.addLayer({
        id: 'vecinal-label',
        type: 'symbol',
        source: 'vecinales-etiquetas',
        minzoom: 12.8,
        layout: {
          visibility: 'none',
          'text-field': ['get', 'nombre'],
          'text-size': 9.5,
          'text-max-width': 7,
          'text-padding': 4,
        },
        paint: {
          'text-color': '#efe7ff',
          'text-halo-color': '#06131b',
          'text-halo-width': 1.8,
          'text-opacity': 0.9,
        },
      });

      m.addSource('edificios', {
        type: 'vector',
        tiles: [publicUrl('tiles/{z}/{x}/{y}.pbf')],
        minzoom: 13,
        maxzoom: 15,
        bounds: cfg.bboxTiles ?? cfg.bbox,
        attribution: 'Edificios 3D (cota ≤ 18 m): Municipalidad de Santa Fe y Overture Maps',
      });
      m.addLayer(
        {
          id: 'edificios-3d',
          type: 'fill-extrusion',
          source: 'edificios',
          'source-layer': 'edificios',
          minzoom: 13,
          layout: { visibility: 'none' },
          paint: {
            'fill-extrusion-color': [
              'case',
              ['<=', ['coalesce', ['get', 'alc'], 999], nivelRef.current ?? 0],
              COLOR_AFECTADO,
              COLOR_EDIFICIO,
            ],
            'fill-extrusion-height': [
              'max',
              2.5,
              ['coalesce', ['get', 'a'], 2.5],
            ],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.9,
            'fill-extrusion-vertical-gradient': true,
          },
        },
        'distrito-label',
      );
      refrescar();
      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        offset: 10,
        maxWidth: '260px',
      });

      const abrirPopup = (e, tipo, numero) => {
        const props = e.features?.[0]?.properties ?? {};
        const el = document.createElement('div');
        el.className = 'popup-zona';
        const cab = document.createElement('div');
        cab.className = 'popup-zona__tipo';
        cab.textContent = numero ? `${tipo} n.º ${numero}` : tipo;
        const nom = document.createElement('strong');
        nom.className = 'popup-zona__nombre';
        nom.textContent =
          props.nombre ??
          props.zona_seguridad_hidrica ??
          (props.id != null ? `n.º ${props.id}` : 'Sin nombre');
        el.append(cab, nom);
        popup.setLngLat(e.lngLat).setDOMContent(el).addTo(m);
      };

      for (const [capa, tipo] of [
        ['distrito-fill', 'Distrito municipal'],
        ['vecinal-fill', 'Vecinal'],
        ['seguridad-fill', 'Zona de seguridad hídrica'],
      ]) {
        m.on('click', capa, (e) => {
          const numero = e.features?.[0]?.properties?.numero;
          abrirPopup(e, tipo, numero);
        });
        m.on('mouseenter', capa, () => {
          m.getCanvas().style.cursor = 'pointer';
        });
        m.on('mouseleave', capa, () => {
          m.getCanvas().style.cursor = '';
        });
      }

      const popupTerraplen = (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties ?? {};
        const fmt1 = (v) => Number(v).toFixed(1).replace('.', ',');
        const el = document.createElement('div');
        el.className = 'popup-zona';
        const cab = document.createElement('div');
        cab.className = 'popup-zona__tipo';
        cab.textContent = 'Terraplén';
        const nom = document.createElement('strong');
        nom.className = 'popup-zona__nombre';
        nom.textContent = p.nombre ?? p.sector ?? '—';
        const det = document.createElement('div');
        det.className = 'popup-edificio';
        const filas = [];
        if (Number(p.cota_min) > 0) {
          filas.push(
            `Cota: ${fmt1(p.cota_min)}–${fmt1(p.cota_max)} m (media ${fmt1(p.cota_med)})`,
          );
        } else {
          filas.push('Cota sin dato');
        }
        filas.push(`Puntos de levantamiento: ${p.n_puntos ?? '—'}`);
        det.innerHTML = filas.map((t) => `<span>${t}</span>`).join('');
        el.append(cab, nom, det);
        popup.setLngLat(e.lngLat).setDOMContent(el).addTo(m);
      };
      for (const capa of ['terraplenes-linea', 'terraplenes-borde']) {
        m.on('click', capa, popupTerraplen);
        m.on('mouseenter', capa, () => {
          m.getCanvas().style.cursor = 'pointer';
        });
        m.on('mouseleave', capa, () => {
          m.getCanvas().style.cursor = '';
        });
      }

      m.on('click', 'edificios-3d', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const cota = Number(f.properties?.cota);
        const altura = Number(f.properties?.a) || null;
        const estimada = f.properties?.e === 1;
        const el = document.createElement('div');
        el.className = 'popup-zona';
        const cab = document.createElement('div');
        cab.className = 'popup-zona__tipo';
        cab.textContent = 'Edificio';
        const det = document.createElement('div');
        det.className = 'popup-edificio';
        const filas = [];
        if (altura) {
          filas.push(
            `Altura${estimada ? ' estimada' : ''}: ${altura.toLocaleString('es-AR')} m`,
          );
        }
        const alc = Number(f.properties?.alc);
        if (Number.isFinite(cota) && cota < 100000) {
          filas.push(`Cota del terreno: ${cota.toFixed(1).replace('.', ',')} m`);
          if (Number.isFinite(alc) && alc < 900) {
            filas.push(
              alc <= nivelRef.current
                ? 'Bajo el agua simulada'
                : `Se alcanza con agua desde ${alc.toFixed(1).replace('.', ',')} m de elevación`,
            );
          } else {
            filas.push('No alcanzado con el rango del simulador');
          }
        } else {
          filas.push('Cota sin calcular');
        }
        det.innerHTML = filas
          .map((t, i) => (i === filas.length - 1 && Number.isFinite(cota) && cota < 100000 ? `<strong>${t}</strong>` : `<span>${t}</span>`))
          .join('');
        el.append(cab, det);
        popup.setLngLat(e.lngLat).setDOMContent(el).addTo(m);
      });
      m.on('mouseenter', 'edificios-3d', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'edificios-3d', () => {
        m.getCanvas().style.cursor = '';
      });

      const el = document.createElement('div');
      el.className = 'marcador-hidrometro';
      el.innerHTML =
        '<span class="marcador-hidrometro__punto"></span>' +
        '<span class="marcador-hidrometro__etiqueta">Hidrómetro<br><strong>Puerto Santa Fe</strong></span>';
      marcador.current = new maplibregl.Marker({
        element: el,
        anchor: 'left',
        offset: [12, 0],
      })
        .setLngLat(cfg.hidrometro.posicion)
        .addTo(m);

      const elSalado = document.createElement('div');
      elSalado.className = 'marcador-estacion';
      elSalado.innerHTML =
        '<span class="marcador-estacion__punto"></span>' +
        '<span class="marcador-estacion__etiqueta">Recreo<br><strong>Río Salado</strong></span>';
      new maplibregl.Marker({
        element: elSalado,
        anchor: 'left',
        offset: [12, 0],
      })
        .setLngLat(cfg.salado.posicion)
        .addTo(m);

      setReady(true);
    });

    return () => {
      marcador.current = null;
      m.remove();
      map.current = null;
    };
  }, [cfg]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setLayoutProperty('satelite', 'visibility', satelite ? 'visible' : 'none');
  }, [satelite, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    if (vista3d) {
      m.setTerrain({ source: 'terreno', exaggeration: 2.2 });
      m.setLayoutProperty('relieve', 'visibility', 'visible');
      m.setLayoutProperty('edificios-3d', 'visibility', 'visible');
      m.easeTo({
        center: cfg.centro3d ?? cfg.centro,
        pitch: 58,
        bearing: -18,
        zoom: Math.max(m.getZoom(), cfg.zoom3d ?? 14.2),
        duration: 900,
      });
    } else {
      m.setTerrain(null);
      m.setLayoutProperty('relieve', 'visibility', 'none');
      m.setLayoutProperty('edificios-3d', 'visibility', 'none');
      m.easeTo({ pitch: 0, bearing: 0, duration: 900 });
    }
  }, [vista3d, ready, cfg]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const src = m.getSource('agua');
    if (!src) return;
    src.setData(flood?.geojson ?? { type: 'FeatureCollection', features: [] });
  }, [flood, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !zonas) return;
    for (const tipo of ['distritos', 'vecinales', 'seguridad']) {
      const datos = zonas[tipo];
      if (!datos) continue;
      m.getSource(tipo)?.setData(datos.geojson);
      m.getSource(`${tipo}-etiquetas`)?.setData(datos.etiquetas);
    }
  }, [zonas, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !terraplenes) return;
    m.getSource('terraplenes')?.setData(terraplenes);
  }, [terraplenes, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !capas) return;
    const visibilidad = {
      distritos: ['distrito-fill', 'distrito-line', 'distrito-label'],
      vecinales: ['vecinal-fill', 'vecinal-line', 'vecinal-label'],
      seguridad: ['seguridad-fill', 'seguridad-line'],
      terraplenes: ['terraplenes-borde', 'terraplenes-linea'],
    };
    for (const [tipo, ids] of Object.entries(visibilidad)) {
      const vis = capas[tipo] ? 'visible' : 'none';
      for (const id of ids) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis);
      }
    }
  }, [capas, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !foco) return;
    m.flyTo({ center: foco.pos, zoom: Math.max(m.getZoom(), 13.4), duration: 1600 });
  }, [foco, ready]);

  useEffect(() => {
    refrescar();
  }, [nivel, refrescar]);

  return <div className="map" ref={cont} />;
}
