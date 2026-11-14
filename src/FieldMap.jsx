import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geomCenter, hectares } from './fieldUtils'

const imagery='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const streets='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

export default function FieldMap({field,onSave,onCancel}){
  const host=useRef(null),mapRef=useRef(null),layerRef=useRef(null),shapeRef=useRef(null),drawing=useRef(null),modeRef=useRef('view')
  const [mode,setMode]=useState('view'),[tiles,setTiles]=useState('satellite'),[search,setSearch]=useState('Петропавловск'),[result,setResult]=useState(''),[geometry,setGeometry]=useState(field.geometry||null),[name,setName]=useState(field.name||'')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{modeRef.current=mode;const map=mapRef.current;if(!map)return; if(mode==='view'){map.dragging.enable();map.touchZoom.enable();map.doubleClickZoom.enable()}else{map.dragging.disable();map.touchZoom.disable();map.doubleClickZoom.disable()}},[mode])
  // Initialize once per selected field. Center and geometry are immutable at field switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!host.current)return;const map=L.map(host.current,{zoomControl:true,attributionControl:true}).setView(field.center||[54.87,69.15],field.geometry?14:11);mapRef.current=map;layerRef.current=L.tileLayer(imagery,{maxZoom:19,attribution:'Tiles © Esri'}).addTo(map);if(field.geometry){shapeRef.current=L.geoJSON({type:'Feature',properties:{},geometry:field.geometry},{style:{color:'#14b56b',weight:3,fillOpacity:.28}}).addTo(map);map.fitBounds(shapeRef.current.getBounds(),{padding:[25,25]})}return()=>{map.remove();mapRef.current=null}},[field.id])
  useEffect(()=>{if(!mapRef.current)return;layerRef.current?.remove();layerRef.current=L.tileLayer(tiles==='satellite'?imagery:streets,{maxZoom:19,attribution:tiles==='satellite'?'Tiles © Esri':'© OpenStreetMap contributors'}).addTo(mapRef.current)},[tiles,field.id])
  const renderGeometry=g=>{if(shapeRef.current){shapeRef.current.remove();shapeRef.current=null}if(g&&mapRef.current){shapeRef.current=L.geoJSON({type:'Feature',properties:{},geometry:g},{style:{color:'#14b56b',weight:3,fillOpacity:.26}}).addTo(mapRef.current)}}
  const makePolygon=points=>{if(points.length<3)return null;const ring=points.map(p=>[p.lng,p.lat]);ring.push(ring[0]);return {type:'Polygon',coordinates:[ring]}}
  const xy=e=>{const rect=host.current.getBoundingClientRect();return mapRef.current.containerPointToLatLng(L.point(e.clientX-rect.left,e.clientY-rect.top))}
  const begin=e=>{if(modeRef.current==='view'||e.button!==0||e.target.closest?.('.leaflet-control'))return;host.current.setPointerCapture(e.pointerId);e.preventDefault();const p=xy(e);drawing.current=[p,p]}
  const move=e=>{if(!drawing.current)return;e.preventDefault();const p=xy(e);if(modeRef.current==='rectangle'){drawing.current[1]=p;const a=drawing.current[0];renderGeometry(makePolygon([a,L.latLng(a.lat,p.lng),p,L.latLng(p.lat,a.lng)]))}else{drawing.current.push(p);const points=drawing.current;if(points.length>2)renderGeometry(makePolygon(points))}}
  const end=()=>{if(!drawing.current)return;const points=drawing.current;let geom=null;if(modeRef.current==='rectangle'){const a=points[0],b=points[1];if(Math.abs(a.lat-b.lat)>0.00002&&Math.abs(a.lng-b.lng)>0.00002)geom=makePolygon([a,L.latLng(a.lat,b.lng),b,L.latLng(b.lat,a.lng)])}else if(points.length>=4){geom=makePolygon(points.filter((_,i)=>i%3===0||i===points.length-1))}drawing.current=null;if(geom){setGeometry(geom);renderGeometry(geom)}else renderGeometry(geometry)}
  const find=async e=>{e.preventDefault();setBusy(true);setResult('');try{const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`);if(!r.ok)throw Error(`HTTP ${r.status}`);const data=await r.json();if(!data.length)throw Error('Место не найдено');mapRef.current.setView([Number(data[0].lat),Number(data[0].lon)],13);setResult(data[0].display_name)}catch(err){setResult('Не удалось выполнить поиск: '+err.message)}finally{setBusy(false)}}
  const area=geometry?hectares(geometry):null
  return <div className="panel map-page">
    <div className="section-head"><div><h2>{field.id?'Изменить границы':'Добавить поле'}</h2><p className="muted">Найдите участок и выделите его мышью или пальцем.</p></div><button className="btn ghost" onClick={onCancel}>Назад</button></div>
    <form className="search-row" onSubmit={find}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Город, село или район"/><button className="btn secondary" disabled={busy}>{busy?'Поиск…':'Найти'}</button></form>
    {result&&<div className="small muted">{result}</div>}
    <div className="map-actions"><button type="button" className={'chip '+(mode==='view'?'selected':'')} onClick={()=>setMode('view')}>Перемещать карту</button><button type="button" className={'chip '+(mode==='rectangle'?'selected':'')} onClick={()=>setMode('rectangle')}>▭ Прямоугольник</button><button type="button" className={'chip '+(mode==='brush'?'selected':'')} onClick={()=>setMode('brush')}>✎ Обвести вручную</button></div>
    <div className="map-host" ref={host} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} style={{touchAction:mode==='view'?'auto':'none'}}/>
    <div className="map-footer"><div className="segmented small"><button className={tiles==='satellite'?'active':''} onClick={()=>setTiles('satellite')}>Спутник</button><button className={tiles==='streets'?'active':''} onClick={()=>setTiles('streets')}>Карта</button></div><button className="btn ghost" onClick={()=>{setGeometry(null);renderGeometry(null)}}>Очистить границы</button></div>
    <div className="form-grid"><label>Название поля<input value={name} onChange={e=>setName(e.target.value)} placeholder="Например, Северное поле"/></label><label>Площадь по контуру<input value={area===null?'Не выделено':`${area.toFixed(2)} га`} readOnly/></label></div>
    <p className="muted small">Границы сохраняются в GeoJSON. Площадь рассчитывается по координатам. Поиск и снимки требуют доступа к интернету.</p>
    <button className="btn primary full" disabled={!geometry||!name.trim()||!area||area<0.001} onClick={()=>onSave({name:name.trim(),geometry,areaHa:+area.toFixed(3),center:geomCenter(geometry)})}>Сохранить поле</button>
  </div>
}
