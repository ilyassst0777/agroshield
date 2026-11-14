/** AgroShield scientific checks, v0.1.
 * These are transparent pilot heuristics inspired by crop-rotation literature.
 * They are NOT values extracted from FAO EcoCrop or a validated ROTAT implementation.
 */
export const SCIENCE_REFERENCES = Object.freeze({
  ecocrop: { label: 'FAO EcoCrop — требования культур (справочная база)', url: 'https://www.fao.org/land-water/resources/tools/databases/ecocrop/en' },
  rotat: { label: 'ROTAT — принципы построения севооборотов (Dogliotti et al.)', url: 'https://doi.org/10.1016/S1161-0301(02)00047-3' },
  local: { label: 'Исследование предшественников яровой пшеницы в Северном Казахстане', url: 'https://bulletinofscience.kazatu.edu.kz/index.php/bulletinofscience/article/view/1481' },
  nasa: { label: 'NASA POWER — климатические данные', url: 'https://power.larc.nasa.gov/' },
})

export function identifyCrop(raw) {
  const name = String(raw || '').toLowerCase().replace(/ё/g, 'е')
  if (/чистый пар|^пар$/.test(name)) return 'fallow'
  if (/горох/.test(name)) return 'pea'
  if (/нут/.test(name)) return 'chickpea'
  if (/чечевиц/.test(name)) return 'lentil'
  if (/фасол/.test(name)) return 'bean'
  if (/пшениц/.test(name)) return 'wheat'
  if (/ячмен/.test(name)) return 'barley'
  if (/лен/.test(name)) return 'flax'
  if (/подсолнеч/.test(name)) return 'sunflower'
  if (/кукуруз/.test(name)) return 'maize'
  if (/рапс/.test(name)) return 'rapeseed'
  return null
}
const GROUPS = {
  pea: 'legume', chickpea: 'legume', lentil: 'legume', bean: 'legume',
  wheat: 'cereal', barley: 'cereal', maize: 'cereal',
  flax: 'oil', sunflower: 'oil', rapeseed: 'oil', fallow: 'fallow',
}
const label = id => ({ legume: 'бобовых', cereal: 'зерновых', oil: 'масличных' }[id] || 'культур')
const hasRisk = field => field.soilManual?.moisture === 'dry' || (field.soilManual?.problems || []).includes('erosion')

/** Climate context: past seasons, never a future forecast. */
export function climateContext(field) {
  const c = field.climate
  if (!c || !Number.isFinite(c.precipAnomalyPct)) {
    return { type: 'unknown', label: 'Нет данных NASA для оценки сезонного отклонения осадков', sources: ['nasa'] }
  }
  const anomaly = c.precipAnomalyPct
  // -15% is an explicitly local prototype flag, not a universal drought definition.
  const type = anomaly <= -15 ? 'historically_dry' : anomaly >= 15 ? 'historically_wet' : 'near_reference'
  return {
    type, anomaly,
    label: `NASA POWER: в ${c.latestYear || 'последнем доступном'} году осадки за май–август отличались от нормы на ${anomaly > 0 ? '+' : ''}${anomaly.toFixed(1)}%. Это наблюдение за прошлый сезон, не прогноз.`,
    sources: ['nasa'],
  }
}

/** Checks a full three-year strategy against available field evidence. */
export function auditStrategy(field, crops) {
  const checks = []
  const evidence = []
  let score = 0
  const history = [...(field.history || [])].sort((a, b) => Number(a.year) - Number(b.year))
  const previous = history.at(-1)?.crop || ''
  const steps = [previous, ...crops]
  const climate = climateContext(field)
  evidence.push(climate.label)
  const groupSequence = steps.map(c => GROUPS[identifyCrop(c)] || 'unknown')

  for (let index = 1; index < steps.length; index++) {
    const current = steps[index]
    const prev = steps[index - 1]
    const currentId = identifyCrop(current)
    const previousId = identifyCrop(prev)
    const g = groupSequence[index]
    const pg = groupSequence[index - 1]
    if (currentId && previousId && currentId !== 'fallow' && currentId === previousId) {
      score -= 3
      checks.push(`После «${prev}» снова «${current}»: повтор культуры повышает необходимость проверки болезней и интервала возврата.`)
    } else if (g === 'cereal' && pg === 'cereal') {
      score -= 1
      checks.push(`Последовательность «${prev} → ${current}»: у зерновых возможны общие болезни и сорняки.`)
    } else if (pg === 'legume' && g === 'cereal') {
      score += 1
      evidence.push(`«${prev} → ${current}»: смена бобовых на зерновые может быть полезна, но эффект зависит от воды и азота.`)
    }
  }

  const cropIds = crops.map(identifyCrop)
  const cropGroups = crops.map(c => GROUPS[identifyCrop(c)] || 'unknown')
  const diverseGroups = new Set(cropGroups.filter(g => g !== 'unknown'))
  if (diverseGroups.size >= 3) {
    score += 1
    evidence.push('Вариант включает разные группы культур; это снижает зависимость от одной группы, но не гарантирует урожайность.')
  }
  if (cropIds.includes('fallow')) {
    checks.push('Чистый пар не даёт товарного урожая в соответствующем году. Оцените эрозию и потери влаги.')
    if ((field.soilManual?.problems || []).includes('erosion')) {
      score -= 2
      checks.push('Фермер указал эрозию: чистый пар требует особой осторожности и проверки почвозащитных технологий.')
    }
  }
  const risk = climate.type === 'historically_dry' || hasRisk(field)
  if (risk && cropIds.includes('maize') && field.irrigation !== 'yes') {
    score -= 1
    checks.push('Есть признаки риска дефицита влаги: для кукурузы уточните гибрид, потребность в воде и возможность полива.')
  }
  if (risk && cropIds.includes('sunflower')) {
    checks.push('При дефиците влаги для подсолнечника важно проверить запасы воды в глубоком слое и возврат культуры.')
  }
  if (history.length) {
    const latest = history.slice(-6)
    const historyIds = latest.map(h => identifyCrop(h.crop))
    for (const cropId of new Set(cropIds)) {
      if (cropId && cropId !== 'fallow' && historyIds.includes(cropId)) {
        checks.push('Та же культура встречалась в истории последних посевов. Проверьте интервал возврата по местным рекомендациям, болезням и препаратам.')
      }
    }
  } else checks.push('Без истории посевов невозможно проверить возврат культуры на поле.')
  if (field.herbicideStatus === 'yes') checks.push('Уточните действующие вещества, даты обработки и ограничения этикетки гербицида для каждой культуры.')
  else if (field.herbicideStatus !== 'no') checks.push('История гербицидов неизвестна; она не считается автоматическим запретом посева.')

  if (!field.soilManual?.soilType && !field.soilManual?.moisture && !field.soilManual?.fertility && !field.soilResult?.data?.ph?.value) {
    checks.push('Тип и свойства почвы неизвестны: требуется наблюдение фермера или анализ для проверки ограничений.')
  }
  return { score, evidence: [...new Set(evidence)], checks: [...new Set(checks)], climate, sources: ['nasa', 'rotat', 'local'] }
}

export function adaptationTip(field) {
  const climate = climateContext(field)
  const observedDry = field.soilManual?.moisture === 'dry'
  if (climate.type === 'historically_dry' || observedDry) {
    return {
      title: 'Проверить влагосберегающий вариант',
      description: 'При риске недостатка влаги стоит сравнить потребности выбранных культур в воде. Например, нут можно рассмотреть как альтернативу кукурузе, но решение зависит от почвы, сортов, истории, рынка и доступности техники.',
      note: 'Это не прогноз засухи на будущий сезон и не расчёт прибавки прибыли.',
    }
  }
  return {
    title: 'Проверить устойчивость к разным сезонам',
    description: 'Сравнивайте стратегии для сухих и влажных лет: один последний сезон NASA не позволяет предсказать следующий. Сохранение структуры почвы и разнообразие культур требуют локальной проверки.',
    note: 'Процент роста маржи не вычисляется без цен, ожидаемой урожайности и затрат.',
  }
}
