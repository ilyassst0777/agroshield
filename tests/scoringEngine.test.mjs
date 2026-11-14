import assert from 'node:assert/strict'
import {scoreRotation, WEIGHTS} from '../src/scoringEngine.js'
import {evaluate} from '../src/rotationEngine.js'

const field = {
  history:[{year:2023,crop:'Горох'}, {year:2024,crop:'Ячмень'}, {year:2025,crop:'Пшеница'}],
  climate:{latestYear:2025,latestRainMm:286,precipAnomalyPct:39,latestTempC:17.5},
  soilManual:{soilType:'chernozem',moisture:'dry',problems:['erosion']},
  goals:['harvest','soil','water'], irrigation:'no',herbicideStatus:'no',
}
assert.equal(Object.values(WEIGHTS).reduce((a,b)=>a+b,0),100)
const candidates=[['Горох','Пшеница','Лён'],['Чистый пар','Пшеница','Ячмень'],['Ячмень','Пшеница','Ячмень']]
for(const crops of candidates){
  const result=scoreRotation(field,crops)
  assert(result.score >=0 && result.score<=100)
  assert.equal(result.coverage,4)
  assert.equal(Object.keys(result.dimensions).length,4)
  assert.equal(result.cropChecks.length,3)
}
const diverse=scoreRotation(field,candidates[0])
const cereal=scoreRotation(field,candidates[2])
assert(diverse.score>cereal.score,'History and diversity should affect the ranking')
assert(scoreRotation({...field,history:[]},candidates[0]).dimensions.agronomy.score === null)
assert(scoreRotation({...field,climate:null},candidates[0]).dimensions.climate.score === null)
assert(scoreRotation({...field,soilManual:{}},candidates[0]).dimensions.water.score === null)
assert(scoreRotation({...field,goals:[]},candidates[0]).dimensions.goals.score === null)
const result=evaluate(field)
assert.equal(result.options.length,3)
assert.equal(result.preferredId,result.options[0].id)
assert(result.options.every(x=>x.scoring && x.scoring.dimensions))
const differentHistory=evaluate({...field,history:[{year:2025,crop:'Горох'}]})
assert.notEqual(result.options.find(x=>x.id==='diverse').scoring.dimensions.agronomy.score,
  differentHistory.options.find(x=>x.id==='diverse').scoring.dimensions.agronomy.score)
const drought=scoreRotation({...field,climate:{latestYear:2025,precipAnomalyPct:-25}},['Кукуруза','Пшеница','Ячмень'])
assert(drought.dimensions.climate.notes.some(x=>x.includes('кукуруза')))
assert(!JSON.stringify(result).includes('прогноз урожайности'))
console.log('Transparent scoring tests passed')
