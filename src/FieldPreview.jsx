import {useEffect,useRef} from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
const imagery='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export default function FieldPreview({field,onEdit}){
  const target=useRef(null)
  useEffect(()=>{
    const map=L.map(target.current,{zoomControl:false,attributionControl:true,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,touchZoom:false})
    map.setView(field.center||[54.87,69.15],field.geometry?14:11)
    L.tileLayer(imagery,{maxZoom:19,attribution:'Tiles © Esri'}).addTo(map)
    if(field.geometry){
      const overlay=L.geoJSON({type:'Feature',properties:{},geometry:field.geometry},{style:{color:'#2bd076',weight:3,fillOpacity:.26}}).addTo(map)
      map.fitBounds(overlay.getBounds(),{padding:[18,18]})
    }
    return()=>map.remove()
  },[field.id,field.geometry,field.center])
  return <div className="overview-map-real"><div className="map-mini" ref={target}/><div className="map-preview-overlay"><span>{field.geometry?'Контур сохранён':'Границы ещё не выделены'}</span><button className="btn secondary" onClick={onEdit}>Изменить на карте</button></div></div>
}
