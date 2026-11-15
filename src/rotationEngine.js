import { scoreRotation } from './scoringEngine.js'
import { buildProfile, inputLedger } from './analysisProfile.js'
import { CATALOG_SOURCE, cropById, resolveCrop, RULE_VERSION } from './cropCatalog.js'
import { auditStrategy, climateContext, adaptationTip, SCIENCE_REFERENCES } from './scienceChecks.js'

export const SOURCES = {
  ecocrop: SCIENCE_REFERENCES.ecocrop, rotat: SCIENCE_REFERENCES.rotat,
  rotation: { label: 'Исследование предшественников яровой твёрдой пшеницы в Северном Казахстане', url: 'https://bulletinofscience.kazatu.edu.kz/index.php/bulletinofscience/article/view/1481' },
  water: { label: 'FAO: потребность культур в воде и зависимость от условий', url: CATALOG_SOURCE },
  nasa: { label: 'NASA POWER', url: 'https://power.larc.nasa.gov/docs/services/api/temporal/monthly/' },
  soil: { label: 'ISRIC SoilGrids WCS', url: 'https://docs.isric.org/globaldata/soilgrids/wcs.html' },
}

function candidate(profile, ids, custom = false) {
  const crops = ids.map(id => cropById(id).name)
  const scoring = scoreRotation(profile.field, ids, profile)
  const scientific = auditStrategy(profile.field, crops)
  const title = crops.join(' → ')
  return {
    id: ids.join('-'), title, crops, cropIds: ids, custom, scoring, scientific,
    eligible: scoring.constraints.eligible,
    canApprove: scoring.constraints.eligible && profile.hasNasa && profile.hasSoil && Boolean(profile.previous?.cropId) &&
      !profile.inputErrors.length && (profile.budget === null || scoring.costs.complete),
    checks: [...new Set([...scoring.limitations, ...scoring.constraints.rejected])],
    pros: `${profile.startYear}–${profile.startYear + 2}; ${new Set(ids.map(id => cropById(id).group)).size} функциональные группы.`,
    cons: scoring.constraints.pending[0] || 'Нужна проверка местных сортов и технологии.', source: 'rotation',
    rationale: ids.map((id, index) => `${profile.startYear + index}: ${cropById(id).name}. Причины оценки приведены по критериям; фиксированной прибавки урожая или азота не предполагается.`),
  }
}

function parseCustom(text) {
  if (Array.isArray(text)) return text.map(resolveCrop)
  return String(text || '').split(/[;\n→]/).map(value => value.replace(/^\s*\d{4}\s*[-—:–]\s*/, '').trim()).filter(Boolean).map(resolveCrop)
}

export function evaluate(field, custom = '') {
  const profile = buildProfile(field)
  const evaluated = [], rejected = []
  if (!profile.inputErrors.length) {
    for (const first of profile.allowed) for (const second of profile.allowed) for (const third of profile.allowed) {
      const option = candidate(profile, [first, second, third])
      ;(option.eligible ? evaluated : rejected).push(option)
    }
  }
  const ranked = evaluated.sort((a, b) => (b.scoring.score ?? -1) - (a.scoring.score ?? -1) ||
    b.scoring.usedWeight - a.scoring.usedWeight || a.id.localeCompare(b.id))
  const preferred = ranked[0], options = ranked.slice(0, 3)
  const tied = preferred && ranked.filter(option => option.scoring.score === preferred.scoring.score && option.scoring.usedWeight === preferred.scoring.usedWeight).length > 1
  let customOption = null, customError = ''
  if (Array.isArray(custom) ? custom.length > 0 : String(custom).trim()) {
    const ids = parseCustom(custom)
    if (ids.length !== 3 || ids.some(id => !id)) customError = 'Выберите три культуры из каталога. В тексте разделяйте годы точкой с запятой.'
    else customOption = candidate(profile, ids, true)
  }
  const covers = [...new Set(ranked.map(option => option.scoring.usedWeight))]
  return {
    options, customOption, customError, preferredId: preferred?.scoring.score !== null ? preferred?.id || null : null, tied,
    startYear: profile.startYear, dataVersion: field.dataVersion, ruleVersion: RULE_VERSION,
    generatedCount: profile.inputErrors.length ? 0 : profile.allowed.length ** 3,
    eligibleCount: evaluated.length, rejectedCount: rejected.length,
    rejectedExamples: rejected.slice(0, 3).map(option => ({ title: option.title, reasons: option.scoring.constraints.rejected })),
    inputErrors: profile.inputErrors, ledger: inputLedger(profile), inputSnapshot: profile.snapshot,
    hasNasa: profile.hasNasa, hasSoil: profile.hasSoil,
    canApprove: profile.hasNasa && profile.hasSoil && Boolean(profile.previous?.cropId) && !profile.inputErrors.length && Boolean(preferred),
    limitations: [...profile.pending, ...(covers.length > 1 ? ['Полнота критериев различается между вариантами: сравните пропуски перед решением.'] : [])],
    climateRisk: climateContext(field), adaptation: adaptationTip(field), status: 'Предварительное сравнение',
    reason: preferred ? preferred.scoring.score === null ? 'Недостаточно данных для ранжирования. Показаны варианты для последующей проверки.' : `${tied ? 'Несколько вариантов имеют одинаковую оценку. Один из первых' : 'Первый по пилотной оценке'}: ${preferred.title}. Оценка ${preferred.scoring.score}/100; учтено ${preferred.scoring.usedWeight}% веса. Проверено без выявленных нарушений: ${evaluated.length} вариантов. Выбор предварительный.` : 'Подходящих вариантов по заданным условиям нет. Проверьте ограничения и недостающие данные.',
    method: 'Перебор трёхлетних последовательностей доступных культур. Проверяются фактические годы истории, заданные интервалы возврата, запреты, pH с источником, сроки и бюджет. Климатические сезоны, вода, почва и цели участвуют в открытой оценке. PDF и свободные заметки не превращаются автоматически в числовые измерения. Нейросеть и прогноз урожая не используются.',
  }
}
