export const KEY='agroshield-farmer-v4'
export const DEMO_FIELDS=[
  {id:'north',name:'Северное поле',areaHa:100,region:'Северо-Казахстанская область',center:[54.87,69.15],geometry:null,observations:'Летом почва пересыхает. В низине после дождей задерживается вода.',strengths:'Хорошая весенняя всхожесть. Удобный подъезд техники.',extra:'История препаратов не указана.',herbicideStatus:'unknown',herbicides:[],irrigation:'no',waterDetails:'',history:[{id:'n23',year:2023,crop:'Горох',sown:'2023-05-15',harvested:'2023-08-29',yield:1.8,source:'Демонстрационная запись'},{id:'n24',year:2024,crop:'Ячмень',sown:'2024-05-18',harvested:'2024-09-05',yield:2.1,source:'Демонстрационная запись'},{id:'n25',year:2025,crop:'Пшеница',sown:'2025-05-20',harvested:'2025-09-12',yield:2.0,source:'Демонстрационная запись'}],documents:[],goals:['harvest','soil','water'],ownGoal:'',budget:'1250000',budgetScope:'season',dataVersion:1,analyses:[],approved:null,climate:null,soilResult:null,soilManual:{ph:'',soc:'',texture:'',source:''}},
  {id:'east',name:'Восточное поле',areaHa:65,region:'Северо-Казахстанская область',center:[54.84,69.23],geometry:null,observations:'Местами сорняки, летом не хватает влаги.',strengths:'Ровный участок, удобная работа техники.',extra:'',herbicideStatus:'unknown',herbicides:[],irrigation:'no',waterDetails:'',history:[{id:'e23',year:2023,crop:'Пшеница',sown:'2023-05-17',harvested:'2023-09-08',yield:1.9,source:'Демонстрационная запись'},{id:'e24',year:2024,crop:'Горох',sown:'2024-05-19',harvested:'2024-08-30',yield:1.6,source:'Демонстрационная запись'},{id:'e25',year:2025,crop:'Ячмень',sown:'2025-05-16',harvested:'2025-09-04',yield:2.2,source:'Демонстрационная запись'}],documents:[],goals:['harvest','cost'],ownGoal:'',budget:'800000',budgetScope:'season',dataVersion:1,analyses:[],approved:null,climate:null,soilResult:null,soilManual:{ph:'',soc:'',texture:'',source:''}}
]
export function loadFields(){
  try{
    const d=JSON.parse(localStorage.getItem(KEY))
    if(Array.isArray(d)&&d.length)return d
    // Preserve farmer entries in earlier prototype and migrate transparently.
    const old=JSON.parse(localStorage.getItem('agroshield-farmer-v3'))
    if(Array.isArray(old)&&old.length)return old.map(f=>({...f,herbicideStatus:'unknown',herbicides:[],soilManual:f.soil||{},soilResult:null}))
  }catch{/* corrupted local data: show demo */}
  return DEMO_FIELDS.map(f=>structuredClone(f))
}
export function saveFields(fs){try{localStorage.setItem(KEY,JSON.stringify(fs))}catch{/* local quota */}}
export function id(){return globalThis.crypto?.randomUUID?.()||`field-${Date.now()}-${Math.random().toString(36).slice(2)}`}
export function hectares(geometry){if(!geometry?.coordinates?.[0])return null;const ring=geometry.coordinates[0],rad=Math.PI/180;let sum=0;for(let i=0;i<ring.length-1;i++){const [lon1,lat1]=ring[i],[lon2,lat2]=ring[i+1];sum+=(lon2-lon1)*rad*(2+Math.sin(lat1*rad)+Math.sin(lat2*rad))}return Math.abs(sum*6378137*6378137/2)/10000}
export function geomCenter(geometry){const pts=geometry?.coordinates?.[0];if(!pts?.length)return null;const p=pts.slice(0,-1);return [p.reduce((a,v)=>a+v[1],0)/p.length,p.reduce((a,v)=>a+v[0],0)/p.length]}
export function normalize(v){return String(v??'').trim().toLocaleLowerCase('ru-RU')}
