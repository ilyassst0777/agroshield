"""SoilGrids WCS 2.0.1 client. Raster sampling is on the SERVER, not in JS.

ISRIC WCS uses the custom Goode Homolosine CRS identified by OGC as EPSG/0/152160;
PROJ recognizes its equivalent as ESRI:54052. We request in the server's CRS
and read the GeoTIFF via rasterio, sampling pixels within the actual field.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.io import MemoryFile
from pyproj import Transformer
from shapely.geometry import Polygon, Point, mapping, shape
from shapely.ops import transform
import requests

WCS = 'https://maps.isric.org/mapserv'
OGC_CRS = 'http://www.opengis.net/def/crs/EPSG/0/152160'
LOCAL_CRS = 'ESRI:54052'  # Goode Homolosine, matches SoilGrids custom 152160
DEPTH = '5-15cm'
RASTER_PROPERTIES = {
    'ph': ('phh2o', 10, 'pH'),
    'soc_g_kg': ('soc', 10, 'g/kg'),
    'sand_pct': ('sand', 100, '%'),
    'silt_pct': ('silt', 100, '%'),
    'clay_pct': ('clay', 100, '%'),
}
CACHE_DIR = Path(__file__).resolve().parent / 'cache'
CACHE_DIR.mkdir(exist_ok=True)
TRANSFORM = Transformer.from_crs('EPSG:4326', LOCAL_CRS, always_xy=True)

class SoilError(RuntimeError):
    pass


def query_region(lat: float, lon: float, geometry=None):
    """Create a projected polygon and trimmed bbox; avoid huge accidental requests."""
    if not (-90 < lat < 90 and -180 <= lon <= 180):
        raise SoilError('Некорректные координаты поля')
    if geometry:
        if geometry.get('type') not in {'Polygon', 'MultiPolygon'}:
            raise SoilError('Поддерживаются только контуры Polygon и MultiPolygon')
        try:
            polygon = shape(geometry)
            if not polygon.is_valid or polygon.is_empty:
                raise ValueError('invalid geometry')
            if not polygon.contains(Point(lon,lat)) and not polygon.touches(Point(lon,lat)):
                # centroid coordinates are sometimes arithmetic average of contour;
                # use the field representative point if outside the actual polygon.
                lon, lat = polygon.representative_point().coords[0]
            projected = transform(TRANSFORM.transform, polygon)
        except Exception as exc:
            raise SoilError('Контур поля повреждён или координаты неверны') from exc
    else:
        x,y = TRANSFORM.transform(lon,lat)
        projected = Point(x,y).buffer(125)  # one ~250m reference pixel around point
    minx,miny,maxx,maxy = projected.bounds
    # A buffer makes very small fields resolvable and covers the nearest 250m cell.
    pad=500
    bounds=(minx-pad,miny-pad,maxx+pad,maxy+pad)
    if max(bounds[2]-bounds[0],bounds[3]-bounds[1]) > 60000:
        raise SoilError('Контур слишком большой для запроса. Выделите отдельное поле.')
    return projected,bounds


def build_wcs_params(prop, bounds):
    if prop not in RASTER_PROPERTIES:
        raise SoilError('Неизвестный почвенный параметр')
    code=RASTER_PROPERTIES[prop][0]
    x1,y1,x2,y2=bounds
    return [
        ('map',f'/map/{code}.map'),('SERVICE','WCS'),('VERSION','2.0.1'),
        ('REQUEST','GetCoverage'),('COVERAGEID',f'{code}_{DEPTH}_Q0.5'),
        ('FORMAT','GEOTIFF_INT16'),
        ('SUBSET',f'X({math.floor(x1)},{math.ceil(x2)})'),
        ('SUBSET',f'Y({math.floor(y1)},{math.ceil(y2)})'),
        ('SUBSETTINGCRS',OGC_CRS),('OUTPUTCRS',OGC_CRS),
    ]


def sample_tiff(content:bytes, region):
    with MemoryFile(content) as memory:
        with memory.open() as dataset:
            if not dataset.count or dataset.width*dataset.height>350000:
                raise SoilError('Некорректный или слишком большой растр')
            values=dataset.read(1, masked=True)
            mask=geometry_mask([mapping(region)],out_shape=values.shape,transform=dataset.transform,invert=True)
            selected=np.ma.array(values,mask=np.ma.getmaskarray(values)|~mask).compressed()
            method='median_pixels'
            if not len(selected):
                # A small polygon may cover no cell centre; sample the cell nearest
                # to the representative point, explicitly mark that approximation.
                x,y=region.representative_point().coords[0]
                row,col=dataset.index(x,y)
                if not (0<=row<dataset.height and 0<=col<dataset.width):
                    raise SoilError('Нет почвенных ячеек для выбранного участка')
                pixel=values[row,col]
                if np.ma.is_masked(pixel):
                    raise SoilError('Значение отсутствует в почвенном растре')
                selected=np.asarray([pixel])
                method='nearest_pixel'
            return float(np.median(selected)),int(len(selected)),method


def _get_one(property_id, bounds, region):
    params=build_wcs_params(property_id,bounds)
    try:
        response=requests.get(WCS,params=params,timeout=(8,35),headers={'User-Agent':'AgroShieldAI/0.4 educational-prototype'})
        response.raise_for_status()
        if len(response.content)>22_000_000:
            raise SoilError('Слишком большой растр WCS')
        if response.content[:2] not in (b'II',b'MM'):
            raise SoilError('Сервис WCS вернул ответ вместо GeoTIFF')
        value,count,method=sample_tiff(response.content,region)
        divisor=RASTER_PROPERTIES[property_id][1]
        return {'value':round(value/divisor,2),'unit':RASTER_PROPERTIES[property_id][2],'cells':count,'sampling':method}
    except (requests.RequestException, rasterio.errors.RasterioError, ValueError, SoilError) as exc:
        raise SoilError(f'{property_id}: {str(exc)[:170]}') from exc


def get_soil(lat,lon,geometry=None,force=False):
    projected,bounds=query_region(lat,lon,geometry)
    key=hashlib.sha256(json.dumps({'lat':round(lat,6),'lon':round(lon,6),'geometry':geometry,'depth':DEPTH},sort_keys=True).encode()).hexdigest()
    dest=CACHE_DIR/f'soil_{key}.json'
    if dest.exists() and not force:
        try:
            result=json.loads(dest.read_text(encoding='utf-8'))
            result['cache']='disk'
            return result
        except Exception: pass
    values={};errors={}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures={pool.submit(_get_one,k,bounds,projected):k for k in RASTER_PROPERTIES}
        for fut in as_completed(futures):
            key_name=futures[fut]
            try:values[key_name]=fut.result()
            except Exception as exc:errors[key_name]=str(exc)
    if not values:
        raise SoilError('SoilGrids WCS недоступен. Попробуйте позднее; ранее сохранённые данные поля останутся без изменений. '+next(iter(errors.values()),''))
    result={'source':'ISRIC SoilGrids WCS 2.0.1','depth':DEPTH,'resolution_m':250,
            'retrievedAt':datetime.now(timezone.utc).isoformat(),'data':values,'errors':errors,
            'cache':'fresh','coverage':'median over field pixels' if geometry else 'point vicinity',
            'url':'https://docs.isric.org/globaldata/soilgrids/wcs.html'}
    # Partial WCS result may be cached; missing properties remain visibly missing.
    dest.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    return result
