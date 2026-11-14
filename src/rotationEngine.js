import { scoreRotation } from './scoringEngine.js'
import { auditStrategy, climateContext, adaptationTip, SCIENCE_REFERENCES } from './scienceChecks.js'
export const SOURCES = {
  ecocrop:SCIENCE_REFERENCES.ecocrop,
  rotat:SCIENCE_REFERENCES.rotat,
  rotation:{label:'Исследование предшественников яровой твёрдой пшеницы в Северном Казахстане',url:'https://bulletinofscience.kazatu.edu.kz/index.php/bulletinofscience/article/view/1481'},
  fallow:{label:'Региональное исследование зернопаровых севооборотов',url:'https://bulletinofscience.kazatu.edu.kz/index.php/bulletinofscience/article/view/1209'},
  nasa:{label:'NASA POWER',url:'https://power.larc.nasa.gov/docs/services/api/temporal/monthly/'},
  soil:{label:'ISRIC SoilGrids WCS',url:'https://docs.isric.org/globaldata/soilgrids/wcs.html'},
}
const STRATEGIES=[
 {id:'diverse',title:'С бобовыми и масличными',crops:['Горох','Пшеница','Лён'],family:['legume','grain','oilseed'],pros:'Разнообразие групп культур и смена зерновых предшественников.',cons:'Нужны подходящие семена, оборудование и проверка влаги.',source:'rotation',rationale:[
  'Горох вводит бобовую культуру. При подходящих условиях возможна симбиотическая фиксация азота, но она не гарантирует дополнительное питание следующей культуры.',
  'Пшеница после гороха использует иной предшественник, чем повторные зерновые. Эффект зависит от влаги, азота, сорта и инфекционного фона.',
  'Лён вводит масличную культуру и уменьшает долю последовательных зерновых. Требует оценки влаги, уборочной техники и гербицидных ограничений.']},
 {id:'cereal',title:'Преимущественно зерновой',crops:['Ячмень','Пшеница','Ячмень'],family:['grain','grain','grain'],pros:'Более привычный набор культур и технологий.',cons:'Общие болезни злаков и меньшая диверсификация.',source:'fallow',rationale:[
  'Ячмень знаком зерновому хозяйству, но при посеве после пшеницы возможны общие болезни злаков.',
  'Пшеница после ячменя сохраняет зерновую специализацию, но не разрывает многие фитосанитарные циклы.',
  'Повтор ячменя требует оценки сорняков, фитосанитарной ситуации, питания и состояния почвы.']},
 {id:'fallow',title:'С чистым паром',crops:['Чистый пар','Пшеница','Ячмень'],family:['fallow','grain','grain'],pros:'Альтернатива для сравнения управления водой и сорняками.',cons:'Нет товарного урожая в паровой год, важно оценить эрозию.',source:'fallow',rationale:[
  'Чистый пар — не культура, а сезон без товарного посева; его влияние на воду зависит от технологии, осадков и испарения.',
  'Пшеница после пара — традиционный контрольный вариант для сравнения, но прибавка урожайности не гарантирована.',
  'Ячмень знаком хозяйству, однако после пшеницы сохраняются общие риски болезней зерновых.']},
]
const knownLegume=c=>/горох|фасол|нут|чечевиц|соя|люцерн/i.test(c||'')
const knownGrain=c=>/пшениц|ячмен|овес|овёс|рож|кукуруз|просо/i.test(c||'')
function statusOfHerbicides(f){
  // Never infer application from a word in free-text notes.
  if(f.herbicideStatus==='yes')return 'Препараты указаны: требуется проверка норм, дат и ограничений на последующие культуры.'
  if(f.herbicideStatus==='no')return 'Фермер сообщил, что гербициды не применялись.'
  return 'История гербицидов неизвестна; для чувствительных культур стоит уточнить препараты.'
}
export function evaluate(field){
  const goals=field.goals||[]
  const rain=field.climate?.precipAnomalyPct
  const dry=typeof rain==='number'&&rain<=-15
  const previous=field.history?.at(-1)?.crop||''
  const lastLegume=knownLegume(previous)
  const lastGrain=knownGrain(previous)
  const manual=field.soilManual||{}
  const soilType=manual.soilType||manual.texture||''
  const moisture=manual.moisture||''
  const fertility=manual.fertility||''
  const problems=Array.isArray(manual.problems)?manual.problems:[]
  const hasFarmerSoil=!!(soilType||moisture||fertility||problems.length)
  const validSoilGrids=Object.values(field.soilResult?.data||{}).some(item=>item&&Number.isFinite(item.value)&&item.value>0)
  const hasSoil=hasFarmerSoil||validSoilGrids

  const list=STRATEGIES.map(opt=>{
    const evidence=[],checks=[],benefits=[opt.pros]
    let priority=0
    // Observations influence comparison, but do not imply laboratory certainty.
    if(moisture==='dry'&&opt.id==='diverse'){
      priority-=1
      checks.push('Фермер отмечает пересыхание: проверить влагообеспечение гороха и льна.')
    }
    if(moisture==='dry'&&opt.id==='fallow'){
      priority+=1
      checks.push('При засухе пар требует отдельной оценки водного баланса и эрозии.')
    }
    if(problems.includes('erosion')&&opt.id==='fallow'){
      priority-=3
      checks.push('При признаках эрозии чистый пар может увеличить риск потери почвы.')
    }
    if((moisture==='wet'||problems.includes('waterlogging'))){
      checks.push('Есть признаки переувлажнения: оценить дренаж и сроки полевых работ.')
    }
    if(problems.includes('salinity')){
      checks.push('Сообщено о возможном засолении: для выбора культур нужен анализ солей.')
    }
    if(problems.includes('compaction')){
      checks.push('Сообщено об уплотнении: проверить обработку почвы и развитие корней.')
    }

    if(opt.id==='diverse'){
      priority+=2
      if(goals.includes('soil')||goals.includes('diversity'))priority+=2
      if(lastLegume){priority-=2;checks.push('В прошлом сезоне уже были бобовые: нужен интервал возврата и проверка заболеваний.')}
      if(lastGrain)priority+=1
    }
    if(opt.id==='cereal'){
      if(goals.includes('cost'))priority+=2
      if(lastGrain){priority-=2;checks.push('Прошлая культура — зерновая. Проверить общие болезни и сорняки.')}
    }
    if(opt.id==='fallow'){
      if(goals.includes('water'))priority+=1
      if(dry)priority+=1
      if(goals.includes('harvest'))priority-=3
      if(goals.includes('erosion'))priority-=2
      checks.push('Паровый год не даёт товарного урожая; проверить эрозию и потери воды.')
    }
    if(typeof rain==='number')evidence.push(`NASA: аномалия осадков за последний полный сезон ${rain>0?'+':''}${rain.toFixed(1)}% к 1991–2020.`)
    else checks.push('Климат NASA ещё не загружен: водный стресс не оценён по рядам наблюдений.')
    if(hasFarmerSoil){
      evidence.push(`Описание почвы фермером: тип ${soilType||'неизвестен'}, влажность ${moisture||'неизвестна'}, плодородие ${fertility||'неизвестно'}. Это наблюдения, а не лабораторные измерения.`)
    }else if(!validSoilGrids){
      checks.push('Нет сведений о почве: укажите хотя бы тип, влажность или плодородие.')
    }
    const ph=field.soilResult?.data?.ph?.value
    if(Number.isFinite(ph)&&ph>0) evidence.push(`SoilGrids: модельный pH ${ph}, 5–15 см.`)
    if(manual.labSource&&manual.ph!==''&&manual.ph!==undefined){
      const labPh=Number(manual.ph)
      if(Number.isFinite(labPh)&&labPh>0&&labPh<=14) evidence.push(`Лабораторный pH: ${labPh}; источник: ${manual.labSource}.`)
    }
    checks.push(statusOfHerbicides(field))
    if(!field.history?.length)checks.push('Отсутствует история предшественников.')
    if(field.budgetScope==='season'&&!field.budget)checks.push('Без бюджета невозможно сравнить расходы; агрономический сценарий можно рассмотреть отдельно.')
    if((field.ownGoal||'').trim())checks.push('Свободная цель фермера сохранена, но не переведена в расчётный параметр автоматически.')
    const scientific = auditStrategy(field, opt.crops)
    const scoring = scoreRotation(field, opt.crops)
    priority += scientific.score
    evidence.push(...scientific.evidence)
    checks.push(...scientific.checks)
    return {...opt,priority,evidence:[...new Set(evidence)],checks:[...new Set(checks)],benefits,scientific,scoring}
  }).sort((a,b)=>{
    const aScore=a.scoring.score, bScore=b.scoring.score
    if(aScore!==null && bScore!==null && aScore!==bScore)return bScore-aScore
    if(aScore===null && bScore!==null)return 1
    if(bScore===null && aScore!==null)return -1
    return b.priority-a.priority||STRATEGIES.findIndex(x=>x.id===a.id)-STRATEGIES.findIndex(x=>x.id===b.id)
  })
  const preferred=list[0]
  const hasNasa=!!field.climate
  const completeness=(hasNasa?1:0)+(hasSoil?1:0)+((field.history||[]).length?1:0)
  return {options:list,preferredId:preferred.id,completeness,hasNasa,hasSoil,climateRisk:climateContext(field),adaptation:adaptationTip(field),
    status:'Предварительный выбор',
    reason:`Вариант «${preferred.title}» выбран по открытой экспертной формуле (${preferred.scoring.score===null?'недостаточно данных':preferred.scoring.score+' / 100'}; доступно критериев ${preferred.scoring.coverage}/4). Баллы являются эвристической оценкой для сравнения, не прогнозом урожая и не доказательством пригодности.`,
    method:'Научный слой: правила смены групп культур, предшественников, повторных посевов, парового года и почвенных рисков; NASA POWER — история климата, а не прогноз. Баллы являются явными весами прототипа, НЕ коэффициентами FAO EcoCrop или расчётом ROTAT. EcoCrop и публикации — справочные источники; числовая база EcoCrop ещё не импортирована. Гербициды, сорта, экономика и интервалы возврата проверяются отдельно.'}
}
