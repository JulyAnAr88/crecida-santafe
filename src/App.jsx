import { useCallback, useEffect, useMemo, useState } from 'react';
import Mapa from './components/Mapa.jsx';
import SerieChart from './components/SerieChart.jsx';
import AnualesChart from './components/AnualesChart.jsx';
import { LOCALIDAD } from './config/santaFe.js';
import historia from './data/historia-santa-fe.json';
import historiaSalado from './data/historia-salado.json';
import { loadDem } from './lib/dem.js';
import { computeFlood } from './lib/flood.js';
import { fetchEstacion, fetchSerie, fetchSalado } from './lib/ina.js';
import { fetchZona } from './lib/zonas.js';
import { publicUrl } from './lib/publicUrl.js';
import { rasterizarTerraplenes } from './lib/terraplenes.js';
import { fmtM, fmtKm2, fmtFecha, fmtFechaHora, fechaDesdeISO } from './lib/format.js';

const cfg = LOCALIDAD;

function estadoDe(v, umbrales) {
  if (Number.isFinite(umbrales.evacuacion) && umbrales.evacuacion > 0 && v >= umbrales.evacuacion)
    return { txt: 'Evacuación', cls: 'evac' };
  if (Number.isFinite(umbrales.alerta) && umbrales.alerta > 0 && v >= umbrales.alerta)
    return { txt: 'Alerta', cls: 'alerta' };
  return { txt: 'Normal', cls: 'ok' };
}

function Gauge({ nivel, live, umbrales }) {
  const MAX = 8;
  const pct = (v) => Math.min(100, Math.max(0, (v / MAX) * 100));
  const conAlerta = Number.isFinite(umbrales.alerta) && umbrales.alerta > 0;
  const conEvac = Number.isFinite(umbrales.evacuacion) && umbrales.evacuacion > 0;
  const pctAlerta = conAlerta ? pct(umbrales.alerta) : 0;
  const pctEvac = conEvac ? pct(umbrales.evacuacion) : 100;
  return (
    <div className="gauge">
      <div className="gauge-riel">
        <div className="gauge-zona normal" style={{ width: `${conAlerta ? pctAlerta : 100}%` }} />
        {conAlerta && (
          <div
            className="gauge-zona alerta"
            style={{ left: `${pctAlerta}%`, width: `${pctEvac - pctAlerta}%` }}
          />
        )}
        {conEvac && (
          <div className="gauge-zona evac" style={{ left: `${pctEvac}%`, right: 0 }} />
        )}
        {live != null && <div className="gauge-live" style={{ left: `${pct(live)}%` }} />}
        {nivel != null && <div className="gauge-marca" style={{ left: `${pct(nivel)}%` }} />}
      </div>
      <div className="gauge-ticks">
        <span style={{ left: '0%' }}>0</span>
        {conAlerta && <span style={{ left: `${pctAlerta}%` }}>{fmtM(umbrales.alerta, 1)}</span>}
        {conEvac && <span style={{ left: `${pctEvac}%` }}>{fmtM(umbrales.evacuacion, 1)}</span>}
        <span className="der" style={{ left: '100%' }}>8 m</span>
      </div>
    </div>
  );
}

export default function App() {
  const [vista3d, setVista3d] = useState(
    () => new URLSearchParams(window.location.search).get('vista') === '3d',
  );
  const [satelite, setSatelite] = useState(true);
  const [estacion, setEstacion] = useState(null);
  const [serie, setSerie] = useState([]);
  const [live, setLive] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [sim, setSim] = useState(null);
  const [tocado, setTocado] = useState(false);
  const [cero, setCero] = useState(cfg.hidrometro.cotaCero_m);
  const [dem, setDem] = useState(null);
  const [demProg, setDemProg] = useState(0);
  const [demError, setDemError] = useState(null);
  const [flood, setFlood] = useState(null);
  const [edificios, setEdificios] = useState(null);
  const [zonas, setZonas] = useState(null);
  const [zonasError, setZonasError] = useState(null);
  const [capas, setCapas] = useState({
    distritos: true,
    vecinales: false,
    seguridad: false,
    terraplenes: false,
  });
  const [salado, setSalado] = useState(null);
  const [saladoError, setSaladoError] = useState(null);
  const [terrapGeo, setTerrapGeo] = useState(null);
  const [barreras, setBarreras] = useState(null);
  const [foco, setFoco] = useState(null);

  const umbrales = useMemo(
    () => ({
      aguasBajas: estacion?.estacion?.nivel_aguas_bajas ?? cfg.umbrales.aguasBajas,
      alerta: estacion?.estacion?.nivel_alerta ?? cfg.umbrales.alerta,
      evacuacion: estacion?.estacion?.nivel_evacuacion ?? cfg.umbrales.evacuacion,
    }),
    [estacion],
  );

  const umbralesSalado = useMemo(
    () => ({
      aguasBajas: salado?.umbrales.aguasBajas ?? null,
      alerta: salado?.umbrales.alerta ?? cfg.salado.umbrales.alerta,
      evacuacion: salado?.umbrales.evacuacion ?? null,
    }),
    [salado],
  );

  useEffect(() => {
    let alive = true;
    async function cargar() {
      try {
        const [meta, datos] = await Promise.all([
          fetchEstacion(cfg.hidrometro.serieId),
          fetchSerie(cfg.hidrometro.serieId, 120),
        ]);
        if (!alive) return;
        setEstacion(meta);
        if (datos.length) setSerie(datos);
        const ultimo = datos[datos.length - 1];
        if (ultimo) {
          setLive({
            valor: ultimo.v,
            fecha: ultimo.t,
            delta: datos.length > 1 ? ultimo.v - datos[datos.length - 2].v : null,
            fuente: 'INA–SIyAH · Prefectura Naval',
          });
        }
        setLiveError(null);
      } catch {
        if (alive) setLiveError('No pudimos consultar el nivel del río en INA.');
      }
    }
    cargar();
    const id = setInterval(cargar, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (live && !tocado) setSim(live.valor);
  }, [live, tocado]);

  useEffect(() => {
    let alive = true;
    async function cargarSalado() {
      try {
        const s = await fetchSalado(120);
        if (alive) {
          setSalado(s);
          setSaladoError(null);
        }
      } catch {
        if (alive) setSaladoError('No pudimos consultar el río Salado en INA.');
      }
    }
    cargarSalado();
    const id = setInterval(cargarSalado, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(publicUrl(cfg.capas.terraplenes))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((g) => {
        if (alive) setTerrapGeo(g);
      })
      .catch(() => {
        // Sin terraplenes el modelo sigue funcionando, sin las barreras.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([
      fetchZona(cfg.capas.distritos, ctrl.signal),
      fetchZona(cfg.capas.vecinales, ctrl.signal),
    ])
      .then(([distritos, vecinales]) => {
        setZonas((prev) => ({ ...(prev || {}), distritos, vecinales }));
        setZonasError(null);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setZonasError('No se pudieron cargar distritos y vecinales.');
      });
    fetchZona(cfg.capas.seguridad, ctrl.signal)
      .then((seguridad) => setZonas((prev) => ({ ...(prev || {}), seguridad })))
      .catch(() => {
        // Capa opcional: si falla, la app sigue sin ella.
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (!live && !tocado && sim == null) setSim(cfg.simulador.inicial_m);
  }, [live, tocado, sim]);

  const cargarDem = useCallback(() => {
    let cancelled = false;
    setDemError(null);
    setDemProg(0);
    setDem(null);
    setFlood(null);
    loadDem({
      bbox: cfg.bbox,
      zoom: cfg.demZoom,
      decimate: cfg.demDecimate,
      onProgress: (p) => {
        if (!cancelled) setDemProg(p);
      },
    })
      .then((d) => {
        if (!cancelled) setDem(d);
      })
      .catch((e) => {
        if (!cancelled) setDemError(e?.message || 'Error al cargar el relieve');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => cargarDem(), [cargarDem]);

  useEffect(() => {
    if (!dem || !terrapGeo) return;
    try {
      setBarreras(rasterizarTerraplenes(terrapGeo, dem));
    } catch {
      setBarreras(null);
    }
  }, [dem, terrapGeo]);

  useEffect(() => {
    if (!dem || sim == null) return;
    let cancelled = false;
    const id = setTimeout(() => {
      const res = computeFlood(
        dem,
        sim + cero,
        cfg.semillasRio,
        cfg.demToleranciaGrados,
        barreras,
      );
      if (!cancelled) setFlood(res);
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [dem, sim, cero, barreras]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('vista', vista3d ? '3d' : '2d');
    url.searchParams.set('localidad', cfg.id);
    window.history.replaceState(null, '', url);
  }, [vista3d]);

  const mostrado = sim ?? live?.valor ?? cfg.simulador.inicial_m;
  const estado = estadoDe(mostrado, umbrales);
  const estadoSalado = salado ? estadoDe(salado.valor, umbralesSalado) : null;

  const setNivel = (v) => {
    const clamped = Math.min(cfg.simulador.max_m, Math.max(cfg.simulador.min_m, v));
    setSim(Number(clamped.toFixed(2)));
    setTocado(true);
  };

  const volverEnVivo = () => {
    setTocado(false);
    if (live) setSim(live.valor);
  };

  const anios = useMemo(
    () =>
      historia.anios
        .filter((a) => a[1] != null)
        .map((a) => ({ anio: a[0], max: a[1], fecha: a[2] })),
    [],
  );
  const top = useMemo(() => [...anios].sort((a, b) => b.max - a.max).slice(0, 6), [anios]);
  const anioActual = new Date().getFullYear();
  const record = top[0];

  const aniosSalado = useMemo(
    () =>
      historiaSalado.anios
        .filter((a) => a[1] != null)
        .map((a) => ({ anio: a[0], max: a[1], fecha: a[2] })),
    [],
  );
  const topSalado = useMemo(
    () => [...aniosSalado].sort((a, b) => b.max - a.max).slice(0, 6),
    [aniosSalado],
  );

  const pMin = cfg.simulador.min_m;
  const pMax = cfg.simulador.max_m;
  const pctAlerta = ((umbrales.alerta - pMin) / (pMax - pMin)) * 100;
  const pctEvac = ((umbrales.evacuacion - pMin) / (pMax - pMin)) * 100;
  const pctRecord = ((record.max - pMin) / (pMax - pMin)) * 100;

  return (
    <div className="app">
      <Mapa
        cfg={cfg}
        flood={flood}
        vista3d={vista3d}
        satelite={satelite}
        zonas={zonas}
        capas={capas}
        terraplenes={terrapGeo}
        foco={foco}
        nivel={mostrado + cero}
        onEdificios={setEdificios}
      />
      <div className="scrim" />

      <div className="controles">
        <div className="seg" role="group" aria-label="Vista del mapa">
          <button type="button" className={!vista3d ? 'on' : ''} onClick={() => setVista3d(false)}>
            2D
          </button>
          <button type="button" className={vista3d ? 'on' : ''} onClick={() => setVista3d(true)}>
            3D
          </button>
        </div>
        <div className="seg" role="group" aria-label="Mapa de base">
          <button type="button" className={satelite ? 'on' : ''} onClick={() => setSatelite(true)}>
            Satélite
          </button>
          <button type="button" className={!satelite ? 'on' : ''} onClick={() => setSatelite(false)}>
            Calles
          </button>
        </div>
        <div className="seg" role="group" aria-label="Capas municipales">
          <button
            type="button"
            className={capas.distritos ? 'on' : ''}
            aria-pressed={capas.distritos}
            onClick={() => setCapas((c) => ({ ...c, distritos: !c.distritos }))}
            title={zonasError || 'Distritos municipales'}
          >
            Distritos
          </button>
          <button
            type="button"
            className={capas.vecinales ? 'on' : ''}
            aria-pressed={capas.vecinales}
            onClick={() => setCapas((c) => ({ ...c, vecinales: !c.vecinales }))}
            title={zonasError || 'Vecinales'}
          >
            Vecinales
          </button>
          <button
            type="button"
            className={capas.seguridad ? 'on' : ''}
            aria-pressed={capas.seguridad}
            onClick={() => setCapas((c) => ({ ...c, seguridad: !c.seguridad }))}
            title={zonasError || 'Zona de seguridad hídrica (Municipalidad)'}
          >
            Seg. hídrica
          </button>
          <button
            type="button"
            className={capas.terraplenes ? 'on' : ''}
            aria-pressed={capas.terraplenes}
            onClick={() => setCapas((c) => ({ ...c, terraplenes: !c.terraplenes }))}
            title="Terraplenes con cotas levantadas (Municipalidad, 2020)"
          >
            Terraplenes
          </button>
        </div>
        {vista3d && (
          <div
            className="leyenda-edificios"
            aria-live="polite"
            title="Edificios 3D en zona inundable (cota ≤ 18 m): Municipalidad de Santa Fe (costa) y Overture Maps"
          >
            <span className="leyenda-edificios__punto" aria-hidden="true" />
            <span>
              {edificios?.error
                ? 'Edificios no disponibles'
                : edificios?.total > 0
                  ? `${edificios.afectados.toLocaleString('es-AR')} edificios afectados`
                  : 'Cargando edificios…'}
            </span>
            {edificios?.total > 0 && (
              <small>
                de {edificios.total.toLocaleString('es-AR')} en zona inundable
              </small>
            )}
          </div>
        )}
      </div>

      <aside className="sidebar">
        <section className="card nivel-card">
          <div className="marca">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M4 25c5-6 10-6 15 0s10 6 17 0" />
              <path d="M4 16c5-6 10-6 15 0s10 6 17 0" opacity=".55" />
            </svg>
            <div className="marca-txt">
              <strong>Crecida</strong>
              <span>Santa Fe · río Paraná</span>
            </div>
          </div>

          <div className="eyebrow">
            {tocado ? 'Nivel simulado' : 'Nivel del río'} · {cfg.hidrometro.nombre}
          </div>
          <div className="nivel-linea">
            <span className="nivel-valor">{live || sim != null ? fmtM(mostrado) : '—'}</span>
            <span className="nivel-unidad">m</span>
            <span className={`chip ${estado.cls}`}>{estado.txt}</span>
          </div>

          <div className="nivel-sub">
            {tocado ? (
              <>
                Simulación
                {live ? <> · en vivo {fmtM(live.valor)} m</> : null}
                <button type="button" className="link" onClick={volverEnVivo}>
                  Volver a en vivo
                </button>
              </>
            ) : live ? (
              <>
                {live.delta != null && (
                  <span className={live.delta >= 0 ? 'sube' : 'baja'}>
                    {live.delta >= 0 ? '▲' : '▼'} {fmtM(Math.abs(live.delta))} m vs. día anterior
                  </span>
                )}
                <span className="sep">·</span>
                <span>{live.fuente}</span>
              </>
            ) : (
              liveError || 'Consultando el nivel…'
            )}
          </div>

          <Gauge nivel={mostrado} live={tocado ? live?.valor ?? null : null} umbrales={umbrales} />

          <div className="nivel-pie">
            <span>Último dato: {live ? fmtFechaHora(live.fecha) : '—'}</span>
            <span className="sep">·</span>
            <span>Serie INA n.º {cfg.hidrometro.serieId}</span>
          </div>
        </section>

        <section className="card">
          <div className="card-cabecera">
            <h2>Simulá el nivel</h2>
            <span className={`lectura ${tocado ? 'sim' : ''}`}>{fmtM(mostrado)} m</span>
          </div>

          <input
            className="slider"
            type="range"
            min={pMin}
            max={pMax}
            step={cfg.simulador.paso_m}
            value={sim ?? cfg.simulador.inicial_m}
            onChange={(e) => setNivel(Number(e.target.value))}
            aria-label="Nivel simulado del río en metros"
            style={{
              '--p-alerta': `${pctAlerta}%`,
              '--p-evac': `${pctEvac}%`,
              '--p-record': `${Math.min(100, pctRecord)}%`,
            }}
          />
          <div className="escala">
            <span style={{ left: '0%' }}>{fmtM(pMin, 0)} m</span>
            <span style={{ left: `${pctAlerta}%` }}>alerta</span>
            <span style={{ left: `${pctEvac}%` }}>evacuación</span>
            <span style={{ left: '100%' }}>{fmtM(pMax, 0)} m</span>
          </div>

          <div className="acciones">
            <button type="button" onClick={() => setNivel(umbrales.alerta)}>
              Alerta {fmtM(umbrales.alerta)}
            </button>
            <button type="button" onClick={() => setNivel(umbrales.evacuacion)}>
              Evacuación {fmtM(umbrales.evacuacion)}
            </button>
            <button type="button" onClick={() => setNivel(record.max)}>
              Récord {record.anio} · {fmtM(record.max)}
            </button>
          </div>

          <div className="flood-info">
            {demError ? (
              <span className="error">
                No se pudo cargar el relieve: {demError}.{' '}
                <button type="button" className="link" onClick={cargarDem}>
                  Reintentar
                </button>
              </span>
            ) : !dem ? (
              <span>
                Cargando relieve del río… {Math.round(demProg * 100)}%
                <span className="progreso">
                  <span style={{ width: `${Math.round(demProg * 100)}%` }} />
                </span>
              </span>
            ) : (
              <span>
                <strong>{fmtKm2(flood?.areaKm2)} km²</strong> anegados según el modelo
              </span>
            )}
          </div>

          <details className="calibracion">
            <summary>Cota del cero del hidrómetro</summary>
            <div className="calib-fila">
              <input
                type="number"
                step="0.05"
                min="0"
                max="20"
                value={cero}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setCero(v);
                }}
              />
              <span>m IGN</span>
              <button type="button" className="link" onClick={() => setCero(cfg.hidrometro.cotaCero_m)}>
                Oficial {fmtM(cfg.hidrometro.cotaCero_m, 3)} m
              </button>
            </div>
            <p>
              El hidrómetro mide sobre su cero, a {fmtM(cero, 3)} m sobre el cero IGN. El
              relieve satelital tiene un margen de error de décimas de metro: si el agua no
              coincide con la costa, ajustá este valor.
            </p>
          </details>
        </section>

        <section className="card">
          <div className="card-cabecera">
            <h2>Nivel reciente</h2>
            <span className="sub">INA · diario</span>
          </div>
          <SerieChart serie={serie} umbrales={umbrales} />
        </section>

        <section className="card">
          <div className="card-cabecera">
            <h2>Máximas anuales</h2>
            <span className="sub">1925–2025</span>
          </div>
          <AnualesChart
            anios={anios}
            umbrales={umbrales}
            anioActual={anioActual}
            onSelect={(a) => setNivel(a.max)}
          />
          <div className="historicas">
            {top.map((a) => (
              <button type="button" className="hist-row" key={a.anio} onClick={() => setNivel(a.max)}>
                <span className="hist-anio">{a.anio}</span>
                <span className="hist-fecha">{fmtFecha(fechaDesdeISO(a.fecha))}</span>
                <span className="hist-altura">{fmtM(a.max)} m</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card nivel-card nivel-salado">
          <div className="eyebrow">
            Nivel del río · {cfg.salado.rio} — {cfg.salado.nombre}
          </div>
          <div className="nivel-linea">
            <span className="nivel-valor">{salado ? fmtM(salado.valor) : '—'}</span>
            <span className="nivel-unidad">m</span>
            {estadoSalado && <span className={`chip ${estadoSalado.cls}`}>{estadoSalado.txt}</span>}
          </div>
          <div className="nivel-sub">
            {saladoError ? (
              <span className="error">{saladoError}</span>
            ) : salado ? (
              <>
                {salado.delta != null && (
                  <span className={salado.delta >= 0 ? 'sube' : 'baja'}>
                    {salado.delta >= 0 ? '▲' : '▼'} {fmtM(Math.abs(salado.delta))} m vs. lectura
                    anterior
                  </span>
                )}
                <span className="sep">·</span>
                <span>{salado.fuente}</span>
              </>
            ) : (
              'Consultando el nivel…'
            )}
          </div>
          <Gauge
            nivel={salado?.valor ?? null}
            live={salado?.valor ?? null}
            umbrales={umbralesSalado}
          />
          <div className="nivel-pie">
            <span>Último dato: {salado?.fecha ? fmtFechaHora(salado.fecha) : '—'}</span>
            <span className="sep">·</span>
            <span>Serie INA n.º {cfg.salado.serieId}</span>
            <span className="sep">·</span>
            <span>cero IGN {fmtM(cfg.salado.ceroIgn, 2)} m</span>
            <button
              type="button"
              className="link"
              onClick={() => setFoco({ n: Date.now(), pos: cfg.salado.posicion })}
            >
              Ver en el mapa
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-cabecera">
            <h2>Nivel reciente · Río Salado</h2>
            <span className="sub">INA · diario</span>
          </div>
          <SerieChart serie={salado?.serie ?? []} umbrales={umbralesSalado} />
        </section>

        <section className="card">
          <div className="card-cabecera">
            <h2>Máximas anuales · Río Salado</h2>
            <span className="sub">
              {aniosSalado.length
                ? `${aniosSalado[0].anio}–${aniosSalado[aniosSalado.length - 1].anio} · Recreo`
                : 'Recreo'}
            </span>
          </div>
          <AnualesChart
            anios={aniosSalado}
            umbrales={umbralesSalado}
            lo={2}
            hi={8}
            anioActual={anioActual}
          />
          <div className="historicas">
            {topSalado.map((a) => (
              <div className="hist-row static" key={a.anio}>
                <span className="hist-anio">{a.anio}</span>
                <span className="hist-fecha">{fmtFecha(fechaDesdeISO(a.fecha))}</span>
                <span className="hist-altura">{fmtM(a.max)} m</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card pie-card">
          <p>
            <strong>Estimación, no pronóstico oficial.</strong> El mapa inunda el terreno del
            DEM (~30 m) hasta el nivel elegido: los terraplenes actúan como barrera con su cota
            levantada y no se modelan bombas, compuertas ni lluvia local. Tocá el gráfico o las
            crecidas para simular.
          </p>
          <p className="fuentes">
            {cfg.fuentes.map((f, i) => (
              <span key={f.url}>
                {i > 0 && <span className="sep">·</span>}
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.nombre}
                </a>
              </span>
            ))}
          </p>
          <p className="fuentes creditos">
            Relieve: Mapzen Terrain Tiles (SRTM/Copernicus). Imágenes: Sentinel-2 cloudless ©
            EOX. Calles: OpenFreeMap · © OpenMapTiles · © OpenStreetMap. Edificios 3D en zona inundable:
            Municipalidad de Santa Fe y Overture Maps.
          </p>
        </section>
      </aside>
    </div>
  );
}
