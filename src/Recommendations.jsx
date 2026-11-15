import { useState } from 'react'
import { evaluate, SOURCES } from './rotationEngine.js'
import { CROP_CATALOG, planningFor, RULE_VERSION } from './cropCatalog.js'
import { observationSuggestions, confirmedSuggestions } from './analysisProfile.js'
import ScoringDetails from './ScoringDetails.jsx'

const GOALS = [['harvest', 'Урожай в следующем сезоне'], ['soil', 'Сохранить плодородие'], ['water', 'Снизить риск засухи'], ['cost', 'Сократить расходы'], ['early', 'Собрать урожай раньше'], ['stable', 'Устойчивость к разным сезонам'], ['diversity', 'Разнообразить культуры'], ['erosion', 'Уменьшить эрозию']]
const fmt = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : 'неизвестно'
const STATUS = { used: 'Учтено', context: 'Справочно', missing: 'Не хватает данных', review: 'Нужна проверка' }
const Button = ({ children, primary, ...props }) => <button type="button" className={`btn ${primary ? 'primary' : 'secondary'}`} {...props}>{children}</button>

function PlanningInputs({ field, patch }) {
  const [draft, setDraft] = useState(() => planningFor(field))
  const [saved, setSaved] = useState(false)
  const set = (key, value) => { setDraft(old => ({ ...old, [key]: value })); setSaved(false) }
  const rule = (id, key, value) => {
    setDraft(old => ({ ...old, cropRules: { ...old.cropRules, [id]: { ...old.cropRules?.[id], [key]: value } } }))
    setSaved(false)
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
    <details><summary>Ограничения культур: возврат, pH, сроки, полив</summary>
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
    <div className="action-row"><Button primary disabled={!draft.allowedCrops.length} onClick={() => { patch({ planning: draft }); setSaved(true) }}>Сохранить условия</Button>{saved && <span className="small" role="status">Условия сохранены. Пересчитайте варианты.</span>}</div>
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
  return <div className="table-scroll"><table className="compare-table"><thead><tr><th>Критерий</th>{options.map(option => <th key={option.id}>{option.crops.join(' → ')}</th>)}</tr></thead><tbody>
    <tr><td>Баллы / учтённый вес</td>{options.map(option => <td key={option.id}>{fmt(option.scoring.score)} / {option.scoring.usedWeight}%</td>)}</tr>
    {['agronomy', 'climate', 'water', 'soil', 'economy', 'goals'].map(key => <tr key={key}><td>{({ agronomy: 'История', climate: 'NASA', water: 'Влага', soil: 'Почва', economy: 'Бюджет', goals: 'Предпочтения' })[key]}</td>{options.map(option => <td key={option.id}>{fmt(option.scoring.dimensions[key].score)}</td>)}</tr>)}
    <tr><td>Расходы за три года, ₸</td>{options.map(option => <td key={option.id}>{fmt(option.scoring.costs.total)}</td>)}</tr>
  </tbody></table></div>
}

export default function Recommendations({ field, patch, onDecide, onCalculated, onData }) {
  const [analysis, setAnalysis] = useState(() => field.lastAnalysis?.ruleVersion === RULE_VERSION ? field.lastAnalysis : null)
  const [selected, setSelected] = useState(null), [year, setYear] = useState(0)
  const [custom, setCustom] = useState(['wheat', 'pea', 'barley'])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const planning = planningFor(field)
  const stale = analysis && (analysis.dataVersion !== field.dataVersion || analysis.ruleVersion !== RULE_VERSION)
  const choice = analysis?.options.find(option => option.id === selected) ||
    (analysis?.customOption?.id === selected ? analysis.customOption : null) || analysis?.options[0]
  const run = async (withCustom = false) => {
    setBusy(true); setError('')
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      const result = { ...evaluate(field, withCustom ? custom : ''), calculatedAt: new Date().toISOString() }
      setAnalysis(result); setSelected(withCustom && result.customOption?.eligible ? result.customOption.id : result.preferredId); setYear(0)
      onCalculated(result)
    } catch (cause) { setError(`Расчёт не выполнен: ${cause.message}`) } finally { setBusy(false) }
  }
  const decide = type => onDecide({ type, analysis, choice: choice?.id })
  return <section className="panel recommendations">
    <h2>AI-рекомендации</h2>
    <p className="muted">Подбор севооборота по данным выбранного поля. Расчёт по открытым правилам; нейросеть не подключена.</p>
    <ObservationReview field={field} patch={patch} />
    <div className="info-card"><h3>Ваши цели и бюджет</h3>
      <div className="check-grid">{GOALS.map(([id, label]) => <label className="checkbox-line" key={id}><input type="checkbox" checked={(field.goals || []).includes(id)} onChange={event => patch({ goals: event.target.checked ? [...(field.goals || []), id] : field.goals.filter(value => value !== id) })} />{label}</label>)}</div>
      <label>Другая цель<textarea value={field.ownGoal || ''} onChange={event => patch({ ownGoal: event.target.value })} placeholder="Сохраним для проверки; в баллы автоматически не переводится" /></label>
      <div className="form-grid">
        <label>Бюджет, ₸<input type="number" min="0" value={field.budget ?? ''} onChange={event => patch({ budget: event.target.value })} /></label>
        <label>Что входит в бюджет?<select value={field.budgetScope || 'season'} onChange={event => patch({ budgetScope: event.target.value })}><option value="season">Все расходы на сезон</option><option value="seeds">Только семена</option></select></label>
        <label>Период бюджета<select value={planning.budgetPeriod} onChange={event => patch({ planning: { ...planning, budgetPeriod: event.target.value } })}><option value="annual">На каждый сезон отдельно</option><option value="rotation">На все три года вместе</option></select></label>
      </div>
    </div>
    <PlanningInputs key={`${field.id}:${JSON.stringify(field.planning || {})}`} field={field} patch={patch} />
    <div className="calculation-bar"><Button primary disabled={busy} onClick={() => run()}>{busy ? 'Проверяем варианты…' : 'Рассчитать севооборот'}</Button><Button onClick={onData}>Дополнить данные поля</Button></div>
    {error && <p className="notice" role="alert">{error}</p>}
    {!analysis && <p className="subtle-note">Сохраните условия и запустите расчёт. Будут проверены все трёхлетние сочетания выбранных культур.</p>}
    {stale && <p className="notice" role="status">Данные изменились. Ниже показан предыдущий расчёт; пересчитайте перед сохранением решения.</p>}
    {analysis && <div className={stale ? 'analysis-stale' : ''}>
      <div className="ai-highlight" aria-live="polite"><span className="eyebrow">ПРЕДВАРИТЕЛЬНЫЙ РЕЗУЛЬТАТ</span><h3>{analysis.options.length ? analysis.options[0].title : 'Нет подходящих вариантов'}</h3><p>{analysis.reason}</p>
        <p className="small">Проверено: {analysis.generatedCount}. Без выявленных нарушений: {analysis.eligibleCount}. Исключено: {analysis.rejectedCount}.</p>
      </div>
      {analysis.inputErrors.length > 0 && <div className="notice" role="alert">{analysis.inputErrors.map(note => <p key={note}>{note}</p>)}</div>}
      <details className="info-card"><summary><strong>Какие данные участвовали в расчёте</strong></summary><div className="input-ledger">{analysis.ledger.map(item => <div key={item.label}><strong>{item.label}</strong><span className={`pill ledger-${item.status}`}>{STATUS[item.status]}</span><p className="small muted">{item.detail}</p></div>)}</div></details>
      {analysis.limitations.length > 0 && <div className="notice"><strong>Что ещё нужно проверить</strong>{analysis.limitations.map(note => <p className="small" key={note}>• {note}</p>)}</div>}
      <div className="rotation-list" aria-label="Результаты подбора">{analysis.options.map((option, index) => <button type="button" className={`rotation-option ${choice?.id === option.id ? 'selected' : ''}`} key={option.id} aria-pressed={choice?.id === option.id} onClick={() => { setSelected(option.id); setYear(0) }}>
        <div className="section-head"><strong>Вариант {index + 1}</strong>{option.id === analysis.preferredId && <span className="pill">{analysis.tied ? 'Один из первых' : 'Первый по оценке'}</span>}</div>
        <div className="year-grid">{option.crops.map((crop, index) => <div className="year" key={index}><small>{analysis.startYear + index}</small><strong>{crop}</strong></div>)}</div>
        <p><strong>{fmt(option.scoring.score)}/100</strong> · учтено {option.scoring.usedWeight}% веса · критериев {option.scoring.coverage}/{option.scoring.criteriaCount}</p>
        <p>Расходы за три года: {fmt(option.scoring.costs.total)} ₸</p>
      </button>)}</div>
      {analysis.options.length > 1 && <details className="info-card"><summary><strong>Сравнить варианты</strong></summary><Compare options={analysis.options} /></details>}
      {analysis.rejectedExamples.length > 0 && <details className="info-card"><summary>Почему исключены другие последовательности</summary>{analysis.rejectedExamples.map(option => <div key={option.title}><h3>{option.title}</h3>{option.reasons.map(reason => <p className="small" key={reason}>{reason}</p>)}</div>)}</details>}
      {choice && <>
        <ScoringDetails scoring={choice.scoring} />
        <div className="info-card"><h3>Выбранный вариант: {choice.title}</h3><div className="sub-tabs">{choice.crops.map((crop, index) => <button type="button" key={index} className={year === index ? 'active' : ''} onClick={() => setYear(index)}>{analysis.startYear + index} · {crop}</button>)}</div>
          {choice.scoring.cropChecks[year].map(note => <p key={note}>{note}</p>)}
          <h3>Расходы по годам</h3><p className="muted small">{choice.scoring.costs.basis}; источник цен: {analysis.inputSnapshot.planning.costSource || 'не указан'}.</p>
          <div className="table-scroll"><table><thead><tr><th>Год</th><th>Культура</th><th>₸/га</th><th>На поле, ₸</th></tr></thead><tbody>{choice.scoring.costs.years.map(row => <tr key={row.year}><td>{row.year}</td><td>{row.crop}</td><td>{fmt(row.perHa)}</td><td>{fmt(row.total)}</td></tr>)}</tbody></table></div>
        </div>
        <div className="action-row"><Button primary disabled={stale || !choice.canApprove} onClick={() => decide('approve')}>Утвердить выбранный вариант</Button><Button disabled={stale} onClick={() => decide('draft')}>Сохранить черновик</Button><Button disabled={stale} onClick={() => decide('reject')}>Отклонить выбранный вариант</Button></div>
        {!choice.canApprove && <p className="subtle-note">Для утверждения нужны климат NASA, сведения о почве и распознанный предшественник за {analysis.startYear - 1} год. Если задан бюджет, нужны затраты по всем культурам варианта. Пока можно сохранить черновик. Утверждение — решение фермера, не агрономическая сертификация.</p>}
      </>}
    </div>}
    <div className="info-card"><h3>Проверить свой севооборот</h3><p className="muted small">Пройдёт те же ограничения и расчёт, что автоматически подобранные варианты.</p><div className="custom-crops">{custom.map((value, index) => <label key={index}>{Number(planning.startYear) + index}<select value={value} onChange={event => setCustom(old => old.map((item, position) => position === index ? event.target.value : item))}>{CROP_CATALOG.map(crop => <option key={crop.id} value={crop.id}>{crop.name}</option>)}</select></label>)}</div>
      <Button disabled={busy} onClick={() => run(true)}>Проверить свой вариант</Button>
      {analysis?.customError && <p className="notice">{analysis.customError}</p>}
      {analysis?.customOption && <div className={analysis.customOption.eligible ? 'subtle-note' : 'notice'}><strong>{analysis.customOption.title}</strong><p>{analysis.customOption.eligible ? `Не выявлены нарушения заданных ограничений. Оценка: ${fmt(analysis.customOption.scoring.score)}/100; учтено ${analysis.customOption.scoring.usedWeight}% веса. Выбран для просмотра и сохранения.` : 'Вариант не прошёл ограничения:'}</p>{analysis.customOption.scoring.constraints.rejected.map(note => <p key={note}>{note}</p>)}</div>}
    </div>
    <details className="info-card"><summary><strong>Методика и источники</strong></summary><p>{analysis?.method || 'Открытый расчёт по истории, климату, почве, затратам и приоритетам. Все числовые баллы — пилотные сравнительные правила.'}</p><p className="small">Сравнительные чувствительности: пшеница/ячмень — 1,5; горох/кукуруза — 2,5; лён — 2 (допущение прототипа). Это не потребность в воде в миллиметрах. Местные сортовые требования должны быть проверены отдельно.</p>{Object.values(SOURCES).map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></p>)}</details>
  </section>
}
