/** Small, editable pilot catalogue. Ordinal risk factors are prototype assumptions,
 * not measured water requirements, local variety recommendations or FAO coefficients.
 * Hard pH/return-period restrictions only come from the user's documented rules. */
export const RULE_VERSION = 'field-profile-1.0'
export const CATALOG_SOURCE = 'https://www.fao.org/4/s2022e/s2022e07.htm'
export const CROP_CATALOG = Object.freeze([
  { id: 'wheat', name: 'Пшеница', group: 'grain', drought: 1.5, wet: 1.5 },
  { id: 'barley', name: 'Ячмень', group: 'grain', drought: 1.5, wet: 1.5 },
  { id: 'pea', name: 'Горох', group: 'legume', drought: 2.5, wet: 2 },
  { id: 'flax', name: 'Лён', group: 'oil', drought: 2, wet: 2 },
  { id: 'maize', name: 'Кукуруза', group: 'grain', drought: 2.5, wet: 1.5 },
  { id: 'fallow', name: 'Чистый пар', group: 'fallow', drought: 0, wet: 0 },
])
export const DEFAULT_CROPS = ['wheat', 'barley', 'pea', 'flax']
export const cropById = id => CROP_CATALOG.find(crop => crop.id === id)
export const cropName = id => cropById(id)?.name || id
export const numberOrNull = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(String(value).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}
export function resolveCrop(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е')
  return CROP_CATALOG.find(crop => [crop.id, crop.name.toLowerCase().replace(/ё/g, 'е')].includes(text))?.id ||
    ({ 'пшеница яровая': 'wheat', 'яровая пшеница': 'wheat', 'ячмень яровой': 'barley', 'пар': 'fallow', 'лен масличный': 'flax' })[text] || null
}
export function planningFor(field) {
  return {
    startYear: new Date().getFullYear() + 1,
    allowedCrops: DEFAULT_CROPS,
    cropRules: {},
    budgetPeriod: 'annual',
    maxFallowYears: 1,
    ...field.planning,
  }
}
