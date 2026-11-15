import { cropById, numberOrNull, planningFor, resolveCrop, RULE_VERSION } from './cropCatalog.js'

const unique = values => [...new Set(values)]
const usable = value => value !== '' && value !== null && value !== undefined

// Text is offered for confirmation, never silently turned into a measurement or ban.
export function observationSuggestions(field) {
  const text = [field.observations, field.soilManual?.notes].filter(Boolean).join(' ')
  const sentences = text.toLowerCase().replace(/ё/g, 'е').split(/[.!?;\n]/)
  const found = []
  const matches = (yes, no) => sentences.some(sentence => yes.test(sentence) && !no.test(sentence))
  if (matches(/пересых|не хватает влаги|дефицит влаги|недостаток влаги/, /(?:^|\s)(?:не пересых|нет дефицита|нет недостатка|влаги хватает|достаточно влаги)/) && !field.soilManual?.moisture) {
    found.push({ id: 'dry', label: 'Почва часто пересыхает', source: text })
  }
  if (matches(/задерживается вода|стоит вода|застой воды|переувлажн/, /(?:^|\s)(?:не задерживается|не стоит вода|нет застоя|не переувлажн)/) && !(field.soilManual?.problems || []).includes('waterlogging')) {
    found.push({ id: 'waterlogging', label: 'На части поля задерживается вода', source: text })
  }
  return found
}

export function confirmedSuggestions(field, selected) {
  const suggestions = observationSuggestions(field).filter(item => selected.includes(item.id))
  const manual = { ...field.soilManual }
  if (suggestions.some(item => item.id === 'dry')) manual.moisture = 'dry'
  manual.problems = unique([...(manual.problems || []), ...suggestions.filter(item => item.id !== 'dry').map(item => item.id)])
  manual.source = 'Наблюдения фермера, подтверждены для расчёта'
  manual.confirmedText = suggestions.map(item => item.source).join('\n')
  return manual
}

export function buildProfile(field) {
  const planning = planningFor(field)
  const startYear = numberOrNull(planning.startYear)
  const inputErrors = []
  if (!Number.isInteger(startYear) || startYear < 1991 || startYear > 2098) inputErrors.push('Укажите год начала плана от 1991 до 2098.')
  const allowed = Array.isArray(planning.allowedCrops) ? unique(planning.allowedCrops.filter(id => cropById(id))) : []
  if (!allowed.length) inputErrors.push('Выберите хотя бы одну доступную культуру.')
  const areaHa = numberOrNull(field.areaHa)
  const budget = numberOrNull(field.budget)
  if (usable(field.areaHa) && (areaHa === null || areaHa <= 0)) inputErrors.push('Площадь должна быть положительным числом.')
  if (usable(field.budget) && (budget === null || budget < 0)) inputErrors.push('Бюджет должен быть неотрицательным числом.')
  const history = (field.history || []).map(row => ({ ...row, year: numberOrNull(row.year), cropId: resolveCrop(row.crop) }))
    .filter(row => Number.isInteger(row.year)).sort((a, b) => a.year - b.year)
  const past = history.filter(row => row.year < startYear)
  const previousRows = past.filter(row => row.year === startYear - 1)
  const previous = previousRows.length === 1 ? previousRows[0] : null
  const pending = []
  if (!previous) pending.push(`Нужна одна запись о фактическом использовании поля за ${startYear - 1} год: предшественник не установлен.`)
  if (previous && !previous.cropId) pending.push(`Культура «${previous.crop}» не распознана в каталоге; совместные посевы требуют отдельной проверки.`)
  const duplicateYears = unique(past.filter((row, index) => past.findIndex(other => other.year === row.year) !== index).map(row => row.year))
  if (duplicateYears.length) pending.push(`Несколько записей за ${duplicateYears.join(', ')}: уточните, относится ли история ко всему полю.`)
  if (history.some(row => row.year >= startYear)) pending.push('В истории есть записи на годы плана. Они не использованы как фактические предшественники.')

  const rules = planning.cropRules || {}
  for (const id of allowed) {
    const rule = rules[id] || {}
    for (const key of ['seedCostHa', 'seasonCostHa', 'minReturnYears', 'phMin', 'phMax', 'maturityDays', 'maxSeasonTempC']) {
      if (!usable(rule[key])) continue
      const number = numberOrNull(rule[key])
      if (number === null || (key !== 'maxSeasonTempC' && number < 0)) inputErrors.push(`${cropById(id).name}: проверьте числовое значение «${key}».`)
      if (['minReturnYears', 'maturityDays'].includes(key) && (number <= 0 || !Number.isInteger(number))) inputErrors.push(`${cropById(id).name}: интервал и длительность должны быть целыми положительными числами.`)
      if (['phMin', 'phMax'].includes(key) && (number < 0.1 || number > 14)) inputErrors.push(`${cropById(id).name}: допустимый pH — от 0,1 до 14.`)
    }
    const low = numberOrNull(rule.phMin), high = numberOrNull(rule.phMax)
    if (low !== null && high !== null && low > high) inputErrors.push(`${cropById(id).name}: минимальный pH больше максимального.`)
  }
  if (!['annual', 'rotation'].includes(planning.budgetPeriod)) inputErrors.push('Выберите период бюджета.')
  const maxFallow = numberOrNull(planning.maxFallowYears)
  if (!Number.isInteger(maxFallow) || maxFallow < 0 || maxFallow > 3) inputErrors.push('Число паровых лет должно быть от 0 до 3.')
  const maxGrowing = numberOrNull(planning.maxGrowingDays)
  if (usable(planning.maxGrowingDays) && (!Number.isInteger(maxGrowing) || maxGrowing < 1 || maxGrowing > 365)) inputErrors.push('Доступный период выращивания должен быть от 1 до 365 дней.')

  const manual = field.soilManual || {}
  const manualPh = numberOrNull(manual.ph)
  const modelPh = numberOrNull(field.soilResult?.data?.ph?.value)
  const ph = manualPh > 0 && manualPh <= 14 ? manualPh : modelPh > 0 && modelPh <= 14 ? modelPh : null
  const phMeasured = manualPh === ph && ph !== null && Boolean(manual.labSource?.trim())
  const climate = field.climate || null
  const climateMismatch = climate && Number.isFinite(climate.lat) && Number.isFinite(climate.lon) && field.center?.length === 2 &&
    (Math.abs(climate.lat - field.center[0]) > 0.001 || Math.abs(climate.lon - field.center[1]) > 0.001)
  if (climateMismatch) pending.push('Координаты климатических данных отличаются от координат поля. Обновите NASA.')
  const rows = (climateMismatch ? [] : climate?.rows || []).filter(row => Number.isFinite(row.rainMm) && row.rainMm >= 0)
  const hasNasa = !climateMismatch && Boolean(climate) && (rows.length > 0 || Number.isFinite(climate.precipAnomalyPct))
  const hasSoil = Boolean(manual.soilType || manual.texture || manual.moisture || manual.fertility || manual.problems?.length || ph !== null)
  if (!hasNasa) pending.push('Климат NASA не получен для этого поля.')
  if (!hasSoil) pending.push('Нет сведений о почве: добавьте наблюдения или анализ.')
  if (field.herbicideStatus !== 'no') pending.push(field.herbicideStatus === 'yes' ? 'Последействие препаратов не вычислено: занесите подтверждённые запреты культур в условия подбора.' : 'История гербицидов неизвестна; автоматического запрета культур нет.')
  if (rows.length > 0 && rows.length < 10) pending.push('Меньше 10 полных исторических сезонов: климатическое сравнение ограничено.')
  const datedHistory = past.filter(row => row.sown && row.harvested).map(row => {
    const duration = (Date.parse(`${row.harvested}T00:00:00Z`) - Date.parse(`${row.sown}T00:00:00Z`)) / 86400000
    return { year: row.year, crop: row.crop, duration }
  }).filter(row => Number.isFinite(row.duration) && row.duration >= 0)
  const yieldHistory = past.filter(row => numberOrNull(row.yield) !== null && numberOrNull(row.yield) >= 0)
  const snapshot = {
    id: field.id, name: field.name, dataVersion: field.dataVersion,
    areaHa, center: field.center || null, geometry: field.geometry || null,
    history: past, soilManual: manual, soilResult: field.soilResult || null,
    climate, irrigation: field.irrigation, waterDetails: field.waterDetails,
    observations: field.observations, strengths: field.strengths, extra: field.extra,
    herbicideStatus: field.herbicideStatus, herbicideNotes: field.herbicideNotes,
    goals: field.goals || [], ownGoal: field.ownGoal || '', budget, budgetScope: field.budgetScope || 'season',
    planning, documents: (field.documents || []).map(doc => ({ name: doc.name, kind: doc.kind, rows: doc.rows })),
  }
  return { field, planning, startYear, allowed, areaHa, budget, history: past, previous, rules, manual,
    ph, phMeasured, hasNasa, hasSoil, climate: climateMismatch ? null : climate, rows,
    datedHistory, yieldHistory, pending: unique(pending), inputErrors: unique(inputErrors), snapshot: structuredClone(snapshot), ruleVersion: RULE_VERSION }
}

export function inputLedger(profile) {
  const { field, history, previous, hasNasa, hasSoil, rows, allowed, rules, ph, datedHistory, yieldHistory } = profile
  const hasCosts = allowed.some(id => numberOrNull(rules[id]?.[field.budgetScope === 'seeds' ? 'seedCostHa' : 'seasonCostHa']) !== null)
  return [
    { label: 'История культур', status: history.length ? 'used' : 'missing', detail: `${history.length} записей; предшественник ${previous?.crop || 'не установлен'}. Проверяются годы и последовательность.` },
    { label: 'NASA: осадки', status: hasNasa ? 'used' : 'missing', detail: hasNasa ? `${rows.length || 1} исторических сезонов; сравнение сухих лет. Погода будущих лет не прогнозируется.` : 'Загрузите климат выбранного поля.' },
    { label: 'NASA: температура', status: allowed.some(id => numberOrNull(rules[id]?.maxSeasonTempC) !== null) && hasNasa ? 'used' : 'context', detail: 'Порог средней температуры мая–августа проверяется только для культур, где вы его указали. Экстремумы не выводятся из месячных средних.' },
    { label: 'NASA: радиация, влажность воздуха, ветер', status: 'context', detail: 'Сохранены в исходных данных. Без модели испарения и фаз развития отдельные баллы не начисляются.' },
    { label: 'Почва и влажность', status: hasSoil ? 'used' : 'missing', detail: 'Учитываются подтверждённые пересыхание, переувлажнение, эрозия, тип и плодородие. pH: ' + (ph === null ? 'нет данных.' : `${ph}; ограничения проверяются при заданных диапазонах культур.`) },
    { label: 'Площадь, бюджет и затраты', status: hasCosts && profile.areaHa > 0 ? 'used' : 'missing', detail: hasCosts ? 'Цена на гектар × площадь. Недостающие затраты остаются неизвестными.' : 'Введите затраты по культурам: без цен бюджет не подтверждён.' },
    { label: 'Цели фермера', status: field.goals?.length ? 'used' : 'missing', detail: 'Меняют веса критериев; урожай следующего сезона проверяется для первого года плана.' },
    { label: 'Сроки посева и уборки', status: 'context', detail: `${datedHistory.length} корректных исторических интервалов. Срок нового сорта задаётся отдельно; прошлые даты его не предсказывают.` },
    { label: 'Историческая урожайность', status: 'context', detail: `${yieldHistory.length} записей сохранено. Из них не строится причинный прогноз урожая или прибыли.` },
    { label: 'Гербициды', status: 'review', detail: 'Используются явно заданные запреты культур. Заметки о препаратах не заменяют проверку этикеток.' },
    { label: 'Заметки, своя цель и документы', status: 'review', detail: 'Подтверждённые строки импорта участвуют в истории. PDF, свободные цели, преимущества и прочие заметки сохранены для проверки; значения не выдумываются.' },
  ]
}
