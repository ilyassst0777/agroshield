
"""SoilGrids WCS 2.0.1 client for AgroShield AI.

Downloads GeoTIFF rasters and samples soil properties on the Python backend.
Invalid pixels are rejected rather than reported as real soil measurements.
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


WCS = "https://maps.isric.org/mapserv"

OGC_CRS = "http://www.opengis.net/def/crs/EPSG/0/152160"
LOCAL_CRS = "ESRI:54052"

DEPTH = "5-15cm"

# SoilGrids conversion factors:
# pH: /10
# SOC: /10 -> g/kg
# sand/silt/clay: /10 -> %
RASTER_PROPERTIES = {
    "ph": ("phh2o", 10, "pH"),
    "soc_g_kg": ("soc", 10, "g/kg"),
    "sand_pct": ("sand", 10, "%"),
    "silt_pct": ("silt", 10, "%"),
    "clay_pct": ("clay", 10, "%"),
}

CACHE_VERSION = 3

CACHE_DIR = Path(__file__).resolve().parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

TRANSFORM = Transformer.from_crs(
    "EPSG:4326",
    LOCAL_CRS,
    always_xy=True,
)


class SoilError(RuntimeError):
    pass


def query_region(lat: float, lon: float, geometry=None):
    """Convert a field or point vicinity into SoilGrids projected coordinates."""

    if not (
        math.isfinite(lat)
        and math.isfinite(lon)
        and -90 < lat < 90
        and -180 <= lon <= 180
    ):
        raise SoilError("Некорректные координаты поля")

    if geometry:
        if geometry.get("type") not in ("Polygon", "MultiPolygon"):
            raise SoilError(
                "Поддерживаются только Polygon и MultiPolygon"
            )

        try:
            polygon = shape(geometry)

            if polygon.is_empty or not polygon.is_valid:
                raise ValueError("Invalid field geometry")

            if not (
                polygon.contains(Point(lon, lat))
                or polygon.touches(Point(lon, lat))
            ):
                lon, lat = polygon.representative_point().coords[0]

            projected = transform(TRANSFORM.transform, polygon)

            if projected.is_empty or not projected.is_valid:
                raise ValueError("Invalid projected geometry")

        except Exception as exc:
            raise SoilError(
                "Контур поля повреждён или содержит неверные координаты"
            ) from exc

    else:
        x, y = TRANSFORM.transform(lon, lat)

        if not (math.isfinite(x) and math.isfinite(y)):
            raise SoilError("Не удалось преобразовать координаты поля")

        projected = Point(x, y).buffer(125)

    minx, miny, maxx, maxy = projected.bounds

    pad = 500

    bounds = (
        minx - pad,
        miny - pad,
        maxx + pad,
        maxy + pad,
    )

    if max(
        bounds[2] - bounds[0],
        bounds[3] - bounds[1],
    ) > 60000:
        raise SoilError(
            "Контур слишком большой. Выделите отдельное поле."
        )

    return projected, bounds


def build_wcs_params(property_id, bounds):
    """Build a WCS GetCoverage request."""

    if property_id not in RASTER_PROPERTIES:
        raise SoilError("Неизвестный почвенный параметр")

    code = RASTER_PROPERTIES[property_id][0]

    x1, y1, x2, y2 = bounds

    return [
        ("map", f"/map/{code}.map"),
        ("SERVICE", "WCS"),
        ("VERSION", "2.0.1"),
        ("REQUEST", "GetCoverage"),
        ("COVERAGEID", f"{code}_{DEPTH}_Q0.5"),
        ("FORMAT", "GEOTIFF_INT16"),
        ("SUBSET", f"X({math.floor(x1)},{math.ceil(x2)})"),
        ("SUBSET", f"Y({math.floor(y1)},{math.ceil(y2)})"),
        ("SUBSETTINGCRS", OGC_CRS),
        ("OUTPUTCRS", OGC_CRS),
    ]


def sample_tiff(content: bytes, region):
    """Read valid GeoTIFF pixels intersecting the field."""

    try:
        with MemoryFile(content) as memory:
            with memory.open() as dataset:

                if (
                    dataset.count < 1
                    or dataset.width < 1
                    or dataset.height < 1
                    or dataset.width * dataset.height > 350000
                ):
                    raise SoilError(
                        "Некорректный или слишком большой растр"
                    )

                values = dataset.read(1, masked=True)

                if dataset.crs is None:
                    raise SoilError(
                        "У растра отсутствует система координат"
                    )

                # Project the field to the actual raster CRS.
                if dataset.crs != rasterio.crs.CRS.from_user_input(
                    LOCAL_CRS
                ):
                    transformer = Transformer.from_crs(
                        LOCAL_CRS,
                        dataset.crs,
                        always_xy=True,
                    )
                    raster_region = transform(
                        transformer.transform,
                        region,
                    )
                else:
                    raster_region = region

                inside = geometry_mask(
                    [mapping(raster_region)],
                    out_shape=values.shape,
                    transform=dataset.transform,
                    invert=True,
                )

                raw = np.asarray(values.data, dtype=float)

                invalid = (
                    np.ma.getmaskarray(values)
                    | ~inside
                    | ~np.isfinite(raw)
                )

                selected = raw[~invalid]

                method = "median_pixels"

                if selected.size == 0:
                    # Tiny fields may contain no pixel centre.
                    x, y = raster_region.representative_point().coords[0]

                    row, col = dataset.index(x, y)

                    if not (
                        0 <= row < dataset.height
                        and 0 <= col < dataset.width
                    ):
                        raise SoilError(
                            "Нет почвенных ячеек для выбранного участка"
                        )

                    pixel = values[row, col]

                    if np.ma.is_masked(pixel):
                        raise SoilError(
                            "Значение отсутствует в почвенном растре"
                        )

                    pixel = float(pixel)

                    if not math.isfinite(pixel):
                        raise SoilError(
                            "Некорректный пиксель почвенного растра"
                        )

                    selected = np.asarray([pixel])
                    method = "nearest_pixel"

                value = float(np.median(selected))

                if not math.isfinite(value):
                    raise SoilError(
                        "Получено некорректное значение SoilGrids"
                    )

                return value, int(selected.size), method

    except rasterio.errors.RasterioError as exc:
        raise SoilError(
            "Не удалось прочитать GeoTIFF от SoilGrids"
        ) from exc


def validate_soil_value(property_id, raw_value):
    """Convert raw SoilGrids values and validate plausible ranges."""

    divisor = RASTER_PROPERTIES[property_id][1]
    value = raw_value / divisor

    if not math.isfinite(value):
        raise SoilError("Некорректное числовое значение")

    if property_id == "ph":
        if not (0 < value <= 14):
            raise SoilError(
                "Недостоверный pH: возможен NoData или неверный пиксель"
            )

    elif property_id == "soc_g_kg":
        if not (0 <= value <= 1000):
            raise SoilError(
                "Некорректное содержание органического углерода"
            )

    elif property_id in (
        "sand_pct",
        "silt_pct",
        "clay_pct",
    ):
        if not (0 <= value <= 100):
            raise SoilError(
                "Некорректный процент почвенной фракции"
            )

    return round(value, 2)


def _get_one(property_id, bounds, region):
    """Download and validate one SoilGrids property."""

    params = build_wcs_params(property_id, bounds)

    try:
        response = requests.get(
            WCS,
            params=params,
            timeout=(8, 35),
            headers={
                "User-Agent": "AgroShieldAI/0.4"
            },
        )

        response.raise_for_status()

        if len(response.content) > 22_000_000:
            raise SoilError(
                "Слишком большой растр WCS"
            )

        if response.content[:2] not in (b"II", b"MM"):
            raise SoilError(
                "SoilGrids вернул ответ вместо GeoTIFF"
            )

        raw_value, count, method = sample_tiff(
            response.content,
            region,
        )

        value = validate_soil_value(
            property_id,
            raw_value,
        )

        return {
            "value": value,
            "unit": RASTER_PROPERTIES[property_id][2],
            "cells": count,
            "sampling": method,
        }

    except (
        requests.RequestException,
        rasterio.errors.RasterioError,
        ValueError,
        SoilError,
    ) as exc:
        raise SoilError(
            f"{property_id}: {str(exc)[:170]}"
        ) from exc


def get_soil(lat, lon, geometry=None, force=False):
    """Public function imported by server/app.py.

    Returns valid SoilGrids properties with individual errors.
    Invalid or missing values are never replaced with fake numbers.
    """

    lat = float(lat)
    lon = float(lon)

    projected, bounds = query_region(
        lat,
        lon,
        geometry,
    )

    cache_payload = {
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "geometry": geometry,
        "depth": DEPTH,
        "version": CACHE_VERSION,
    }

    cache_key = hashlib.sha256(
        json.dumps(
            cache_payload,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()

    dest = CACHE_DIR / f"soil_{cache_key}.json"

    if dest.exists() and not force:
        try:
            result = json.loads(
                dest.read_text(encoding="utf-8")
            )

            cached_values = result.get("data", {})

            # Reject previously cached all-zero responses.
            if cached_values and all(
                item.get("value") == 0
                for item in cached_values.values()
            ):
                raise ValueError("Invalid cached soil data")

            result["cache"] = "disk"
            return result

        except (OSError, ValueError, KeyError, TypeError):
            pass

    values = {}
    errors = {}

    with ThreadPoolExecutor(max_workers=3) as pool:

        futures = {
            pool.submit(
                _get_one,
                property_id,
                bounds,
                projected,
            ): property_id
            for property_id in RASTER_PROPERTIES
        }

        for future in as_completed(futures):
            property_id = futures[future]

            try:
                values[property_id] = future.result()
            except Exception as exc:
                errors[property_id] = str(exc)

    if not values:
        detail = next(iter(errors.values()), "")

        raise SoilError(
            "Не удалось получить достоверные данные SoilGrids. "
            f"{detail}"
        )

    if all(
        item["value"] == 0
        for item in values.values()
    ):
        raise SoilError(
            "SoilGrids вернул только нулевые значения. "
            "Результат отклонён."
        )

    result = {
        "source": "ISRIC SoilGrids WCS 2.0.1",
        "depth": DEPTH,
        "resolution_m": 250,
        "retrievedAt": datetime.now(
            timezone.utc
        ).isoformat(),
        "data": values,
        "errors": errors,
        "cache": "fresh",
        "coverage": (
            "median over field pixels"
            if geometry
            else "point vicinity"
        ),
        "url": "https://docs.isric.org/globaldata/soilgrids/wcs.html",
    }

    try:
        dest.write_text(
            json.dumps(
                result,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    except OSError:
        # Cache is optional; do not fail valid requests.
        pass

    return result
