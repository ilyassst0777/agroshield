export const STATUS_LABELS={blocked:'Не проходит ограничения',review:'Требует проверки',consider:'Можно рассмотреть'}
import {buildProfile,inputLedger} from './analysisProfile.js'
import {checkConstraints} from './scoringEngine.js'
import {cropById,resolveCrop,RULE_VERSION} from './cropCatalog.js'

export function assessRotation(profile,ids){
 const crops=ids.map(cropById),constraints=checkConstraints(profile,ids)
 const strengths=[],risks=[],seen=[profile.previous?.cropId,...ids]
 let repeats=0,grainTransitions=0
 for(let i=1;i<seen.length;i++){
  const prior=cropById(seen[i-1]),current=cropById(seen[i]);if(!prior)continue
  if(prior.id===current.id&&current.id!=='fallow'){repeats++;risks.push(`${profile.startYear+i-1}: повтор ${current.name.toLowerCase()}. Нужна проверка фитосанитарных рисков и местного интервала возврата.`)}
  else if(prior.group==='grain'&&current.group==='grain'){grainTransitions++;risks.push(`${prior.name} → ${current.name}: зерновые следуют за зерновыми; проверьте общие болезни и сорняки.`)}
  else if(prior.group==='legume'&&current.group==='grain')strengths.push(`${prior.name} → ${current.name}: меняется группа предшественников. Возможный эффект бобовых зависит от влаги, питания и технологии.`)
 }
 const groups=new Set(crops.filter(c=>c.group!=='fallow').map(c=>c.group))
 if(groups.size>1)strengths.push(`В последовательности ${groups.size} группы товарных культур: это разнообразие посевов, без обещания прибавки урожая.`)
 if(crops[0].id!=='fallow'&&(profile.field.goals||[]).includes('harvest'))strengths.push('В первый год предусмотрен товарный посев — соответствует цели получить урожай в следующем сезоне.')
 if(crops.some(c=>c.id==='fallow'))risks.push('В паровой год товарного урожая нет; сохранение влаги и защита почвы зависят от технологии.')
 if(crops.some(c=>c.id==='fallow')&&(profile.manual.problems||[]).includes('erosion'))risks.push('При заявленной эрозии паровой год требует отдельной почвозащитной проверки.')
 if(profile.manual.moisture==='dry')risks.push('Фермер сообщил о пересыхании. Достаточность воды для сортов не рассчитана; исторические осадки не заменяют водный баланс.')
 if(profile.manual.moisture==='wet'||(profile.manual.problems||[]).includes('waterlogging'))risks.push('Фермер сообщил о застое воды. Уточнение дренажа и пригодности культур требуется для переувлажняемой части поля.')
 const pending=[...new Set([...profile.pending,...constraints.pending])]
 const status=constraints.rejected.length?'blocked':risks.length||pending.length?'review':'consider'
 const climate=profile.hasNasa?profile.climate:null
 const baseline=climate?.baselineRain
 const dry=baseline>0?profile.rows.filter(r=>r.rainMm<baseline*.85).length:null
 const climateText=climate?(dry!==null?`NASA: ${profile.rows.length} исторических сезонов; в ${dry} осадки ниже 85% опорного уровня ${baseline} мм. Это описательный порог, не прогноз и не диагноз засухи.`:`NASA: данные за ${climate.latestYear||'доступный период'}. Это исторический контекст, не прогноз.`):'Климат NASA для поля не загружен.'
 const rows=[
  {label:'Предшественник',state:profile.previous?.cropId?'Установлен':'Не установлен',detail:profile.previous?`${profile.previous.year}: ${profile.previous.crop}`:'Первая смена культур проверена не полностью.'},
  {label:'Последовательность',state:repeats||grainTransitions?'Есть риски для проверки':'Явных повторов нет',detail:`Повторов одной культуры подряд: ${repeats}; переходов между зерновыми: ${grainTransitions}. Это проверка структуры, не сертификация пригодности.`},
  {label:'Климат NASA',state:climate?'Исторический контекст':'Нет данных',detail:climateText},
  {label:'Почва',state:profile.hasSoil?'Сведения получены':'Нет данных',detail:profile.ph===null?'Без pH и проверенных требований сорта полная пригодность не установлена.':`pH ${profile.ph}; ${profile.phMeasured?'анализ с указанным источником':'модель или неподтверждённое значение'}. Диапазоны проверяются только при заданных правилах.`},
  {label:'Расходы',state:constraints.costs.complete?'Рассчитаны':'Неполные данные',detail:constraints.costs.complete?`${constraints.costs.basis}: ${constraints.costs.total.toLocaleString('ru-RU')} ₸ за три года.`:'Неизвестные затраты не считаются нулевыми; бюджет проверен только в известной части.'}
 ]
 const canApprove=constraints.eligible&&profile.hasNasa&&profile.hasSoil&&Boolean(profile.previous?.cropId)&&!profile.inputErrors.length&&(profile.budget===null||constraints.costs.complete)
 return {id:ids.join('-'),title:crops.map(c=>c.name).join(' → '),crops:crops.map(c=>c.name),cropIds:ids,eligible:constraints.eligible,canApprove,
  assessment:{status,strengths:[...new Set(strengths)],risks:[...new Set(risks)],pending,blocked:constraints.rejected,rows,climateText},
  costs:constraints.costs,scoring:{constraints,costs:constraints.costs},structure:{repeats,grainTransitions,groups:groups.size,fallow:ids.filter(id=>id==='fallow').length}}
}
export function evaluate(field,custom=''){
 const p=buildProfile(field),eligible=[],rejected=[]
 if(!p.inputErrors.length)for(const a of p.allowed)for(const b of p.allowed)for(const c of p.allowed){const option=assessRotation(p,[a,b,c]);(option.eligible?eligible:rejected).push(option)}
 // Sequential, explicit preferences; no synthetic scores, weights or risk probabilities.
 eligible.sort((a,b)=>{
  if((field.goals||[]).includes('harvest')&&(a.cropIds[0]==='fallow')!==(b.cropIds[0]==='fallow'))return a.cropIds[0]==='fallow'?1:-1
  if(a.structure.repeats!==b.structure.repeats)return a.structure.repeats-b.structure.repeats
  if(a.structure.grainTransitions!==b.structure.grainTransitions)return a.structure.grainTransitions-b.structure.grainTransitions
  if((field.goals||[]).includes('erosion')&&a.structure.fallow!==b.structure.fallow)return a.structure.fallow-b.structure.fallow
  if((field.goals||[]).some(g=>['soil','diversity'].includes(g))&&a.structure.groups!==b.structure.groups)return b.structure.groups-a.structure.groups
  if((field.goals||[]).includes('cost')&&a.costs.complete&&b.costs.complete&&a.costs.total!==b.costs.total)return a.costs.total-b.costs.total
  return a.id.localeCompare(b.id)
 })
 let customOption=null,customError=''
 if(Array.isArray(custom)?custom.length:String(custom).trim()){
  const ids=(Array.isArray(custom)?custom:String(custom).split(/[;\n→]/).map(v=>v.replace(/^\s*\d{4}\s*[-—:–]\s*/,''))).map(resolveCrop)
  if(ids.length!==3||ids.some(id=>!id))customError='Выберите три культуры из каталога.'
  else if(p.inputErrors.length)customError='Исправьте значения условий перед проверкой своего варианта.'
  else customOption=assessRotation(p,ids)
 }
 const ledger=inputLedger(p).map(row=>row.label==='Цели фермера'?{...row,detail:'Учитываются при последовательном сравнении: товарный посев первого года, разнообразие, пар и известные затраты.'}:row.label==='NASA: осадки'?{...row,status:p.hasNasa?'context':'missing',detail:eligible[0]?.assessment.climateText||'Исторический климатический контекст; водная пригодность сортов не рассчитана.'}:row)
 return {options:eligible.slice(0,3),customOption,customError,preferredId:null,ruleVersion:RULE_VERSION,dataVersion:field.dataVersion,startYear:p.startYear,
  generatedCount:p.inputErrors.length?0:p.allowed.length**3,eligibleCount:eligible.length,rejectedCount:rejected.length,
  rejectedExamples:rejected.slice(0,3).map(o=>({title:o.title,reasons:o.assessment.blocked})),inputErrors:p.inputErrors,ledger,inputSnapshot:p.snapshot,
  hasNasa:p.hasNasa,hasSoil:p.hasSoil,canApprove:eligible.some(o=>o.canApprove),limitations:p.pending,
  reason:eligible.length?'Предварительные варианты по доступным данным. Проверены заданные ограничения; подходящие по структуре варианты показаны для сравнения.':'По заданным условиям вариантов не найдено. Причины исключения приведены ниже.',
  method:'Перебор доступных культур на три года с проверкой заданных ограничений. Последовательное сравнение: товарный посев первого года по цели, меньше повторов и переходов между зерновыми, разнообразие и пар по целям, затем известные расходы. Варианты без различий показываются в стабильном порядке без утверждения единственного победителя. NASA — исторический контекст. Автоматического расчёта урожая, водного баланса или нейросети нет.'}
}
