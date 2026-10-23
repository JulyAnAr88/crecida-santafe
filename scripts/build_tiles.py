import duckdb, math, os, sys, time, shutil
con=duckdb.connect(os.environ.get('EDIFICIOS_DB', '/tmp/opencode/edificios_final.duckdb'))
for ext in ('httpfs','spatial'):
    con.execute(f'LOAD {ext}')
con.execute('SET geometry_always_xy=true')
# Este bbox define src/config/santaFe.js -> bboxTiles (bounds de la fuente
# vectorial en Mapa.jsx): si cambia acá, cambiarlo también ahí.
out='/home/july/temp/crecida-santa-fe/public/tiles'
shutil.rmtree(out, ignore_errors=True)
lon0,lat0,lon1,lat1=-60.785,-31.70,-60.575,-31.55
R=20037508.342789244
def lonlat_to_tile(lon,lat,z):
    n=2**z
    x=(lon+180)/360*n
    y=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*n
    return x,y
def tile_bounds(x,y,z):
    n=2**z
    lo0=x/n*360-180; lo1=(x+1)/n*360-180
    def lat_of(yy): return math.degrees(math.atan(math.sinh(math.pi*(1-2*yy/n))))
    return lo0,lat_of(y+1),lo1,lat_of(y)
total_bytes=0; total_tiles=0; max_bytes=0
t_start=time.time()
for z in (13,14,15):
    n=2**z
    x0=int(lonlat_to_tile(lon0,lat0,z)[0]); x1=int(lonlat_to_tile(lon1,lat1,z)[0])
    y0=int(lonlat_to_tile(lon0,lat1,z)[1]); y1=int(lonlat_to_tile(lon0,lat0,z)[1])
    ts=2*R/n
    zbytes=0; ztiles=0
    for x in range(x0,x1+1):
        for y in range(y0,y1+1):
            lo0,la0,lo1,la1=tile_bounds(x,y,z)
            xm=-R+x*ts; xM=-R+(x+1)*ts; yM=R-y*ts; ym=R-(y+1)*ts
            box=f'ST_MakeBox2D(ST_Point({xm},{ym}), ST_Point({xM},{yM}))'
            q=f"""
            WITH t AS (
              SELECT id, a, e, cota, alc,
                ST_AsMVTGeom(ST_Transform(geom,'EPSG:4326','EPSG:3857'), {box}, 4096, 64, true) AS geom
              FROM edificios
              WHERE x1 >= {lo0} AND x0 <= {lo1} AND y1 >= {la0} AND y0 <= {la1}
            )
            SELECT ST_AsMVT(t,'edificios',4096,'geom','id') AS mvt FROM t
            """
            blob=con.execute(q).fetchone()[0]
            if not blob: continue
            b=bytes(blob)
            d=f'{out}/{z}/{x}'
            os.makedirs(d,exist_ok=True)
            open(f'{d}/{y}.pbf','wb').write(b)
            zbytes+=len(b); ztiles+=1; total_bytes+=len(b); total_tiles+=1
            if len(b)>max_bytes: max_bytes=len(b)
    print(f'z{z}: {ztiles} tiles, {zbytes/1e6:.1f} MB, {round(time.time()-t_start,1)}s', flush=True)
print('TOTAL', total_tiles, 'tiles', round(total_bytes/1e6,1), 'MB', 'max', max_bytes, 'bytes', round(time.time()-t_start,1),'s')
