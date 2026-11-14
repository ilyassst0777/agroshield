"""SoilGrids WCS 2.0.1 client for AgroShield AI.

Fetches ISRIC GeoTIFF rasters on the Python backend and samples field pixels.
Invalid or missing values are reported as errors, never as valid soil metrics.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.io import MemoryFile
from pyproj import Transformer
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform
import requests

WCS = 'https://maps.isric.org/mapserv'
OGC_CRS = 'http://www.opengis.net/def/crs/EPSG/0/152160'
LOCAL_CRS = 'ESRI:54052'
DEPTH = '5-15cm'

# SoilGrids map values are integers with property-specific conversion factors.
RASTER_PROPERTIES = {
    'ph': ('phh2o', 10, 'pH'),
    'soc_g_kg': ('soc', 10, 'g/kg'),
    'sand_pct': ('sand', 10, '%'),
    'silt_pct': ('silt', 10, '%'),
    'clay_pct': ('clay', 10, '%'),
}

# Bump this when processing rules change so previously cached invalid zeros
# cannot be returned as fresh results.
CACHE_SCHEMA = 2
CACHE_DIR = Path(__file__).resolve().parent / 'cache'
CACHE_DIR.mkdir(exist_ok=True)
TRANSFORM = Transformer.from_crs('EPSG:4326', LOCAL_CRS, always_xy=True)


class SoilError(RuntimeError):
    pass


def query_region(lat: float, lon: float, geometry=None):
    """Project field geometry to SoilGrids CRS, or use a small point buffer."""
    if not (-90 < lat < 90 and -180 <= lon <= 180):
        raise SoilError('Некорректные координаты поля')

    if geometry:
        if not isinstance(geometry, dict) or geometry.get('type') not in {'Polygon', 'MultiPolygon'}:
            raise SoilError('Поддерживаются только контуры Polygon и MultiPolygon')
        try:
            polygon = shape(geometry)
            if not polygon.is_valid or polygon.is_empty:
                raise ValueError('invalid geometry')
            if not polygon.contains(Point(lon, lat)) and not polygon.touches(Point(lon, lat)):
                lon, lat = polygon.representative_point().coords[0]
            projected = transform(TRANSFORM.transform, polygon)
        except Exception as exc:
            raise SoilError('Контур поля повреждён или координаты неверны') from exc
    else:
        x, y = TRANSFORM.transform(lon, lat)
        projected = Point(x, y).buffer(125)

    minx, miny, maxx, maxy = projected.bounds
    if not all(map(math.isfinite, (minx, miny, maxx, maxy))):
        raise SoilError('Не удалось преобразовать координаты поля')
    pad = 500
    bounds = (minx - pad, miny - pad, maxx + pad, maxy + pad)
    if max(bounds[2] - bounds[0], bounds[3] - bounds[1]) > 60000:
        raise SoilError('Контур слишком большой для запроса. Выделите отдельное поле.')
    return projected, bounds


def build_wcs_params(prop, bounds):
    if prop not in RASTER_PROPERTIES:
        raise SoilError('Неизвестный почвенный параметр')
    code = RASTER_PROPERTIES[prop][0]
    x1, y1, x2, y2 = bounds
    return [
        ('map', f'/map/{code}.map'),
        ('SERVICE', 'WCS'),
        ('VERSION', '2.0.1'),
        ('REQUEST', 'GetCoverage'),
        ('COVERAGEID', f'{code}_{DEPTH}_Q0.5'),
        ('FORMAT', 'GEOTIFF_INT16'),
        ('SUBSET', f'X({math.floor(x1)},{math.ceil(x2)})'),
        ('SUBSET', f'Y({math.floor(y1)},{math.ceil(y2)})'),
        ('SUBSETTINGCRS', OGC_CRS),
        ('OUTPUTCRS', OGC_CRS),
    ]