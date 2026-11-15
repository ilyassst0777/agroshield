import { useState } from 'react'
import { evaluate, SOURCES } from './rotationEngine.js'
import { CROP_CATALOG, planningFor, RULE_VERSION } from './cropCatalog.js'
import { observationSuggestions, confirmedSuggestions } from './analysisProfile.js'
import AssessmentDetails from './AssessmentDetails.jsx'
import {STATUS_LABELS} from './qualitativeEngine.js'

const GOALS = [['harvest', 'Посев в следующем сезоне'], ['soil', 'Разнообразить группы культур'], ['cost', 'Сократить известные расходы'], ['erosion', 'Снизить риски парового года при эрозии']]
const fmt = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : 'неизвестно'
const STATUS = { used: 'Учтено', context: 'Справочно', missing: 'Не хватает данных', review: 'Сведения для уточнения' }
const Button = ({ children, primary, ...props }) => <button type="button" className={`btn ${primary ? 'primary' : 'secondary'}`} {...props}>{children}</button>

function PlanningInputs({ draft, setDraft }) {
  const set = (key, value) => { setDraft(old => ({ ...old, [key]: value })) }
  const rule = (id, key, value) => {
    setDraft(old => ({ ...old, cropRules: { ...old.cropRules, [id]: { ...old.cropRules?.[id], [key]: value } } }))
  }
  const toggle = (id, checked) => set('allowedCrops', checked ? [...draft.allowedCrops, id] : draft.allowedCrops.filter(value => value !== id))
  return <details className="info-card planning-settings" open>
    <summary><strong>Условия подбора и затраты</strong></summary>
    <p className="muted small">Укажите доступные культуры и известные ограничения. Пустая стоимость означает «неизвестно». Для пара тоже нужны затраты на содержание.</p>
    <div className="form-grid">
      <label>Первый год плана<input type="number" min="1991" max="2098" value={draft.startYear} onChange={event => set('startYear', event.target.value)} /></label>
      <label>Доступно дней для выращивания<input type="number" min="1" max="365" value={draft.maxGrowingDays ?? ''} onChange={event => set('maxGrowingDays', event.target.value)} placeholder="Если известно для местных условий" /></label>
      <label>Не более паровых лет в плане<select value={draft.maxFallowYears} onChange={event => set('maxFallowYears', Number(event.target.value))}>{[0, 1, 2, 3].map(number => <option key={number} value={number}>{number}</option>)}</select></label>
    </div>
    <div className="check-grid">{CROP_CATALOG.map(crop => <label className="checkbox-line" key={crop.id}>
      <input type="checkbox" checked={draft.allowedCrops.includes(crop.id)} onChange={event => toggle(crop.id, event.target.checked)} />{crop.name}
    </label>)}</div>
    <div className="table-scroll"><table className="cost-input-table"><thead><tr><th>Культура</th><th>Семена, ₸/га</th><th>Все расходы, ₸/га</th></tr></thead><tbody>
      {CROP_CATALOG.filter(crop => draft.allowedCrops.includes(crop.id)).map(crop => <tr key={crop.id}><td>{crop.name}</td>
        <td><input aria-label={`Семена ${crop.name}, ₸/га`} type="number" min="0" value={draft.cropRules?.[crop.id]?.seedCostHa ?? ''} onChange={event => rule(crop.id, 'seedCostHa', event.target.value)} /></td>
        <td><input aria-label={`Все расходы ${crop.name}, ₸/га`} type="number" min="0" value={draft.cropRules?.[crop.id]?.seasonCostHa ?? ''} onChange={event => rule(crop.id, 'seasonCostHa', event.target.value)} /></td>
      </tr>)}
    </tbody></table></div>
    <label>Источник и дата цен<input value={draft.costSource || ''} onChange={event => set('costSource', event.target.value)} placeholder="Смета хозяйства, поставщик, дата" /></label>
    <details><summary>Настройки агронома — необязательно</summary>
      <p className="small muted">Числа задаются для местных сортов и условий. Источник сохраняется с расчётом. Модельный pH не создаёт автоматический запрет.</p>
      {CROP_CATALOG.filter(crop => draft.allowedCrops.includes(crop.id)).map(crop => {
        const values = draft.cropRules?.[crop.id] || {}
        return <details className="crop-rule" key={crop.id}><summary>{crop.name}</summary>
          <label className="checkbox-line"><input type="checkbox" checked={Boolean(values.blocked)} onChange={event => rule(crop.id, 'blocked', event.target.checked)} />Запрещена для этого поля по известному ограничению</label>
          {values.blocked && <label>Причина запрета<input value={values.blockReason || ''} onChange={event => rule(crop.id, 'blockReason', event.target.value)} /></label>}
          <div className="form-grid">
            <label>Минимальный интервал возврата, лет<input type="number" min="1" max="30" value={values.minReturnYears ?? ''} onChange={event => rule(crop.id, 'minReturnYears', event.target.value)} /></label>
            <label>От посева до уборки, дней<input type="number" min="1" max="365" value={values.maturityDays ?? ''} onChange={event => rule(crop.id, 'maturityDays', event.target.value)} /></label>
            <label>Минимальный pH<input type="number" min="0.1" max="14" step="0.1" value={values.phMin ?? ''} onChange={event => rule(crop.id, 'phMin', event.target.value)} /></label>
            <label>Максимальный pH<input type="number" min="0.1" max="14" step="0.1" value={values.phMax ?? ''} onChange={event => rule(crop.id, 'phMax', event.target.value)} /></label>
            <label>Верхний ориентир средней температуры мая–августа, °C<input type="number" step="0.1" value={values.maxSeasonTempC ?? ''} onChange={event => rule(crop.id, 'maxSeasonTempC', event.target.value)} placeholder="Не дневной максимум" /></label>
            <label>Источник правил<input value={values.ruleSource || ''} onChange={event => rule(crop.id, 'ruleSource', event.target.value)} placeholder="Агроном, публикация, этикетка" /></label>
          </div>
          <label className="checkbox-line"><input type="checkbox" checked={Boolean(values.needsIrrigation)} onChange={event => rule(crop.id, 'needsIrrigation', event.target.checked)} />По условиям хозяйства требует обязательного полива</label>
        </details>
      })}
    </details>
    <p className="muted small">Условия сохранятся при запуске подбора или проверке своей схемы.</p>
  </details>
}

function ObservationReview({ field, patch }) {
  const [selected, setSelected] = useState([])
  const suggestions = observationSuggestions(field)
  if (!suggestions.length) return null
  return <div className="notice">
    <strong>Подтвердите наблюдения из ваших заметок</strong>
    <p className="small">«{field.observations || field.soilManual?.notes}»</p>
    {suggestions.map(item => <label className="checkbox-line" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(old => event.target.checked ? [...old, item.id] : old.filter(value => value !== item.id))} />{item.label}</label>)}
    <Button disabled={!selected.length} onClick={() => { patch({ soilManual: confirmedSuggestions(field, selected) }); setSelected([]) }}>Учесть подтверждённые наблюдения</Button>
    <p className="small">Это качественные сведения фермера; лабораторные измерения не подставляются.</p>
  </div>
}

function Compare({ options }) {
 return <div className="table-scroll"><table className="compare-table"><thead><tr><th>Проверка</th>{options.map(o=><th key={o.id}>{o.title}</th>)}</tr></thead><tbody>
 <tr><td>Результат</td>{options.map(o=><td key={o.id}>{STATUS_LABELS[o.assessment.status]||'Обоснование ниже'}</td>)}</tr>
 <tr><td>Разнообразие</td>{options.map(o=><td key={o.id}>{o.structure.groups} группы</td>)}</tr>
 <tr><td>Повторы подряд</td>{options.map(o=><td key={o.id}>{o.structure.repeats}</td>)}</tr>
 <tr><td>Расходы за три года</td>{options.map(o=><td key={o.id}>{fmt(o.costs.total)} ₸</td>)}</tr>
 </tbody></table></div>
}
export default function Recommendations({field,patch,onDecide,onCalculated,onData}){
 const [draft,setDraft]=useState(()=>planningFor(field))
 const [analysis,setAnalysis]=useState(()=>field.lastAnalysis?.ruleVersion===RULE_VERSION?field.lastAnalysis:null)
 const [selected,setSelected]=useState(null),[custom,setCustom]=useState(['wheat','pea','barley'])
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const dirty=JSON.stringify(draft)!==JSON.stringify(planningFor(field))
 const stale=analysis&&(analysis.dataVersion!==field.dataVersion||dirty)
 const choice=analysis?.options.find(o=>o.id===selected)||(analysis?.customOption?.id===selected?analysis.customOption:null)||analysis?.options[0]
 const run=async(withCustom=false)=>{
  setBusy(true);setError('')
  try{
   await new Promise(resolve=>setTimeout(resolve,0))
   const effective={...field,planning:draft,dataVersion:dirty?(field.dataVersion||1)+1:field.dataVersion}
   const result={...evaluate(effective,withCustom?custom:''),calculatedAt:new Date().toISOString()}
   if(dirty)patch({planning:draft})
   setAnalysis(result);setSelected(withCustom&&result.customOption?.eligible?result.customOption.id:result.options[0]?.id||null)
   onCalculated(result)
  }catch(cause){setError(`Проверка не выполнена: ${cause.message}`)}finally{setBusy(false)}
 }
 const decide=type=>onDecide({type,analysis,choice:choice?.id})
 return <section className="panel recommendations">
 <h2>Подбор севооборота</h2><p className="muted">Сравните последовательности по данным поля или предложите свою. Решение остаётся за вами.</p>
 <ObservationReview field={field} patch={patch}/>
 <div className="info-card"><h3>Ваши цели</h3><div className="check-grid">{GOALS.map(([id,label])=><label className="checkbox-line" key={id}><input type="checkbox" checked={(field.goals||[]).includes(id)} onChange={e=>patch({goals:e.target.checked?[...(field.goals||[]),id]:(field.goals||[]).filter(v=>v!==id)})}/>{label}</label>)}</div>
 <details><summary>Бюджет и дополнительные пожелания</summary><div className="form-grid">
 <label>Бюджет, ₸<input type="number" min="0" value={field.budget??''} onChange={e=>patch({budget:e.target.value})}/></label>
 <label>Состав бюджета<select value={field.budgetScope||'season'} onChange={e=>patch({budgetScope:e.target.value})}><option value="season">Все расходы на сезон</option><option value="seeds">Только семена</option></select></label>
 <label>Период бюджета<select value={draft.budgetPeriod} onChange={e=>setDraft(d=>({...d,budgetPeriod:e.target.value}))}><option value="annual">На каждый сезон</option><option value="rotation">На все три года</option></select></label>
 </div><label>Другие пожелания<textarea value={field.ownGoal||''} onChange={e=>patch({ownGoal:e.target.value})} placeholder="Сохраняются как заметка к плану"/></label></details></div>
 <PlanningInputs draft={draft} setDraft={setDraft}/>
 <div className="calculation-bar"><Button primary disabled={busy} onClick={()=>run()}>{busy?'Проверяем последовательности…':'Подобрать севооборот'}</Button><Button onClick={onData}>Данные поля</Button></div>
 {error&&<p className="notice" role="alert">{error}</p>}
 {stale&&<p className="notice">Условия изменились. Запустите подбор заново: ниже предыдущий результат.</p>}
 {analysis&&<>
 <div className="ai-highlight"><span className="eyebrow">ПРЕДВАРИТЕЛЬНЫЕ ВАРИАНТЫ</span><p>{analysis.reason}</p><p className="small">Проверено последовательностей: {analysis.generatedCount}. Исключено по заданным ограничениям: {analysis.rejectedCount}.</p></div>
 {analysis.inputErrors.length>0&&<div className="notice" role="alert">{analysis.inputErrors.map(t=><p key={t}>{t}</p>)}</div>}
 <div className="rotation-list">{analysis.options.map((o,i)=><button type="button" className={`rotation-option ${choice?.id===o.id?'selected':''}`} key={o.id} aria-pressed={choice?.id===o.id} onClick={()=>setSelected(o.id)}><div className="section-head"><strong>Вариант {i+1}</strong>{STATUS_LABELS[o.assessment.status]&&<span className="pill">{STATUS_LABELS[o.assessment.status]}</span>}</div><div className="year-grid">{o.crops.map((c,j)=><div className="year" key={j}><small>{analysis.startYear+j}</small><strong>{c}</strong></div>)}</div><p>{o.assessment.strengths[0]||'Вариант для сравнения по доступным сведениям.'}</p><p>Расходы за три года: {o.costs.total===null?'не рассчитаны':`${fmt(o.costs.total)} ₸`}</p></button>)}</div>
 {analysis.options.length>1&&<details className="info-card"><summary>Сравнить варианты</summary><Compare options={analysis.options}/></details>}
 {choice&&<><div className="info-card"><h3>Выбранный вариант: {choice.title}</h3><AssessmentDetails option={choice}/><details><summary>Расходы по годам</summary><p className="small muted">{choice.costs.basis}; источник: {analysis.inputSnapshot.planning.costSource||'не указан'}.</p><div className="table-scroll"><table><thead><tr><th>Год</th><th>Культура</th><th>₸/га</th><th>На поле, ₸</th></tr></thead><tbody>{choice.costs.years.map(row=><tr key={row.year}><td>{row.year}</td><td>{row.crop}</td><td>{fmt(row.perHa)}</td><td>{fmt(row.total)}</td></tr>)}</tbody></table></div></details></div>
 <div className="action-row"><Button primary disabled={stale||!choice.canApprove} onClick={()=>decide('approve')}>Сохранить выбранный план</Button><Button disabled={stale} onClick={()=>decide('draft')}>Сохранить черновик</Button><Button disabled={stale} onClick={()=>decide('reject')}>Отклонить вариант</Button></div>
 {!choice.canApprove&&<p className="muted small">Доступно сохранение черновика. Неполные проверки перечислены в обосновании.</p>}</>}
 <details className="info-card"><summary>Использованные данные</summary>{analysis.ledger.map(row=><div className="record-dates" key={row.label}><strong>{row.label} · {STATUS[row.status]}</strong><p className="small muted">{row.detail}</p></div>)}</details>
 {analysis.rejectedExamples.length>0&&<details className="info-card"><summary>Почему исключены другие варианты</summary>{analysis.rejectedExamples.map(o=><div key={o.title}><strong>{o.title}</strong>{o.reasons.map(t=><p className="small" key={t}>{t}</p>)}</div>)}</details>}
 </>}
 <div className="info-card"><h3>А если посеять по-другому?</h3><p className="muted small">Предложите свою схему. Проверим её по тем же условиям и объясним, что подходит и что вызывает сомнения.</p><div className="custom-crops">{custom.map((value,i)=><label key={i}>{Number(draft.startYear)+i}<select value={value} onChange={e=>setCustom(old=>old.map((v,j)=>i===j?e.target.value:v))}>{CROP_CATALOG.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>)}</div><Button primary disabled={busy} onClick={()=>run(true)}>Проверить мой вариант</Button>
 {analysis?.customError&&<p className="notice" role="alert">{analysis.customError}</p>}
 {analysis?.customOption&&<div className={analysis.customOption.eligible?'subtle-note':'notice'}><h3>{analysis.customOption.title}</h3><AssessmentDetails option={analysis.customOption}/>{analysis.options.length>0&&analysis.customOption.assessment.status!=='consider'&&<p>Для сравнения рассмотрите также: {analysis.options[0].title}. Причины и проверки показаны выше.</p>}</div>}
 </div>
 <details className="info-card"><summary>Как работает подбор и источники</summary><p>{analysis?.method||'Программа перебирает последовательности культур, проверяет известные ограничения и объясняет различия. Это система поддержки решения; требования сортов и непроверенные условия не выдумываются.'}</p><p className="small">Региональная публикация относится к предшественникам яровой твёрдой пшеницы на обыкновенном чернозёме. Она не подтверждает оптимальность любой трёхлетней схемы. Полного регионального справочника сортов в прототипе пока нет.</p>{Object.values(SOURCES).map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></p>)}</details>
 </section>
}
