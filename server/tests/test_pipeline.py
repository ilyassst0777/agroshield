import io
import json
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from fastapi.testclient import TestClient
from openpyxl import Workbook
from server import soil, nasa, imports
from server.app import app


def test_soil_conversion_and_wcs_parameters(monkeypatch):
    assert soil.RASTER_PROPERTIES['sand_pct'][1] == 10
    assert soil.RASTER_PROPERTIES['silt_pct'][1] == 10
    assert soil.RASTER_PROPERTIES['clay_pct'][1] == 10
    assert soil.RASTER_PROPERTIES['ph'][1] == 10
    assert soil.RASTER_PROPERTIES['soc_g_kg'][1] == 10
    region,bounds=soil.query_region(54.87,69.15)
    params=dict(soil.build_wcs_params('ph',bounds))
    assert params['COVERAGEID']=='phh2o_5-15cm_Q0.5'
    assert params['FORMAT']=='GEOTIFF_INT16'
    x,y=region.representative_point().coords[0]
    image=np.full((8,8),65,dtype=np.int16)
    with MemoryFile() as memory:
        with memory.open(driver='GTiff',height=8,width=8,count=1,dtype='int16',
                         transform=from_origin(x-1000,y+1000,250,250),crs='ESRI:54052',nodata=-32768) as ds:
            ds.write(image,1)
        value,count,method=soil.sample_tiff(memory.read(),region)
    assert value==65 and count>=1 and method in ('nearest_pixel','median_pixels')


def test_nasa_season_and_baseline(monkeypatch,tmp_path):
    monkeypatch.setattr(nasa,'CACHE',tmp_path)
    data={k:{} for k in nasa.BASE_PARAMETERS}
    for year in range(1991,2026):
        for month in range(1,13):
            ym=f'{year}{month:02d}'
            for k in data:
                data[k][ym]={'T2M':14,'PRECTOTCORR':2,'ALLSKY_SFC_SW_DWN':5,
                             'RH2M':60,'WS2M':3}[k]
    def fake(lat,lon,start,end,community,params):
        if params==['GWETROOT']:return {'GWETROOT':{f'{y}{m:02d}':0.6 for y in range(1991,2026) for m in range(1,13)}},'https://nasa.example.invalid'
        return data,'https://nasa.example.invalid'
    monkeypatch.setattr(nasa,'_fetch',fake)
    result=nasa.climate(54.87,69.15)
    assert result['latestYear']==2025
    assert result['baselineYears']==30
    assert result['latestRainMm']==246.0  # May-Aug: 31+30+31+31 = 123 days * 2 mm/day
    assert result['precipAnomalyPct']==0
    assert result['latestRootWetness']==0.6
    assert nasa.climate(54.87,69.15)['cache']=='disk'


def test_import_exact_provenance_csv_and_excel():
    raw='Поле;Год;Культура;Урожайность\nСеверное поле;2025;Пшеница;2,0\nВосточное поле;2025;Ячмень;2,2\n'.encode()
    result=imports.inspect_file('history.csv',raw)
    assert result['kind']=='history'
    assert len(result['rows'])==2
    assert result['rows'][0]['line']==2
    assert result['rows'][0]['field']=='Северное поле'
    assert result['rows'][0]['yield']==2
    wb=Workbook()
    ws=wb.active;ws.title='Посевы'
    ws.append(['Поле','Год','Культура','Урожайность'])
    ws.append(['Северное поле',2025,'Пшеница',2.5])
    content=io.BytesIO();wb.save(content)
    xlsx=imports.inspect_file('history.xlsx',content.getvalue())
    assert xlsx['rows'][0]['sheet']=='Посевы' and xlsx['rows'][0]['line']==2
    assert xlsx['rows'][0]['yield']==2.5


def test_api_health_and_validation(monkeypatch):
    client=TestClient(app)
    assert client.get('/api/health').json()['ok']
    assert client.post('/api/soil',json={'lat':999,'lon':69}).status_code==422
    monkeypatch.setattr('server.app.get_soil',lambda lat,lon,geometry,force:{'source':'mock','data':{'ph':{'value':7,'unit':'pH'}}})
    data=client.post('/api/soil',json={'lat':54.87,'lon':69.15}).json()
    assert data['data']['ph']['value']==7
