"""Local API for NASA POWER, SoilGrids WCS and review-first document import."""
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import json
import shutil
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from .soil import get_soil, SoilError
from .nasa import climate, ClimateError
from .imports import inspect_file

app=FastAPI(title='AgroShield AI data API', version='0.4.0')
TEMP=Path(__file__).resolve().parent/'storage'/'pending'
FINAL=Path(__file__).resolve().parent/'storage'/'accepted'
TEMP.mkdir(parents=True,exist_ok=True)
FINAL.mkdir(parents=True,exist_ok=True)

class Location(BaseModel):
    lat:float=Field(ge=-90,le=90)
    lon:float=Field(ge=-180,le=180)
    geometry:dict|None=None
    force:bool=False

class Commit(BaseModel):
    token:str

@app.get('/api/health')
def health():
    return {'ok':True,'service':'AgroShield AI','backend':'Python WCS + NASA POWER'}

@app.post('/api/nasa')
def nasa_data(req:Location):
    try:return climate(req.lat,req.lon,req.force)
    except ClimateError as exc:raise HTTPException(status_code=503,detail=str(exc)) from exc

@app.post('/api/soil')
def soil_data(req:Location):
    try:return get_soil(req.lat,req.lon,req.geometry,req.force)
    except SoilError as exc:raise HTTPException(status_code=503,detail=str(exc)) from exc

@app.post('/api/files/preview')
async def preview_file(file:UploadFile=File(...)):
    if not file.filename or file.filename.rsplit('.',1)[-1].lower() not in ('csv','xlsx','pdf'):
        raise HTTPException(status_code=400,detail='Выберите CSV, XLSX или PDF')
    content=await file.read(8_000_001)
    if len(content)>8_000_000:
        raise HTTPException(status_code=413,detail='Максимальный размер файла — 8 МБ')
    if not content:
        raise HTTPException(status_code=400,detail='Файл пуст')
    try:parsed=inspect_file(file.filename,content)
    except ValueError as exc:raise HTTPException(status_code=400,detail=str(exc)) from exc
    token=uuid4().hex
    extension=file.filename.rsplit('.',1)[-1].lower()
    (TEMP/f'{token}.{extension}').write_bytes(content)
    (TEMP/f'{token}.json').write_text(json.dumps({'name':Path(file.filename).name,'extension':extension,
        'uploaded':datetime.now(timezone.utc).isoformat()},ensure_ascii=False),encoding='utf-8')
    return {'token':token,'filename':Path(file.filename).name,**parsed}

@app.post('/api/files/commit')
def commit_file(req:Commit):
    import re
    if not re.fullmatch(r'[a-f0-9]{32}',req.token):raise HTTPException(400,'Некорректный токен')
    metadata=TEMP/f'{req.token}.json'
    if not metadata.exists():raise HTTPException(404,'Предпросмотр истёк: загрузите файл снова')
    info=json.loads(metadata.read_text(encoding='utf-8'))
    source=TEMP/f'{req.token}.{info["extension"]}'
    if not source.exists():raise HTTPException(404,'Исходный файл не найден')
    destination=FINAL/f'{req.token}.{info["extension"]}'
    shutil.move(str(source),str(destination))
    shutil.move(str(metadata),str(FINAL/f'{req.token}.json'))
    return {'documentId':req.token,'name':info['name'],'stored':True}
