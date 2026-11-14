import assert from 'node:assert/strict'
import { evaluate } from '../src/rotationEngine.js'
import { auditStrategy, climateContext, identifyCrop, adaptationTip } from '../src/scienceChecks.js'

const base = {
  history:[{year:2025,crop:'Пшеница'},{year:2026,crop:'Ячмень'}],
  climate:{latestYear:2025,precipAnomalyPct:-25,latestRainMm:150},
  soilManual:{soilType:'chernozem',moisture:'dry',problems:['erosion']},
  goals:['soil','water'], irrigation:'no', herbicideStatus:'unknown'
}
assert.equal(identifyCrop('Пшеница яровая'),'wheat')
assert.equal(identifyCrop('Картофель с фасолью'),'bean') // recognized component only; not a full mixed-crop model
assert.equal(climateContext(base).type,'historically_dry')
assert.match(adaptationTip(base).note,/не прогноз|не расчёт/)
const audit = auditStrategy(base,['Чистый пар','Пшеница','Ячмень'])
assert(audit.checks.some(x=>x.includes('эрози')))
const result = evaluate(base)
assert.equal(result.options.length,3)
assert.equal(new Set(result.options.map(x=>x.id)).size,3)
assert.equal(result.hasNasa,true)
assert.equal(result.hasSoil,true)
assert(result.options.every(x=>Array.isArray(x.scientific.checks)))
const bare = evaluate({history:[],goals:[],soilManual:{},climate:null})
assert.equal(bare.hasNasa,false)
assert.equal(bare.hasSoil,false)
assert.equal(bare.options.length,3)
console.log('Science and rotation tests passed')
