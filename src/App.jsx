import { useEffect, useMemo, useState } from 'react'
import FieldMap from './FieldMap.jsx'
import SoilFarmerPanel from './SoilFarmerPanel.jsx'
import ScoringDetails from './ScoringDetails.jsx'
import { DEMO_FIELDS, loadFields, saveFields, normalize, id } from './fieldUtils'
import { loadNasa, loadSoil, previewUpload, commitUpload } from './dataService'
import { evaluate, SOURCES } from './rotationEngine'
import './App.css'

const PAGES=[['overview','Обзор'],['data','Данные поля'],['ai','AI-рекомендации'],['archive','История анализов']]
const GOALS=[['harvest','Урожай в следующем сезоне'],['soil','Сохранить плодородие'],['water','Снизить риск засухи'],['cost','Сократить расходы'],['early','Собрать урожай раньше'],['stable','Стабильные урожаи в будущем'],['diversity','Разнообразить культуры'],['erosion','Уменьшить эрозию']]
const fmt=(n,d=1)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:d}):'—'
const date=v=>v?new Date(v+'T00:00:00').toLocaleDateString('ru-RU'):'—'
function Button({children,onClick,kind='secondary',disabled=false,className=''}){return <button type="button" className={`btn ${kind} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>}
function Top({onHome}){return <header className="brand-row"><button className="brand" onClick={onHome} aria-label="Мои поля"><span className="brand-mark">✳</span><span><strong>AgroShield AI</strong><small>Smart farming decisions</small></span></button><span className="demo-label">ПРОТОТИП</span></header>}
function FieldCards({fields,active,onPick,onAdd}){return <section><div className="section-head"><div><p className="eyebrow">Моё хозяйство / Северный Казахстан</p><h1>Мои поля</h1></div><Button onClick={onAdd}>＋ Поле</Button></div><div className="field-grid">{fields.map(f=><button className={'field-card '+(f.id===active?'selected':'')} key={f.id} onClick={()=>onPick(f.id)}><span className="field-card-top"><span className="pin">⌖</span>{f.id===active&&<span className="check">✓</span>}</span><strong>{f.name}</strong><small>{f.areaHa?`${fmt(f.areaHa,2)} га`:'Площадь не указана'} · {f.region||'СКО'}</small><small>Последняя культура: {f.history?.at(-1)?.crop||'нет записей'}</small></button>)}</div></section>}
function Overview({field,onMap,onData,onAI}){return <section className="panel"><div className="section-head"><div><h2>Обзор поля</h2><p className="muted">{field.name}</p></div><Button onClick={onMap}>Изменить границы</Button></div><div className="overview-grid"><div className="overview-map" onClick={onMap} role="button" tabIndex={0} onKeyDown={e=>e.key==='Enter'&&onMap()}><span className="fake-farmland"><span className="outline-field"></span><span className="map-name">{field.name}</span></span><span className="map-caption">Открыть карту и границы участка</span></div><div className="stat-grid"><div className="stat"><small>Площадь</small><strong>{field.areaHa?`${fmt(field.areaHa,2)} га`:'—'}</strong></div><div className="stat"><small>Последняя культура</small><strong>{field.history?.at(-1)?.crop||'—'}</strong></div><div className="stat"><small>История посевов</small><strong>{field.history?.length||0} записи</strong></div><div className="stat"><small>Документы</small><strong>{field.documents?.length||0}</strong></div></div></div>
 <div className="info-card"><div className="section-head"><h3>Наблюдения фермера</h3><Button kind="ghost" onClick={onData}>Изменить</Button></div><p>{field.strengths||'Преимущества не указаны.'}</p><p>{field.observations||'Наблюдений пока нет.'}</p></div>
 <div className="info-card"><h3>Данные для анализа</h3><div className="data-status">✓ История поля: {field.history?.length||0} записи</div><div className="data-status">{field.climate?'✓':'○'} NASA POWER: {field.climate?`расчёт за ${field.climate.latestYear} год`:'ещё не загружен'}</div><div className="data-status">{field.soil?.source?'✓':'○'} Почвенные данные: {field.soil?.source?'внесены':'ожидаются'}</div></div>
 {field.approved?<div className="info-card"><div className="section-head"><h3>Мой севооборот</h3><span className="pill good">Утверждён</span></div><strong>{field.approved.name}</strong><div className="year-grid">{field.approved.crops.map((c,i)=><div className="year" key={i}><small>{field.approved.startYear+i}</small><strong>{c}</strong></div>)}</div>{field.approved.dataVersion!==field.dataVersion&&<p className="notice">Исходные сведения изменились. План сохранён, но требует повторной проверки.</p>}</div>:<p className="subtle-note">Утверждённого плана пока нет.</p>}
 <Button kind="primary" className="full" onClick={onAI}>Посмотреть рекомендации →</Button></section>}
function EditableText({title,value,onSave,placeholder}){const [edit,setEdit]=useState(false);const [draft,setDraft]=useState(value||'');return <div className="info-card"><div className="section-head"><h3>{title}</h3><Button kind="ghost" onClick={()=>{setDraft(value||'');setEdit(!edit)}}>{edit?'Отмена':'Изменить'}</Button></div>{edit?<><textarea value={draft} placeholder={placeholder} onChange={e=>setDraft(e.target.value)}/><Button kind="primary" onClick={()=>{onSave(draft);setEdit(false)}}>Сохранить</Button></>:<p>{value||'Не указано'}</p>}</div>}
function HistoryPanel({field,patch}){const [selected,setSelected]=useState(null);const [form,setForm]=useState(null);const begin=record=>{setSelected(record?.id||null);setForm(record?{...record}:{year:new Date().getFullYear(),crop:'',sown:'',harvested:'',yield:null})};const change=(key,value)=>setForm(x=>({...x,[key]:value}));const save=()=>{if(!form.crop.trim()||!(Number(form.year)>=1990&&Number(form.year)<=2100))return;const row={...form,year:Number(form.year),yield:form.yield===''?null:form.yield===null?null:Number(form.yield),id:selected||id(),source:selected?form.source:'Введено фермером'};const next=selected?field.history.map(r=>r.id===selected?row:r):[...field.history,row];patch({history:next.sort((a,b)=>a.year-b.year)});setForm(null)};return <><div className="section-head"><h3>История выращивания</h3><Button onClick={()=>begin(null)}>＋ Запись</Button></div><div className="table-scroll"><table><thead><tr><th>Год</th><th>Культура</th><th>Урожай, т/га</th><th></th></tr></thead><tbody>{field.history.map(r=><tr key={r.id}><td>{r.year}</td><td>{r.crop}</td><td>{fmt(r.yield,2)}</td><td><button className="link-button" onClick={()=>begin(r)}>Изменить</button></td></tr>)}</tbody></table></div>
 {form&&<div className="info-card form"><h3>{selected?'Изменить запись':'Новая запись'}</h3><div className="form-grid"><label>Год<input type="number" min="1990" max="2100" value={form.year} onChange={e=>change('year',e.target.value)}/></label><label>Культура / совместный посев<input value={form.crop} onChange={e=>change('crop',e.target.value)} placeholder="Например, картофель с фасолью"/></label><label>Дата посева<input type="date" value={form.sown||''} onChange={e=>change('sown',e.target.value)}/></label><label>Дата уборки<input type="date" value={form.harvested||''} onChange={e=>change('harvested',e.target.value)}/></label><label>Урожайность, т/га<input type="number" min="0" step="0.01" value={form.yield??''} onChange={e=>change('yield',e.target.value)}/></label></div><div className="action-row"><Button kind="primary" disabled={!form.crop.trim()||form.harvested&&form.sown&&form.harvested<form.sown} onClick={save}>Сохранить запись</Button><Button onClick={()=>setForm(null)}>Отмена</Button></div></div>}
 <div className="info-card"><h3>Сроки посева и уборки</h3>{field.history.map(r=><div className="record-dates" key={r.id}><strong>{r.year} · {r.crop}</strong><span>{date(r.sown)} — {date(r.harvested)}</span></div>)}</div>
 <EditableText key={field.id+'strength'} title="Преимущества поля" value={field.strengths} onSave={v=>patch({strengths:v})} placeholder="Что хорошо на этом поле?"/><EditableText key={field.id+'observations'} title="Наблюдения и проблемы" value={field.observations} onSave={v=>patch({observations:v})} placeholder="Засуха, сорняки, задержка воды…"/>
 </>}
function SoilPanel(props){return <SoilFarmerPanel {...props}/> }
function ClimatePanel({field,patch,onFetch,climateLoading,climateError}){
  const c=field.climate
  return <>
    <div className="section-head"><div><h3>Климат и водные условия</h3><p className="muted small">NASA POWER · май–август</p></div><Button kind="primary" disabled={climateLoading} onClick={onFetch}>{climateLoading?'Загрузка…':c?'Обновить NASA':'Загрузить NASA'}</Button></div>
    {climateError&&<p className="notice" role="alert">{climateError}</p>}
    {c?<>
      <div className="stat-grid">
        <div className="stat"><small>Осадки · {c.latestYear}</small><strong>{fmt(c.latestRainMm,0)} мм</strong></div>
        <div className="stat"><small>От нормы 1991–2020</small><strong>{c.precipAnomalyPct>0?'+':''}{fmt(c.precipAnomalyPct,0)}%</strong></div>
        <div className="stat"><small>Температура · {c.latestYear}</small><strong>{fmt(c.latestTempC)} °C</strong></div>
        <div className="stat"><small>От климатической нормы</small><strong>{c.tempAnomalyC>0?'+':''}{fmt(c.tempAnomalyC)} °C</strong></div>
      </div>
      <div className="info-card"><h3>Дополнительные климатические показатели</h3>
        <div className="data-status">Солнечная радиация: {fmt(c.latestRadiation,2)} кВт·ч/м²/сут</div>
        <div className="data-status">Влажность воздуха: {fmt(c.latestHumidity,1)}%</div>
        <div className="data-status">Ветер: {fmt(c.latestWind,1)} м/с</div>
        <div className="data-status">Влажность корневой зоны (модель): {fmt(c.latestRootWetness,3)}</div>
        {c.moistureError&&<p className="muted small">Влажность корневой зоны отдельно не получена: {c.moistureError}</p>}
        <p className="muted small">NASA POWER · сезон май–август · обновлено {new Date(c.retrievedAt).toLocaleDateString('ru-RU')} · <a href={c.url} target="_blank" rel="noreferrer">запрос NASA</a></p>
      </div>
    </>:<p className="subtle-note">Показатели NASA POWER ещё не получены для выбранного участка. Нажмите «Загрузить NASA».</p>}
    <div className="info-card"><h3>Водные ресурсы</h3><label>Есть ли полив?<select value={field.irrigation||'no'} onChange={e=>patch({irrigation:e.target.value})}><option value="no">Нет</option><option value="yes">Да</option></select></label>
      {field.irrigation==='yes'&&<EditableText key={field.id+'water'} title="Источник воды и ограничения" value={field.waterDetails} onSave={v=>patch({waterDetails:v})} placeholder="Скважина, водоём, объёмы…"/>}
    </div>
  </>
}
function FilesPanel({field,allFields,addDocument,importRecords}){
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const load=async e=>{const file=e.target.files?.[0];if(!file)return;setError('');setPreview(null);setBusy(true)
    try{
      const result=await previewUpload(file)
      const records=(result.rows||[]).map((r,i)=>{
        const matches=allFields.filter(f=>normalize(f.name)===normalize(r.field)||f.id===r.field)
        return {...r,rowKey:`${r.sheet}:${r.line}:${i}`,match:matches.length===1?matches[0].id:null,ambiguous:matches.length>1}
      })
      setPreview({...result,rows:records})
    }catch(err){setError(err.message)}finally{setBusy(false);e.target.value=''}
  }
  const accept=async()=>{
    if(!preview)return;setBusy(true);setError('')
    try{
      const matching=preview.rows.filter(r=>r.match===field.id&&!r.errors?.length)
      await commitUpload(preview.token)
      if(preview.kind==='history'){
        if(!matching.length)throw Error('Нет проверенных записей для выбранного поля')
        importRecords(matching,preview.filename)
      }else addDocument({id:id(),name:preview.filename,kind:'pdf-original',rows:0})
      setPreview(null)
    }catch(err){setError(err.message)}finally{setBusy(false)}
  }
  return <>
    <h3>Документы поля</h3>
    {(field.documents||[]).map(doc=><div className="document-row" key={doc.id}><span>▤</span><div><strong>{doc.name}</strong><small>{doc.kind==='pdf-original'?'PDF · сохранён оригинал':doc.kind==='history-import'?'История из Excel/CSV':doc.kind==='example'?'Демонстрационный файл':doc.kind}</small></div></div>)}
    <label className="file-input">＋ Загрузить Excel, CSV или PDF<input type="file" accept=".csv,.xlsx,.pdf" disabled={busy} onChange={load}/></label>
    {busy&&<p className="muted small">Обработка документа…</p>}
    {error&&<p className="notice" role="alert">{error}</p>}
    {preview&&<div className="info-card"><h3>Проверка импорта · {preview.filename}</h3>
      {preview.kind==='pdf'?<p className="muted small">PDF сохранится как исходный документ. Автоматические измерения из PDF не переносятся в почву без проверки.</p>:<>
        <p className="muted small">Переносится только точное совпадение имени или ID поля и только проверенные строки.</p>
        {preview.errors?.map((msg,i)=><p className="notice" key={i}>{msg}</p>)}
        <div className="table-scroll"><table><thead><tr><th>Лист / строка</th><th>Поле</th><th>Культура</th><th>Состояние</th></tr></thead><tbody>{preview.rows.slice(0,120).map(r=><tr key={r.rowKey}><td>{r.sheet} / {r.line}</td><td>{r.field}</td><td>{r.crop}</td><td>{r.errors?.length?r.errors.join('; '):r.match===field.id?'✓ Совпало':r.match?'Другое поле':'Не совпало'}</td></tr>)}</tbody></table></div>
      </>}
      <div className="action-row"><Button kind="primary" disabled={busy||(preview.kind==='history'&&!preview.rows.some(r=>r.match===field.id&&!r.errors?.length))} onClick={accept}>Подтвердить и сохранить</Button><Button onClick={()=>setPreview(null)}>Отмена</Button></div>
    </div>}
  </>
}
function Data({field,allFields,sub,setSub,patch,onFetch,climateLoading,climateError,onFetchSoil,soilLoading,soilError,addDocument,importRecords}){
  return <section className="panel"><h2>Данные поля</h2><p className="muted">История, почва, климат, вода и документы в одном месте.</p>
    <div className="sub-tabs">{[['crops','Посевы'],['soil','Почва'],['climate','Климат и вода'],['files','Документы']].map(([key,label])=><button key={key} className={sub===key?'active':''} onClick={()=>setSub(key)}>{label}</button>)}</div>
    {sub==='crops'?<HistoryPanel key={field.id} field={field} patch={patch}/>:
      sub==='soil'?<SoilPanel key={field.id} field={field} patch={patch} onFetch={onFetchSoil} loading={soilLoading} error={soilError}/>:
      sub==='climate'?<ClimatePanel field={field} patch={patch} onFetch={onFetch} climateLoading={climateLoading} climateError={climateError}/>:
      <FilesPanel key={field.id} field={field} allFields={allFields} addDocument={addDocument} importRecords={importRecords}/>}
  </section>
}
function Compare({analysis}){return <div className="table-scroll"><table className="compare-table"><thead><tr><th>Критерий</th>{analysis.options.map(x=><th key={x.id}>{x.title}</th>)}</tr></thead><tbody><tr><td>Разнообразие</td>{analysis.options.map(x=><td key={x.id}>{x.id==='diverse'?'Выше':x.id==='fallow'?'Среднее':'Ниже'}</td>)}</tr><tr><td>Урожай каждый год</td>{analysis.options.map(x=><td key={x.id}>{x.id==='fallow'?'Нет':'Да'}</td>)}</tr><tr><td>Влага</td>{analysis.options.map(x=><td key={x.id}>Проверить</td>)}</tr><tr><td>Экспертный балл</td>{analysis.options.map(x=><td key={x.id}>{x.scoring.score===null?'—':`${x.scoring.score}/100`}</td>)}</tr><tr><td>Болезни</td>{analysis.options.map(x=><td key={x.id}>Проверить</td>)}</tr></tbody></table></div>}
function Recommendations({field,patch,onDecide}){const [selected,setSelected]=useState(null),[year,setYear]=useState(0),[showAllGoals,setShowAllGoals]=useState(false),[compare,setCompare]=useState(false),[showEvidence,setShowEvidence]=useState(false),[custom,setCustom]=useState('');const analysis=useMemo(()=>evaluate(field,custom),[field,custom]);const preferred=analysis.preferredId;const choice=analysis.options.find(x=>x.id===selected)||analysis.options.find(x=>x.id===preferred)||analysis.options[0];const isStale=field.approved&&field.approved.dataVersion!==field.dataVersion;return <section className="panel"><h2>AI-рекомендации</h2><p className="muted">Три стратегии, один предпочтительный вариант и окончательное решение за вами.</p><div className="info-card"><div className="section-head"><h3>Ваши цели</h3><Button kind="ghost" onClick={()=>setShowAllGoals(!showAllGoals)}>{showAllGoals?'Свернуть':'Все цели'}</Button></div><div className="check-grid">{GOALS.filter((_,i)=>showAllGoals||i<4).map(([key,label])=><label key={key} className="checkbox-line"><input type="checkbox" checked={field.goals.includes(key)} onChange={e=>patch({goals:e.target.checked?[...field.goals,key]:field.goals.filter(x=>x!==key)})}/>{label}</label>)}</div><label>Другая цель<textarea value={field.ownGoal||''} onChange={e=>patch({ownGoal:e.target.value})} placeholder="Например, хочу меньше обрабатывать почву"/></label><div className="form-grid"><label>Бюджет, ₸<input type="number" value={field.budget||''} onChange={e=>patch({budget:e.target.value})}/></label><label>Что входит в бюджет?<select value={field.budgetScope||'season'} onChange={e=>patch({budgetScope:e.target.value})}><option value="season">Все расходы на сезон</option><option value="seeds">Только семена</option></select></label></div></div>
 <div className="ai-highlight"><span className="eyebrow">ПРЕДВАРИТЕЛЬНЫЙ ВЫБОР СИСТЕМЫ</span><h3>{analysis.options.find(x=>x.id===preferred)?.title}</h3><p>{analysis.reason}</p>{field.climate&&<p className="small">NASA POWER: осадки за {field.climate.latestYear} — {fmt(field.climate.latestRainMm,0)} мм; отклонение от базового периода: {fmt(field.climate.precipAnomalyPct,0)}%.</p>}</div>
 <div className="info-card"><h3>Климатический риск и адаптация</h3><p>{analysis.climateRisk?.label}</p><strong>{analysis.adaptation?.title}</strong><p>{analysis.adaptation?.description}</p><p className="muted small">{analysis.adaptation?.note}</p></div><h3>Три стратегии севооборота</h3><div className="rotation-list">{analysis.options.map(opt=><button className={'rotation-option '+(opt.id===selected?'selected':'')} onClick={()=>{setSelected(opt.id);setYear(0)}} key={opt.id}><div className="section-head"><strong>{opt.title}</strong>{opt.id===preferred&&<span className="pill">Предварительный выбор</span>}</div><div className="year-grid">{opt.crops.map((c,i)=><div className="year" key={i}><small>{2027+i}</small><strong>{c}</strong></div>)}</div><p>{opt.pros}</p><p className="small"><strong>Экспертная оценка: {opt.scoring.score===null?'нет данных':`${opt.scoring.score}/100`}</strong> · критериев {opt.scoring.coverage}/4</p></button>)}</div>
 <ScoringDetails scoring={choice.scoring}/><Button className="full" onClick={()=>setCompare(!compare)}>{compare?'Скрыть сравнение':'Сравнить три варианта'}</Button>{compare&&<Compare analysis={analysis}/>}
 <div className="info-card"><h3>Почему именно эти культуры?</h3><div className="sub-tabs">{choice.crops.map((_,i)=><button key={i} onClick={()=>setYear(i)} className={year===i?'active':''}>{2027+i}</button>)}</div><h3>{choice.crops[year]}</h3><div className="evidence"><div><strong>Почему эта культура</strong><p>{choice.rationale[year]}</p>{choice.scoring?.cropChecks?.[year]?.map((note,i)=><p className="small" key={i}>· {note}</p>)}</div><div><strong>Научная проверка последовательности</strong>{choice.scientific?.evidence.map((line,i)=><p key={i}>{line}</p>)}</div><div><strong>Данные фермера</strong><p>История: {field.history.map(x=>`${x.year} — ${x.crop}`).join('; ')||'нет записей'}. {field.observations||'Особенности не указаны.'}</p></div><div><strong>Данные NASA</strong><p>{field.climate?`Осадки последнего полного сезона: ${fmt(field.climate.latestRainMm,0)} мм, отклонение от климатической нормы ${fmt(field.climate.precipAnomalyPct,0)}%, температура ${fmt(field.climate.latestTempC)} °C. Эти показатели служат контекстом, а не прогнозом урожая.`:'Для проверки нужны сезонные осадки, температура и климатические аномалии NASA POWER. Запрос ещё не выполнен.'}</p></div><div><strong>Научное основание</strong><p>Смена предшественников может влиять на почвенные процессы, водный режим и фитосанитарные риски. Эффект для конкретного поля требует дополнительной проверки.</p><a href={(SOURCES[choice.source] || SOURCES.rotation).url} target="_blank" rel="noreferrer">{(SOURCES[choice.source] || SOURCES.rotation).label} ↗</a></div><div className="evidence-risk"><strong>Что может изменить выбор</strong><p>{choice.cons}</p>{choice.checks.map((s,i)=><p key={i}>· {s}</p>)}</div></div><Button kind="ghost" onClick={()=>setShowEvidence(!showEvidence)}>{showEvidence?'Скрыть методику':'Источники и методика'}</Button>{showEvidence&&<div className="subtle-note"><p>{analysis.method}</p><p><a href={SOURCES.nasa.url} target="_blank" rel="noreferrer">NASA POWER ↗</a> · <a href={SOURCES.soil.url} target="_blank" rel="noreferrer">SoilGrids ↗</a> · <a href={SOURCES.ecocrop.url} target="_blank" rel="noreferrer">FAO EcoCrop (справочник) ↗</a> · <a href={SOURCES.rotat.url} target="_blank" rel="noreferrer">ROTAT (принципы) ↗</a></p><p>Источники климатических и почвенных данных не заменяют публикаций, подтверждающих агрономическое правило.</p></div>}</div>
 <div className="info-card"><h3>Предложить свой вариант</h3><p className="muted small">Напишите последовательность культур. Её необходимо проверить до включения в рекомендации.</p><textarea value={custom} onChange={e=>setCustom(e.target.value)} placeholder="2027 — ячмень; 2028 — горох; 2029 — пшеница"/><Button onClick={()=>onDecide({type:'proposal',text:custom,choice:preferred})} disabled={!custom.trim()}>Сохранить предложение для проверки</Button></div>
 {isStale&&<p className="notice">После изменения данных прежний расчёт устарел; требуется обновить сравнение.</p>}
 {field.approved&&<div className="info-card"><strong>Утверждённый план: {field.approved.name}</strong><p className="muted small">Он не изменяется автоматически, даже если появился новый вариант.</p></div>}
 <div className="action-row"><Button kind="primary" disabled={!analysis.hasNasa||!analysis.hasSoil} onClick={()=>onDecide({type:'approve',analysis,choice:preferred})}>Утвердить выбор системы</Button><Button onClick={()=>onDecide({type:'draft',analysis,choice:preferred})}>Сохранить черновик</Button><Button onClick={()=>onDecide({type:'reject',analysis,choice:preferred})}>Отклонить</Button></div>
 {(!analysis.hasNasa||!analysis.hasSoil)&&<p className="subtle-note">Утверждение заблокировано, пока не выполнены ключевые проверки. Для утверждения загрузите климат NASA и укажите хотя бы одно наблюдение о почве (тип, влажность или плодородие). Точные лабораторные показатели необязательны. Без этих данных можно сохранить черновик. Сорта, препараты и бюджет должны быть проверены дополнительно.</p>}
 </section>}
function Archive({field}){return <section className="panel"><h2>История анализов</h2><p className="muted">Отдельно для поля «{field.name}».</p>{!field.analyses?.length?<p className="subtle-note">Результатов и решений пока нет.</p>:field.analyses.map(a=><div className="info-card" key={a.id}><div className="section-head"><h3>{a.type==='approve'?'Утверждённый план':a.type==='reject'?'Отклонение рекомендации':a.type==='draft'?'Сохранённый черновик':'Предложение фермера'}</h3><small className="muted">{new Date(a.date).toLocaleDateString('ru-RU')}</small></div><p>{a.name||a.text}</p><small className="muted">Версия данных: {a.dataVersion}</small></div>)}<p className="muted small">План — это намерение, а не фактическая история посевов.</p></section>}
export default function App(){
  const [fields,setFields]=useState(loadFields)
  const [fid,setFid]=useState('north'),[page,setPage]=useState('overview'),[sub,setSub]=useState('crops')
  const [mapEdit,setMapEdit]=useState(null)
  const [climateLoading,setClimateLoading]=useState(false),[climateError,setClimateError]=useState('')
  const [soilLoading,setSoilLoading]=useState(false),[soilError,setSoilError]=useState('')
  const field=fields.find(f=>f.id===fid)||fields[0]
  useEffect(()=>saveFields(fields),[fields])
  const patch=changes=>setFields(prev=>prev.map(f=>f.id===field.id?{...f,...changes,dataVersion:(f.dataVersion||1)+1}:f))
  const addNew=()=>{setMapEdit({id:null,name:'',center:[54.87,69.15],geometry:null});setPage('map')}
  const saveMap=values=>{
    if(mapEdit?.id){const moved=values.geometry!==field.geometry;patch({...values,...(moved?{climate:null,soilResult:null}:{})})}
    else{
      const seed=structuredClone(DEMO_FIELDS[0])
      const next={...seed,...values,id:id(),region:'Северо-Казахстанская область',history:[],documents:[],analyses:[],approved:null,climate:null,soilResult:null,soilManual:{},observations:'',strengths:'',extra:'',budget:'',goals:['harvest','soil'],dataVersion:1}
      setFields(fs=>[...fs,next]);setFid(next.id)
    }
    setMapEdit(null);setPage('overview')
  }
  const loadClimate=async()=>{setClimateLoading(true);setClimateError('');try{const climate=await loadNasa(field);patch({climate})}catch(err){setClimateError(err.message)}finally{setClimateLoading(false)}}
  const loadSoilData=async()=>{setSoilLoading(true);setSoilError('');try{const soilResult=await loadSoil(field);patch({soilResult})}catch(err){setSoilError(err.message)}finally{setSoilLoading(false)}}
  const addDocument=doc=>patch({documents:[...(field.documents||[]),doc]})
  const importRecords=(rows,filename)=>{
    const newRows=rows.map(r=>({id:id(),year:r.year,crop:r.crop,yield:r.yield,sown:r.sown,harvested:r.harvested,source:`${filename}, лист «${r.sheet}», строка ${r.line}`}))
    patch({history:[...field.history,...newRows].sort((a,b)=>a.year-b.year),documents:[...field.documents,{id:id(),name:filename,kind:'history-import',rows:newRows.length}]})
  }
  const onDecide=action=>{
    const selectedOption=action.analysis?.options?.find(x=>x.id===action.choice)
    const entry={id:id(),date:new Date().toISOString(),dataVersion:field.dataVersion,type:action.type,name:selectedOption?.title||'',text:action.text||'',choice:action.choice}
    if(action.type==='approve'){
      if(!action.analysis?.hasNasa||!action.analysis?.hasSoil||!selectedOption)return
      setFields(fs=>fs.map(f=>f.id===fid?{...f,approved:{name:selectedOption.title,crops:selectedOption.crops,startYear:2027,dataVersion:f.dataVersion,status:'Выбор фермера на основании предварительного анализа'},analyses:[entry,...(f.analyses||[])]}:f))
      setPage('overview')
    }else setFields(fs=>fs.map(f=>f.id===fid?{...f,analyses:[entry,...(f.analyses||[])]}:f))
  }
  return <div className="site"><div className="site-shell">
    <Top onHome={()=>setPage('overview')}/>
    <FieldCards fields={fields} active={field.id} onPick={target=>{setFid(target);setPage('overview');setClimateError('');setSoilError('')}} onAdd={addNew}/>
    {page!=='map'&&<><div className="selected-field"><strong>{field.name}</strong><span>{field.areaHa?`${fmt(field.areaHa,2)} га · `:''}{field.region}</span></div><nav className="main-tabs">{PAGES.map(([key,label])=><button key={key} className={page===key?'active':''} onClick={()=>setPage(key)}>{label}</button>)}</nav></>}
    {page==='overview'?<Overview field={field} onMap={()=>{setMapEdit(field);setPage('map')}} onData={()=>{setSub('crops');setPage('data')}} onAI={()=>setPage('ai')}/>:
      page==='map'?<FieldMap key={mapEdit?.id||'new'} field={mapEdit} onSave={saveMap} onCancel={()=>setPage('overview')}/>:
      page==='data'?<Data key={field.id} field={field} allFields={fields} sub={sub} setSub={setSub} patch={patch} onFetch={loadClimate} climateLoading={climateLoading} climateError={climateError} onFetchSoil={loadSoilData} soilLoading={soilLoading} soilError={soilError} addDocument={addDocument} importRecords={importRecords}/>:
      page==='ai'?<Recommendations key={field.id} field={field} patch={patch} onDecide={onDecide}/>:<Archive field={field}/>}
    <footer>AgroShield AI · Решение принимает фермер</footer>
  </div></div>
}
