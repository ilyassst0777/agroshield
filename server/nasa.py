"""NASA POWER monthly series; no fabricated climate values or crop yields."""
import hashlib, json, statistics, math
from datetime import datetime, timezone
from pathlib import Path
import calendar
import requests

BASE='https://power.larc.nasa.gov/api/temporal/monthly/point'
CACHE=Path(__file__).resolve().parent/'cache'
CACHE.mkdir(exist_ok=True)
BASE_PARAMETERS=['T2M','PRECTOTCORR','ALLSKY_SFC_SW_DWN','RH2M','WS2M']

class ClimateError(RuntimeError): pass

def _fetch(lat,lon,start,end,community,params):
    query={'latitude':round(lat,5),'longitude':round(lon,5),'start':start,'end':end,
           'community':community,'parameters':','.join(params),'format':'JSON'}
    try:
        res=requests.get(BASE,params=query,timeout=(9,45),headers={'User-Agent':'AgroShieldAI/0.4 educational-prototype'})
        res.raise_for_status()
        body=res.json()
        data=body.get('properties',{}).get('parameter',{})
        if not data or not isinstance(data,dict):raise ClimateError('NASA не вернула климатических параметров')
        return data,res.url
    except (requests.RequestException, ValueError) as exc:
        raise ClimateError('NASA POWER: '+str(exc)[:150]) from exc

def _valid(parameter,key):
    n=parameter.get(key)
    return float(n) if isinstance(n,(int,float)) and math.isfinite(n) and n>-900 else None

def climate(lat,lon,force=False):
    if not (-90<=lat<=90 and -180<=lon<=180):raise ClimateError('Некорректные координаты')
    end=datetime.now(timezone.utc).year-1  # complete years only
    key=hashlib.sha256(f'{lat:.5f}:{lon:.5f}:1991:{end}:v5'.encode()).hexdigest()
    dest=CACHE/f'nasa_{key}.json'
    if dest.exists() and not force:
        try:
            value=json.loads(dest.read_text(encoding='utf-8'));value['cache']='disk';return value
        except Exception:pass
    props,url=_fetch(lat,lon,1991,end,'AG',BASE_PARAMETERS)
    moisture={};moistureError=None
    try:
        # HY is rejected by the live monthly service; GWETROOT is available in AG.
        more,_=_fetch(lat,lon,1991,end,'AG',['GWETROOT'])
        moisture=more.get('GWETROOT',{})
    except ClimateError as exc:
        moistureError=str(exc)
    seasons=[]
    for year in range(1991,end+1):
        entries=[]
        for month in range(5,9):
            key=f'{year}{month:02d}'
            temp=_valid(props.get('T2M',{}),key)
            rain=_valid(props.get('PRECTOTCORR',{}),key)
            radiation=_valid(props.get('ALLSKY_SFC_SW_DWN',{}),key)
            humid=_valid(props.get('RH2M',{}),key)
            wind=_valid(props.get('WS2M',{}),key)
            root=_valid(moisture,key)
            entries.append({'month':month,'days':calendar.monthrange(year,month)[1],'rain':None if rain is None else rain*calendar.monthrange(year,month)[1],
                            'temp':temp,'radiation':radiation,'humidity':humid,'wind':wind,'root':root})
        def avg(k):
            vals=[v for v in entries if v[k] is not None]
            return round(sum(v[k]*v['days'] for v in vals)/sum(v['days'] for v in vals),3) if len(vals)==4 else None
        rain=[e['rain'] for e in entries]
        if any(x is None for x in rain) or avg('temp') is None:continue
        seasons.append({'year':year,'rainMm':round(sum(rain),1),'tempC':avg('temp'),
                        'radiation':avg('radiation'),'humidity':avg('humidity'),'wind':avg('wind'),'rootWetness':avg('root')})
    if not seasons:raise ClimateError('NASA POWER не вернула полных сезонов май–август')
    normal=[s for s in seasons if 1991<=s['year']<=2020]
    latest=seasons[-1]
    def mean(key):
        a=[v[key] for v in normal if v[key] is not None]
        return round(statistics.mean(a),2) if len(a)>=25 else None
    baseline_rain=mean('rainMm');baseline_temp=mean('tempC')
    out={'source':'NASA POWER monthly point','retrievedAt':datetime.now(timezone.utc).isoformat(),
         'url':url,'lat':lat,'lon':lon,'period':'Май–август','baselinePeriod':'1991–2020',
         'latestYear':latest['year'],'latestRainMm':latest['rainMm'],'latestTempC':latest['tempC'],
         'latestRadiation':latest['radiation'],'latestHumidity':latest['humidity'],
         'latestWind':latest['wind'],'latestRootWetness':latest['rootWetness'],
         'baselineRain':baseline_rain,'baselineTemp':baseline_temp,
         'precipAnomalyPct':round(100*(latest['rainMm']-baseline_rain)/baseline_rain,1) if baseline_rain else None,
         'tempAnomalyC':round(latest['tempC']-baseline_temp,2) if baseline_temp is not None else None,
         'rows':seasons,'baselineYears':len(normal),'cache':'fresh','moistureError':moistureError,
         'units':{'rain':'мм за май–август','temp':'°C','radiation':'кВт·ч/м²/сут','humidity':'%',
                  'wind':'м/с','rootWetness':'доля от 0 до 1'},
         'description':'PRECTOTCORR: средние мм/сут × календарные дни; остальные сезонные средние взвешены по числу дней месяца. GWETROOT запрашивается отдельно в AG.'}
    dest.write_text(json.dumps(out,ensure_ascii=False),encoding='utf-8')
    return out
