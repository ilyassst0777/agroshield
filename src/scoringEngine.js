/** Deterministic, auditable pilot comparison. No yield/price prediction or LLM. */
import { buildProfile } from './analysisProfile.js'
import { cropById, numberOrNull, resolveCrop, RULE_VERSION } from './cropCatalog.js'

export const WEIGHTS = Object.freeze({ agronomy: 30, climate: 20, water: 15, soil: 15, economy: 10, goals: 10 })
export const CRITERIA = Object.freeze({
  agronomy: 'История и последовательность культур', climate: 'Исторические сезоны NASA',
  water: 'Влага и полив', soil: 'Почвенные ограничения', economy: 'Расходы и бюджет', goals: 'Предпочтения фермера',
})
const round = value => Math.round(value * 10) / 10
const clamp = value => Math.max(0, Math.min(100, value))
const unique = values => [...new Set(values)]
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
const dimension = (score, notes) => ({ score: score === null ? null : round(clamp(score)), notes })

export function weightsFor(goals = []) {
  const weights = { ...WEIGHTS }
  if (goals.includes('water')) { weights.water += 15; weights.climate += 5 }
  if (goals.includes('soil')) { weights.soil += 10; weights.agronomy += 5 }
  if (goals.includes('cost')) weights.economy += 30
  if (goals.includes('stable')) weights.climate += 15
  if (goals.includes('erosion')) weights.soil += 15
  if (goals.includes('diversity')) weights.agronomy += 15
  if (goals.includes('harvest') || goals.includes('early')) weights.goals += 10
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0)
  const entries = Object.entries(weights).map(([id, value]) => [id, round(100 * value / total)])
  entries.at(-1)[1] = round(entries.at(-1)[1] + 100 - entries.reduce((sum, [, value]) => sum + value, 0))
  return Object.fromEntries(entries)
}

export function rotationCosts(profile, ids) {
  const key = profile.field.budgetScope === 'seeds' ? 'seedCostHa' : 'seasonCostHa'
  const years = ids.map((id, index) => {
    const perHa = numberOrNull(profile.rules[id]?.[key])
    return { year: profile.startYear + index, crop: cropById(id)?.name || id, perHa,
      total: perHa !== null && profile.areaHa > 0 ? round(perHa * profile.areaHa) : null }
  })
  const complete = years.every(year => year.total !== null)
  return { years, complete, basis: key === 'seedCostHa' ? 'Только семена' : 'Все расходы на сезон',
    total: complete ? round(years.reduce((sum, year) => sum + year.total, 0)) : null,
    knownTotal: round(years.reduce((sum, year) => sum + (year.total ?? 0), 0)),
    budget: profile.budget, budgetPeriod: profile.planning.budgetPeriod }
}

export function checkConstraints(profile, ids) {
  const rejected = [], pending = []
  const seen = profile.history.filter(row => row.cropId).map(row => ({ year: row.year, id: row.cropId }))
  const costs = rotationCosts(profile, ids)
  if (ids.filter(id => id === 'fallow').length > Number(profile.planning.maxFallowYears)) rejected.push(`В плане больше ${profile.planning.maxFallowYears} паровых лет, разрешённых в условиях подбора.`)
  ids.forEach((id, index) => {
    const crop = cropById(id), rule = profile.rules[id] || {}, year = profile.startYear + index
    if (!crop) { rejected.push(`${year}: неизвестная культура.`); return }
    if (!profile.allowed.includes(id)) rejected.push(`${year}: ${crop.name} отсутствует в доступных культурах.`)
    if (rule.blocked) rejected.push(`${year}: ${crop.name} запрещена в условиях поля${rule.blockReason ? `: ${rule.blockReason}` : ''}.`)
    const interval = numberOrNull(rule.minReturnYears)
    const last = seen.filter(item => item.id === id).at(-1)
    if (id !== 'fallow' && interval !== null && last && year - last.year < interval) {
      rejected.push(`${year}: ${crop.name} возвращается через ${year - last.year} г.; задан минимум ${interval} г. после ${last.year}.`)
    }
    if (id !== 'fallow' && interval === null) pending.push(`${crop.name}: местный минимальный интервал возврата не задан.`)
    if (interval > 1 && !last) pending.push(`${crop.name}: отсутствие культуры в имеющихся записях не подтверждает полный интервал ${interval} г.`)
    const low = numberOrNull(rule.phMin), high = numberOrNull(rule.phMax)
    if (profile.ph !== null && (low !== null && profile.ph < low || high !== null && profile.ph > high)) {
      const note = `${year}: ${crop.name}, pH ${profile.ph} вне заданного диапазона ${low ?? '—'}–${high ?? '—'}.`
      if (profile.phMeasured) rejected.push(note)
      else pending.push(note + ' Источник pH — модель или неподтверждённое значение; нужна проверка.')
    }
    if (profile.ph !== null && low === null && high === null && id !== 'fallow') pending.push(`${crop.name}: pH известен, диапазон пригодности культуры не задан.`)
    if (rule.needsIrrigation && profile.field.irrigation !== 'yes') rejected.push(`${year}: для ${crop.name} вы указали обязательный полив; полив не подтверждён.`)
    const days = numberOrNull(rule.maturityDays), availableDays = numberOrNull(profile.planning.maxGrowingDays)
    if (days !== null && availableDays !== null && days > availableDays) rejected.push(`${year}: ${crop.name}, ${days} дней до уборки при доступных ${availableDays} днях.`)
    seen.push({ year, id })
  })
  if (profile.budget !== null) {
    if (profile.planning.budgetPeriod === 'rotation') {
      if (costs.knownTotal > profile.budget) rejected.push(`Известные расходы за три года ${costs.knownTotal} ₸ превышают бюджет ${profile.budget} ₸.`)
    } else {
      for (const year of costs.years) if (year.total !== null && year.total > profile.budget) rejected.push(`${year.year}: расходы ${year.total} ₸ превышают годовой бюджет ${profile.budget} ₸.`)
    }
    if (!costs.complete) pending.push('Бюджет проверен не полностью: нет затрат для всех культур или площади поля.')
  }
  return { rejected: unique(rejected), pending: unique(pending), costs, eligible: !rejected.length }
}

function agronomy(profile, crops) {
  if (!profile.history.length) return dimension(null, ['Нет истории: совместимость с фактическим предшественником не проверена.'])
  let score = 70
  const notes = [], steps = [profile.previous?.cropId, ...crops.map(crop => crop.id)]
  if (!steps[0]) notes.push(`Предшественник за ${profile.startYear - 1} год не установлен; первая смена не оценена.`)
  for (let index = 1; index < steps.length; index++) {
    const current = cropById(steps[index]), prior = cropById(steps[index - 1])
    if (!prior) continue
    if (current.id === prior.id && current.id !== 'fallow') {
      score -= 25; notes.push(`${prior.name} → ${current.name}: повтор культуры (−25, пилотное правило).`)
    } else if (current.group === 'grain' && prior.group === 'grain') {
      score -= 10; notes.push(`${prior.name} → ${current.name}: зерновая группа сохраняется (−10).`)
    } else if (prior.group === 'legume' && current.group === 'grain') {
      score += 8; notes.push(`${prior.name} → ${current.name}: смена бобовых на зерновые (+8); азотный эффект не гарантирован.`)
    }
  }
  const groups = new Set(crops.filter(crop => crop.group !== 'fallow').map(crop => crop.group)).size
  if (groups >= 2) { score += groups === 3 ? 12 : 6; notes.push(`Функциональных групп в посевах: ${groups} (+${groups === 3 ? 12 : 6}).`) }
  return dimension(score, notes.length ? notes : ['Явных повторов культур в проверенной части последовательности нет.'])
}

function historicalClimate(profile, crops) {
  if (!profile.hasNasa) return dimension(null, ['NASA не загружена или относится к другим координатам.'])
  const climate = profile.climate, rows = profile.rows, notes = []
  const baseline = numberOrNull(climate.baselineRain) ?? (rows.length ? mean(rows.map(row => row.rainMm)) : null)
  let dryShare
  if (rows.length >= 3 && baseline > 0) {
    const dryCount = rows.filter(row => row.rainMm < baseline * 0.85).length
    dryShare = dryCount / rows.length
    notes.push(`Сухих по пилотному порогу сезонов: ${dryCount}/${rows.length}; осадки ниже 85% опорного уровня ${round(baseline)} мм. Это историческая частота, не вероятность будущей засухи.`)
  } else {
    dryShare = Number.isFinite(climate.precipAnomalyPct) && climate.precipAnomalyPct < -15 ? 1 : 0
    notes.push(`Доступен ограниченный климатический контекст: ${climate.latestYear || 'последний сезон'}. Влияние одного сезона уменьшено.`)
  }
  const planted = crops.filter(crop => crop.id !== 'fallow')
  const sensitivity = planted.length ? mean(planted.map(crop => crop.drought)) : 0
  let score = 80 - sensitivity * dryShare * (rows.length >= 3 ? 10 : 3)
  for (const crop of planted) {
    const limit = numberOrNull(profile.rules[crop.id]?.maxSeasonTempC)
    const temperatures = rows.map(row => row.tempC).filter(Number.isFinite)
    if (limit !== null && temperatures.length) {
      const over = temperatures.filter(temp => temp > limit).length / temperatures.length
      score -= over * 15 / planted.length
      notes.push(`${crop.name}: в ${round(over * 100)}% исторических сезонов средняя температура мая–августа выше заданных ${limit} °C.`)
    }
  }
  if (!planted.length) notes.push('Нет товарных посевов; высокая оценка климата не означает доходности или защиты почвы.')
  notes.push('Сравнительная чувствительность культур — открытое допущение прототипа; осадки не равны доступной воде и не заменяют водный баланс.')
  return dimension(score, notes)
}

function water(profile, crops) {
  const manual = profile.manual, problems = manual.problems || []
  const dry = manual.moisture === 'dry', wet = manual.moisture === 'wet' || problems.includes('waterlogging')
  const erosion = problems.includes('erosion')
  if (!dry && !wet && !erosion && manual.moisture !== 'normal') return dimension(null, ['Нет подтверждённых наблюдений о влаге. Свободные заметки можно подтвердить над формой расчёта.'])
  let score = 80
  const notes = [], planted = crops.filter(crop => crop.id !== 'fallow'), count = Math.max(1, planted.length)
  if (dry) {
    const exposure = planted.reduce((sum, crop) => sum + crop.drought, 0) / count
    score -= exposure * (profile.field.irrigation === 'yes' ? 5 : 10)
    notes.push(`Подтверждено пересыхание; учтена сравнительная чувствительность культур. Полив: ${profile.field.irrigation === 'yes' ? 'указан, объём не проверен' : 'не подтверждён'}.`)
  }
  if (wet) { score -= planted.reduce((sum, crop) => sum + crop.wet, 0) * 8 / count; notes.push('Подтверждён застой воды; нужна проверка дренажа, особенно для чувствительных культур.') }
  if (erosion && crops.some(crop => crop.id === 'fallow')) { score -= 30; notes.push('Чистый пар при подтверждённой эрозии: −30 по пилотному правилу.') }
  if (!notes.length) notes.push('По введённым наблюдениям влажность обычно нормальная. Это не измерение водного баланса.')
  return dimension(score, notes)
}

function soil(profile, crops) {
  if (!profile.hasSoil) return dimension(null, ['Нет почвенных сведений.'])
  const notes = [], problems = profile.manual.problems || []
  let score = 75
  if (profile.ph !== null) {
    notes.push(`pH ${profile.ph}; ${profile.phMeasured ? 'анализ с указанным источником' : 'модель или значение без лабораторного источника'}.`)
    for (const crop of crops) {
      const rule = profile.rules[crop.id] || {}, low = numberOrNull(rule.phMin), high = numberOrNull(rule.phMax)
      if (low !== null && profile.ph < low || high !== null && profile.ph > high) score -= 20 / crops.length
    }
  }
  if (problems.includes('erosion') && crops.some(crop => crop.id === 'fallow')) { score -= 20; notes.push('Год без товарного посева требует отдельной защиты от эрозии (−20).') }
  if (profile.manual.fertility === 'low') {
    const grainShare = crops.filter(crop => crop.group === 'grain').length / crops.length
    score -= grainShare * 12
    notes.push('Низкое плодородие по наблюдениям: зерновая специализация снижает пилотную оценку. Бобовые не заменяют анализ питания и удобрения.')
  }
  if (problems.includes('salinity')) notes.push('Признаки засоления: без анализа солей и требований сорта пригодность не установлена.')
  if (problems.includes('compaction')) notes.push('Уплотнение учтено как ограничение для проверки корней и обработки; числовой эффект без измерений не задан.')
  if (profile.manual.soilType || profile.manual.texture) notes.push(`Тип почвы: ${profile.manual.soilType || profile.manual.texture}; детальная пригодность сорта требует местных правил.`)
  return dimension(score, notes.length ? notes : ['Качественные сведения о почве сохранены; подтверждённого количественного ограничения нет.'])
}

function economy(profile, costs) {
  if (!costs.complete) return dimension(null, ['Нужны площадь и затраты на гектар для каждой культуры в варианте. Неизвестная стоимость не считается нулевой.'])
  const notes = [`${costs.basis}: за три года ${costs.total} ₸. Это расходы, не прибыль.`]
  if (profile.budget === null) return dimension(null, [...notes, 'Бюджет не указан: соответствие бюджету не оценено.'])
  const expense = profile.planning.budgetPeriod === 'rotation' ? costs.total : Math.max(...costs.years.map(year => year.total))
  const score = profile.budget === 0 ? expense === 0 ? 100 : 0 : 100 - 50 * expense / profile.budget
  notes.push(`Бюджет ${profile.budget} ₸ ${profile.planning.budgetPeriod === 'rotation' ? 'на три года' : 'на каждый сезон'}; сравниваемые расходы ${expense} ₸.`)
  return dimension(score, notes)
}

function preferences(profile, crops) {
  const goals = profile.field.goals || [], notes = []
  let score = 70, evaluated = false
  if (goals.includes('harvest')) {
    evaluated = true
    if (crops[0].id === 'fallow') { score -= 35; notes.push('В первом году чистый пар: цель урожая в следующем сезоне не выполнена (−35).') }
    else notes.push('В первом году предусмотрен товарный посев; фактический урожай не гарантирован.')
  }
  if (goals.includes('diversity')) { evaluated = true; const groups = new Set(crops.map(crop => crop.group)).size; score += (groups - 1) * 10; notes.push(`Для цели разнообразия учтено групп: ${groups}.`) }
  if (goals.includes('early')) {
    const days = numberOrNull(profile.rules[crops[0].id]?.maturityDays), available = numberOrNull(profile.planning.maxGrowingDays)
    if (days !== null && available > 0) { evaluated = true; score += 20 * Math.max(0, 1 - days / available); notes.push(`Первый год: задано ${days} дней до уборки при доступных ${available}.`) }
    else notes.push('Для ранней уборки нужны местная длительность выращивания и доступное число дней.')
  }
  if (goals.some(goal => ['soil', 'water', 'cost', 'erosion', 'stable'].includes(goal))) notes.push('Цели почвы, воды, затрат и устойчивости меняют веса соответствующих критериев.')
  return dimension(evaluated ? score : null, notes.length ? notes : ['Не заданы предпочтения, допускающие отдельную оценку.'])
}

export function scoreRotation(field, cropValues, preparedProfile = null) {
  const profile = preparedProfile || buildProfile(field)
  const ids = cropValues.map(value => resolveCrop(value))
  if (ids.some(id => !id) || !ids.length) throw new Error('Для расчёта нужны культуры из каталога.')
  const crops = ids.map(cropById), constraints = checkConstraints(profile, ids)
  const dimensions = {
    agronomy: agronomy(profile, crops), climate: historicalClimate(profile, crops), water: water(profile, crops),
    soil: soil(profile, crops), economy: economy(profile, constraints.costs), goals: preferences(profile, crops),
  }
  const weights = weightsFor(field.goals)
  const available = Object.entries(dimensions).filter(([, value]) => value.score !== null)
  const usedWeight = round(available.reduce((sum, [key]) => sum + weights[key], 0))
  const score = usedWeight ? round(available.reduce((sum, [key, value]) => sum + value.score * weights[key], 0) / usedWeight) : null
  const cropChecks = crops.map((crop, index) => {
    const year = profile.startYear + index, prior = index ? crops[index - 1]?.name : profile.previous?.crop
    return [`${year}: ${crop.name}; предшественник ${prior || 'не установлен'}.`,
      ...constraints.rejected.filter(note => note.startsWith(`${year}:`)),
      ...constraints.pending.filter(note => note.startsWith(crop.name + ':'))]
  })
  return { score, coverage: available.length, criteriaCount: Object.keys(dimensions).length, usedWeight, dimensions, weights,
    limitations: unique([...profile.pending, ...constraints.pending]), cropChecks, constraints, costs: constraints.costs,
    ruleVersion: RULE_VERSION,
    method: 'Взвешенное сравнение по открытым правилам прототипа. Веса зависят от целей. Пилотные баллы и сравнительная чувствительность не являются коэффициентами FAO, прогнозом урожая или подтверждением пригодности сорта. Неизвестные критерии исключены из среднего и показаны в полноте расчёта.' }
}
