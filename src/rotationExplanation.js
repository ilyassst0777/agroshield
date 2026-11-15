import {cropById} from './cropCatalog.js'
const money=value=>value.toLocaleString('ru-RU',{maximumFractionDigits:1})

// Same ordered criteria drive both the ordering and its written explanation.
export function preferenceDifference(a,b,goals=[]){
 if(goals.includes('harvest')&&(a.cropIds[0]==='fallow')!==(b.cropIds[0]==='fallow'))return {order:a.cropIds[0]==='fallow'?1:-1,reason:'в первом году предусмотрен товарный посев вместо чистого пара'}
 if(a.structure.repeats!==b.structure.repeats)return {order:a.structure.repeats-b.structure.repeats,reason:'меньше повторов одной культуры подряд в проверенной части последовательности'}
 if(a.structure.grainTransitions!==b.structure.grainTransitions)return {order:a.structure.grainTransitions-b.structure.grainTransitions,reason:'меньше последовательных переходов между зерновыми'}
 if(goals.includes('erosion')&&a.structure.fallow!==b.structure.fallow)return {order:a.structure.fallow-b.structure.fallow,reason:'меньше паровых лет при выбранной цели уменьшить риски парового года'}
 if(goals.some(g=>['soil','diversity'].includes(g))&&a.structure.groups!==b.structure.groups)return {order:b.structure.groups-a.structure.groups,reason:'больше функциональных групп культур при выбранной цели разнообразия'}
 if(goals.includes('cost')&&a.costs.complete&&b.costs.complete&&a.costs.total!==b.costs.total)return {order:a.costs.total-b.costs.total,reason:'ниже известные расходы за три года при равенстве предыдущих критериев'}
 return {order:0,reason:''}
}
export function explainRotation(profile,option,alternatives){
 const paragraphs=[],ids=option.cropIds,crops=ids.map(cropById)
 const sequence=crops.map((crop,index)=>`${profile.startYear+index} — ${crop.name.toLowerCase()}`).join(', ')
 paragraphs.push(`Для поля «${profile.field.name||'Выбранное поле'}» рассматривается последовательность: ${sequence}. ${option.eligible?'Она не нарушает введённые обязательные ограничения.':'При текущих условиях она не проходит обязательные ограничения; причины перечислены ниже.'}`)
 const details=[]
 if(option.structure.groups>1)details.push(`в посевах представлены ${option.structure.groups} функциональные группы`)
 if(option.structure.repeats===0)details.push('в проверенной части нет повторов одной культуры подряд')
 if(option.structure.grainTransitions===0)details.push('нет последовательных переходов между зерновыми в проверенной части')
 if(details.length)paragraphs.push(`По структуре: ${details.join('; ')}. Это объясняет место варианта в сравнении, но не гарантирует урожайность.`)
 const legumeToWheat=crops.some((crop,i)=>i>0&&crop.id==='wheat'&&crops[i-1].group==='legume')
 if(legumeToWheat)paragraphs.push('Перед пшеницей стоит бобовая культура. Такой переход рассматривается с опорой на исследования предшественников; эффект зависит от вида пшеницы, почвы, влаги и технологии. Региональная публикация относится к яровой твёрдой пшенице на обыкновенном чернозёме, поэтому не доказывает пригодность всей схемы для любого поля.')
 if(option.costs.complete){
  const years=option.costs.years.map(y=>`${y.year} — ${money(y.total)} ₸`).join('; ')
  let budget='Бюджет не указан, соответствие ему не подтверждено.'
  if(profile.budget!==null){
   const fits=profile.planning.budgetPeriod==='rotation'?option.costs.total<=profile.budget:option.costs.years.every(y=>y.total<=profile.budget)
   budget=`При бюджете ${money(profile.budget)} ₸ ${profile.planning.budgetPeriod==='rotation'?'на все три года':'на каждый сезон'} ${fits?'известные расходы укладываются в лимит':'расходы превышают лимит'}.`
  }
  paragraphs.push(`Расходы (${option.costs.basis.toLowerCase()}): ${years}; всего ${money(option.costs.total)} ₸. ${budget}`)
 }else paragraphs.push('Расходы известны не полностью. Доступность по бюджету проверена только в известной части; финансовое преимущество не заявляется.')
 const climate=profile.hasNasa?'Климат NASA используется как исторический контекст для проверки водных рисков; он не определяет порядок этих культур автоматически.':'Данных NASA для этого поля пока нет.'
 paragraphs.push(climate+' '+(profile.previous?.cropId?`Непосредственный предшественник: ${profile.previous.year} — ${profile.previous.crop}.`:'Непосредственный предшественник неизвестен: первая смена культур проверена не полностью.'))
 const other=alternatives.filter(a=>a.id!==option.id)
 const better=other.find(a=>preferenceDifference(a,option,profile.field.goals).order<0)
 const worse=other.find(a=>preferenceDifference(option,a,profile.field.goals).order<0)
 const equal=other.filter(a=>preferenceDifference(option,a,profile.field.goals).order===0)
 let comparison='Других допустимых последовательностей по заданным условиям не найдено. Это не подтверждает полноту агрономической проверки.'
 if(!option.eligible)comparison='Эту схему нельзя рекомендовать при текущих обязательных ограничениях, даже если её структура имеет преимущества.'
 else if(better){const diff=preferenceDifference(better,option,profile.field.goals);comparison=`По заданному порядку предпочтений раньше рассматривается «${better.title}»: ${diff.reason}. Текущая схема остаётся альтернативой, а не объявляется лучшей.`}
 else if(worse){const diff=preferenceDifference(option,worse,profile.field.goals);comparison=`Перед «${worse.title}» этот вариант показан потому, что ${diff.reason}. ${equal.length?'Есть и равноценные по проверенным предпочтениям схемы; единственный лучший вариант не установлен.':'Преимущество относится к заданным условиям сравнения, а не ко всем возможным агрономическим факторам.'}`}
 else if(equal.length)comparison=`Среди допустимых схем есть равноценные по проверенным предпочтениям, например «${equal[0].title}». Данных недостаточно, чтобы доказать преимущество именно этого порядка культур; порядок показа при равенстве технический.`
 return {title:option.eligible?'Почему рассматривается этот вариант':'Почему эту схему нельзя выбрать',paragraphs,comparison,sourceIds:legumeToWheat?['rotationPrinciples','rotation']:['rotationPrinciples']}
}
