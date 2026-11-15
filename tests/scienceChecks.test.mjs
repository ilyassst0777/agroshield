import test from 'node:test'
import assert from 'node:assert/strict'
import {auditStrategy,climateContext,identifyCrop} from '../src/scienceChecks.js'
test('crop identification and historical context',()=>{assert.equal(identifyCrop('Пшеница яровая'),'wheat');assert.equal(climateContext({climate:{precipAnomalyPct:-25}}).type,'historically_dry')})
test('scientific audit does not invent the immediate predecessor',()=>{const r=auditStrategy({planning:{startYear:2027},history:[{year:2025,crop:'Пшеница'}]},['Пшеница','Горох','Лён']);assert(!r.checks.some(s=>s.includes('снова')))})
