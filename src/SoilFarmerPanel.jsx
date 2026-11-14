import { useState } from 'react'

const TYPES = [
  ['', 'Не знаю'],
  ['chernozem', 'Чернозём'],
  ['loam', 'Суглинистая'],
  ['sandy_loam', 'Супесчаная'],
  ['clay', 'Глинистая'],
  ['sand', 'Песчаная'],
  ['other', 'Другая'],
]
const MOISTURE = [
  ['', 'Не знаю'],
  ['dry', 'Часто пересыхает'],
  ['normal', 'Обычно нормальная'],
  ['wet', 'Часто переувлажнена'],
]
const FERTILITY = [
  ['', 'Не знаю'],
  ['high', 'Высокое (по наблюдениям)'],
  ['medium', 'Среднее (по наблюдениям)'],
  ['low', 'Низкое (по наблюдениям)'],
]
const PROBLEMS = [
  ['erosion', 'Эрозия / сдувает почву'],
  ['salinity', 'Признаки засоления'],
  ['compaction', 'Уплотнение'],
  ['waterlogging', 'После дождя стоит вода'],
]
const textOf = (options, code) => options.find(([key]) => key === code)?.[1] || 'Не указано'
const valid = (value, low, high) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= low && Number(value) <= high)
const fresh = (data) => data?.ph?.value > 0 && Number.isFinite(data.ph.value)

export default function SoilFarmerPanel({ field, patch, onFetch, loading, error }) {
  const [edit, setEdit] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [auto, setAuto] = useState(false)
  const [draft, setDraft] = useState(field.soilManual || {})
  const [extra, setExtra] = useState(field.extra || '')
  const [herbicideNotes, setHerbicideNotes] = useState(field.herbicideNotes || '')
  const saved = field.soilManual || {}
  const data = fresh(field.soilResult?.data) ? field.soilResult.data : null
  const problems = Array.isArray(draft.problems) ? draft.problems : []
  const set = (key, value) => setDraft(old => ({ ...old, [key]: value }))
  const save = () => {
    if (!valid(draft.ph ?? '', 0.1, 14) || !valid(draft.soc ?? '', 0, 100)) return
    patch({ soilManual: { ...draft, source: draft.source || 'Наблюдения фермера' } })
    setEdit(false)
  }
  const startEdit = () => { setDraft({ ...saved }); setEdit(true) }

  return <>
    <div className="section-head">
      <div><h3>Почва вашего поля</h3><p className="muted small">Достаточно указать то, что вы знаете. Точные лабораторные показатели необязательны.</p></div>
      {!edit && <button type="button" className="btn primary" onClick={startEdit}>Изменить</button>}
    </div>

    {!edit ? <div className="info-card">
      <table><tbody>
        <tr><td>Тип почвы</td><td>{textOf(TYPES, saved.soilType || saved.texture)}</td></tr>
        <tr><td>Влажность</td><td>{textOf(MOISTURE, saved.moisture)}</td></tr>
        <tr><td>Плодородие</td><td>{textOf(FERTILITY, saved.fertility)}</td></tr>
        <tr><td>Особенности</td><td>{(saved.problems || []).map(p => PROBLEMS.find(([k]) => k === p)?.[1]).filter(Boolean).join(', ') || 'Не указаны'}</td></tr>
      </tbody></table>
      {saved.notes && <p className="small">Наблюдения: {saved.notes}</p>}
      {saved.ph !== undefined && saved.ph !== '' && <p className="small">pH по анализу: {saved.ph}</p>}
      {saved.soc !== undefined && saved.soc !== '' && <p className="small">Органический углерод по анализу: {saved.soc}%</p>}
      <p className="muted small">Источник: {saved.source || 'Данные пока не внесены'}.</p>
      <p className="muted small">Описание почвы фермером — качественное наблюдение, не лабораторное измерение.</p>
    </div> : <div className="info-card form">
      <h3>Что вы знаете о поле?</h3>
      <div className="form-grid">
        <label>Тип почвы
          <select value={draft.soilType || ''} onChange={e => set('soilType', e.target.value)}>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Как ведёт себя почва в засушливое или дождливое время?
          <select value={draft.moisture || ''} onChange={e => set('moisture', e.target.value)}>
            {MOISTURE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Плодородие по вашему опыту
          <select value={draft.fertility || ''} onChange={e => set('fertility', e.target.value)}>
            {FERTILITY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <p className="small"><strong>Какие проблемы встречаются?</strong></p>
      <div className="check-grid">{PROBLEMS.map(([value, label]) =>
        <label className="checkbox-line" key={value}>
          <input type="checkbox" checked={problems.includes(value)} onChange={e => set('problems', e.target.checked ? [...problems, value] : problems.filter(p => p !== value))}/>
          {label}
        </label>
      )}</div>
      <label>Другие наблюдения (необязательно)
        <textarea value={draft.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="Например, весной низина долго не просыхает"/>
      </label>
      <button type="button" className="btn ghost" onClick={() => setAdvanced(!advanced)}>
        {advanced ? 'Скрыть лабораторные показатели' : 'Есть лабораторный анализ? Добавить показатели'}
      </button>
      {advanced && <div className="form-grid">
        <label>pH из лабораторного анализа
          <input type="number" min="0.1" max="14" step="0.1" value={draft.ph ?? ''} onChange={e => set('ph', e.target.value)} placeholder="Необязательно"/>
        </label>
        <label>Органический углерод, %
          <input type="number" min="0" max="100" step="0.01" value={draft.soc ?? ''} onChange={e => set('soc', e.target.value)} placeholder="Необязательно"/>
        </label>
        <label>Источник лабораторных значений и дата
          <input value={draft.labSource || ''} onChange={e => set('labSource', e.target.value)} placeholder="Лаборатория, дата, глубина"/>
        </label>
      </div>}
      {(!valid(draft.ph ?? '', 0.1, 14) || !valid(draft.soc ?? '', 0, 100)) && <p className="notice">Проверьте диапазон лабораторных показателей.</p>}
      <div className="action-row">
        <button type="button" className="btn primary" disabled={!valid(draft.ph ?? '', 0.1, 14) || !valid(draft.soc ?? '', 0, 100)} onClick={save}>Сохранить данные</button>
        <button type="button" className="btn secondary" onClick={() => setEdit(false)}>Отмена</button>
      </div>
    </div>}

    <div className="info-card">
      <div className="section-head"><div><h3>SoilGrids — дополнительный источник</h3><p className="muted small">Автоматическая оценка 5–15 см. Для севооборота не обязательна.</p></div>
        <button type="button" className="btn secondary" onClick={() => setAuto(!auto)}>{auto ? 'Свернуть' : 'Подробнее'}</button>
      </div>
      {auto && <>
        <button type="button" className="btn secondary" onClick={onFetch} disabled={loading}>{loading ? 'Загрузка…' : 'Попробовать загрузить SoilGrids'}</button>
        {error && <p className="notice" role="alert">Автоматические данные не получены: {error}. Можно пользоваться наблюдениями фермера.</p>}
        {data && <table><tbody>
          {Object.entries(data).map(([key, item]) => <tr key={key}><td>{({ ph: 'pH', soc_g_kg: 'Органический углерод', sand_pct: 'Песок', silt_pct: 'Пыль', clay_pct: 'Глина' })[key] || key}</td><td>{item.value} {item.unit}</td></tr>)}
        </tbody></table>}
        <p className="muted small">SoilGrids — оценка модели, а не анализ образца вашего поля.</p>
      </>}
    </div>

    <div className="info-card form">
      <h3>Анализы, удобрения, болезни и особенности</h3>
      <textarea value={extra} onChange={e => setExtra(e.target.value)} placeholder="Какие удобрения вносили, какие болезни наблюдали?"/>
      <button type="button" className="btn secondary" onClick={() => patch({ extra })}>Сохранить заметки</button>
    </div>

    <div className="info-card form">
      <h3>Гербициды</h3>
      <label>Применялись ли гербициды?
        <select value={field.herbicideStatus || 'unknown'} onChange={e => patch({ herbicideStatus: e.target.value })}>
          <option value="unknown">Не знаю / не указано</option><option value="yes">Да</option><option value="no">Нет</option>
        </select>
      </label>
      {field.herbicideStatus === 'yes' && <>
        <label>Препарат, дата, норма
          <textarea value={herbicideNotes} onChange={e => setHerbicideNotes(e.target.value)} placeholder="Препарат, дата обработки, дозировка"/>
        </label>
        <button type="button" className="btn secondary" onClick={() => patch({ herbicideNotes })}>Сохранить гербициды</button>
      </>}
    </div>
  </>
}
