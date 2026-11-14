/** AgroShield pilot weighted decision support.
 * Scores are documented prototype preferences, NOT validated FAO/ROTAT coefficients,
 * yield forecasts, or field-specific agronomic certifications.
 */
import { identifyCrop } from './scienceChecks.js'

export const WEIGHTS = Object.freeze({ agronomy: 35, climate: 30, water: 20, goals: 15 })
export const CRITERIA = Object.freeze({
  agronomy: 'Предшественники и разнообразие',
  climate: 'Климат NASA (исторический контекст)',
  water: 'Водный риск и наблюдения',
  goals: 'Цели и ограничения хозяйства',
})

const GROUP = {
  wheat: 'grain', barley: 'grain', maize: 'grain',
  pea: 'legume', chickpea: 'legume', lentil: 'legume', bean: 'legume',
  flax: 'oil', sunflower: 'oil', rapeseed: 'oil', fallow: 'fallow',
}
const clamp = x => Math.max(0, Math.min(100, x))
const round = x => Math.round(x * 10) / 10
const ids = crops => crops.map(c => identifyCrop(c))
const group = crop => GROUP[identifyCrop(crop)] || 'unknown'

function agronomy(field, crops) {
  const notes = []
  let score = 70
  const past = [...(field.history || [])].sort((a,b) => Number(a.year)-Number(b.year))
  if (!past.length) return { score: null, notes: ['Нет истории посевов: совместимость предшественников не проверена.'] }
  const sequence = [past.at(-1).crop, ...crops]
  for (let i=1; i<sequence.length; i++) {
    const prior = sequence[i-1], current = sequence[i]
    if (identifyCrop(prior) && identifyCrop(prior) === identifyCrop(current) && group(current) !== 'fallow') {
      score -= 25
      notes.push(`${prior} → ${current}: повтор культуры; нужен интервал возврата и фитосанитарная проверка (−25).`)
    } else if (group(prior) === 'grain' && group(current) === 'grain') {
      score -= 12
      notes.push(`${prior} → ${current}: зерновые после зерновых, риск общих болезней (−12).`)
    } else if (group(prior) === 'legume' && group(current) === 'grain') {
      score += 8
      notes.push(`${prior} → ${current}: смена бобовых на зерновые (+8); эффект азота не гарантирован.`)
    }
  }
  if (new Set(crops.map(group).filter(x=>x!=='unknown')).size >= 3) {
    score += 10; notes.push('Три функциональные группы в цикле: диверсификация (+10).')
  }
  for (const crop of crops) {
    const id = identifyCrop(crop)
    if (!id || id === 'fallow') continue
    const lastYear = past.filter(p=>identifyCrop(p.crop)===id).at(-1)?.year
    // This is a warning, not a crop-specific minimum-return ban.
    if (lastYear != null && Number.isFinite(Number(lastYear)) && 2027-Number(lastYear) <= 3) {
      score -= 8
      notes.push(`${crop} уже выращивалась в ${lastYear} году: проверьте интервал возврата (−8).`)
    }
  }
  if (crops.some(c=>group(c)==='fallow') && (field.soilManual?.problems||[]).includes('erosion')) {
    score -= 20; notes.push('Чистый пар при заявленной эрозии: требуется проверка защиты почвы (−20).')
  }
  if (!notes.length) notes.push('Явных повторов культур в проверенной последовательности не найдено.')
  return { score: clamp(score), notes }
}

function climate(field, crops) {
  const c = field.climate
  if (!c || !Number.isFinite(c.precipAnomalyPct)) {
    return { score: null, notes: ['NASA POWER ещё не загружен: климатическая оценка исключена из суммы.'] }
  }
  let score = 70
  const notes = [`NASA POWER: ${c.latestYear || 'последний сезон'}, аномалия осадков ${c.precipAnomalyPct > 0 ? '+' : ''}${round(c.precipAnomalyPct)}%. Это история, не прогноз.`]
  // A single season is weak evidence: only small scoring adjustments permitted.
  if (c.precipAnomalyPct <= -15) {
    if (crops.some(c=>identifyCrop(c)==='maize')) {score-=8;notes.push('Сухой прошлый сезон и кукуруза: проверить водообеспеченность гибрида (−8).')}
    else {score+=2;notes.push('Прошлый сезон был суше нормы: требуется оценка устойчивости, не прогноз (+2).')}
  }
  if (c.precipAnomalyPct >= 15) notes.push('Прошлый сезон влажнее нормы; это не основание считать будущий сезон влажным.')
  // We do not compare an EcoCrop annual precipitation range with NASA May–Aug totals.
  return {score:clamp(score),notes}
}

function water(field, crops) {
  const manual=field.soilManual||{}
  const moisture=manual.moisture
  const problems=Array.isArray(manual.problems)?manual.problems:[]
  const dry=moisture==='dry'
  const wet=moisture==='wet'||problems.includes('waterlogging')
  const erosion=problems.includes('erosion')
  if (!dry && !wet && !erosion && moisture !== 'normal') return {
    score: null, notes:['Нет наблюдений о влаге или проблемах поля: водный критерий не оценён.'],
  }
  let score=70
  const notes=[]
  if (dry) {
    if(crops.some(c=>identifyCrop(c)==='maize') && field.irrigation!=='yes') {
      score-=25;notes.push('Фермер сообщил о пересыхании; кукуруза без указанного полива (−25).')
    }
    if(crops.some(c=>group(c)==='fallow')) {
      score-=8;notes.push('Пар при пересыхании почвы требует проверки сохранения влаги (−8).')
    }
    if(crops.some(c=>group(c)==='legume')) notes.push('Бобовые не гарантируют меньший расход влаги: проверить сроки и сорт.')
  }
  if(wet) notes.push('Отмечен застой влаги: нужен дренаж и проверка пригодности культур.')
  if(erosion && crops.some(c=>group(c)==='fallow')) {score-=20;notes.push('Пар при эрозии может увеличить риск потери почвы (−20).')}
  if(!notes.length)notes.push('Серьёзных ограничений по указанным наблюдениям не выявлено.')
  return {score:clamp(score),notes}
}

function preferences(field, crops) {
  const goals=Array.isArray(field.goals)?field.goals:[]
  if(!goals.length)return {score:null,notes:['Цели фермера не заданы: критерий предпочтений исключён.']}
  let score=70
  const notes=[]
  const hasFallow=crops.some(c=>group(c)==='fallow')
  const diverse=new Set(crops.map(group)).size >= 3
  if(goals.includes('harvest') && hasFallow){score-=30;notes.push('Цель — урожай каждый год; год чистого пара без товарного урожая (−30).')}
  if(goals.includes('soil') && diverse){score+=15;notes.push('Цель — сохранить плодородие; разнотипная последовательность (+15, качественная оценка).')}
  if(goals.includes('diversity') && diverse){score+=12;notes.push('Цель — разнообразие культур (+12).')}
  if(goals.includes('erosion') && hasFallow){score-=12;notes.push('Цель — снизить эрозию, но присутствует чистый пар (−12).')}
  if(goals.includes('cost'))notes.push('Для цели «сократить расходы» нет подтверждённых затрат по культурам: экономический бонус не начислялся.')
  if(goals.includes('water'))notes.push('Цель «снизить риск засухи» учитывается через водный критерий при наличии наблюдений.')
  if(!notes.length)notes.push('По заданным целям нет достаточных данных для различающего расчёта.')
  return {score:clamp(score),notes}
}

/** Pure auditable score for one candidate rotation. Scores = pilot heuristics, not probabilities. */
export function scoreRotation(field, crops) {
  const dimensions={
    agronomy:agronomy(field,crops),
    climate:climate(field,crops),
    water:water(field,crops),
    goals:preferences(field,crops),
  }
  const available=Object.entries(dimensions).filter(([,d])=>d.score!==null)
  const usedWeight=available.reduce((sum,[k])=>sum+WEIGHTS[k],0)
  const score=usedWeight ? round(available.reduce((sum,[k,d])=>sum+d.score*WEIGHTS[k],0)/usedWeight):null
  const coverage=Object.keys(dimensions).filter(k=>dimensions[k].score!==null).length
  const limitations=[]
  if(!field.history?.length)limitations.push('Отсутствует история посевов.')
  if(!field.climate)limitations.push('NASA POWER не загружен.')
  if(!field.soilManual?.soilType && !field.soilResult?.data?.ph?.value)limitations.push('Тип почвы и лабораторная кислотность не проверены.')
  if(field.herbicideStatus!=='no')limitations.push('Действующие вещества гербицидов и ограничения не подтверждены.')
  if(coverage < 4)limitations.push('Не все критерии оценены; неизвестные не считаются нулями.')
  const historical = [...(field.history || [])].sort((a,b)=>Number(a.year)-Number(b.year))
  const steps = [historical.at(-1)?.crop || null, ...crops]
  const cropChecks = crops.map((crop,index)=>{
    const prior=steps[index]
    const facts=[]
    if (!prior) facts.push('Предшественник неизвестен: нет полной истории посевов.')
    else if (identifyCrop(prior)===identifyCrop(crop) && identifyCrop(crop)!=='fallow') facts.push(`После ${prior} повторяется ${crop}: необходима проверка болезней и интервала возврата.`)
    else if (group(prior)==='grain'&&group(crop)==='grain') facts.push(`После ${prior} остаётся группа зерновых: общие фитосанитарные риски.`)
    else if (group(prior)==='legume'&&group(crop)==='grain') facts.push(`После ${prior} следует зерновая культура: возможное преимущество предшественника зависит от условий.`)
    else facts.push(`Предшественник ${prior}; последовательность проверена по общим правилам групп культур.`)
    if (identifyCrop(crop)==='fallow') facts.push('Чистый пар не даёт товарного урожая в этот год; учтите эрозию и потери влаги.')
    if (field.soilManual?.moisture==='dry') facts.push('Фермер сообщил о пересыхании почвы; требуется оценка потребности этой культуры во влаге.')
    if (field.climate&&Number.isFinite(field.climate.precipAnomalyPct)) facts.push(`NASA POWER: аномалия осадков прошлого сезона ${round(field.climate.precipAnomalyPct)}%; это не прогноз погоды на год посева.`)
    else facts.push('Нет данных NASA для климатической проверки.')
    return facts
  })
  return {score,coverage,dimensions,weights:WEIGHTS,limitations,cropChecks,method:'Взвешенное среднее доступных критериев; веса 35/30/20/15 и штрафы — открытые правила пилотного прототипа, не коэффициенты FAO или ROTAT. Без прогноза урожая, прибыли и будущей погоды.'}
}
