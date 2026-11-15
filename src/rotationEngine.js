import {CATALOG_SOURCE} from './cropCatalog.js'
import {SCIENCE_REFERENCES} from './scienceChecks.js'
export {evaluate} from './qualitativeEngine.js'

export const SOURCES = {
  legumeMechanism: {label:'USDA NRCS: азотфиксация и разложение остатков бобовых',url:'https://www.nrcs.usda.gov/sites/default/files/2023-04/nrcs142p2_053276.pdf'},
  rotationDiseaseMechanism: {label:'SDSU Extension: механизмы севооборота и общие болезни культур',url:'https://extension.sdstate.edu/crop-rotation-farm-management'},
  rotationPrinciples: {label: 'FAO: планирование севооборотов и сохранение почвы', url: 'https://www.fao.org/agriculture/crops/thematic-sitemap/theme/spi/scpi-home/managing-ecosystems/conservation-agriculture/ca-how/en/'},
  ecocrop: SCIENCE_REFERENCES.ecocrop, rotat: SCIENCE_REFERENCES.rotat,
  rotation: { label: 'Исследование предшественников яровой твёрдой пшеницы в Северном Казахстане', url: 'https://bulletinofscience.kazatu.edu.kz/index.php/bulletinofscience/article/view/1481' },
  water: { label: 'FAO: потребность культур в воде и зависимость от условий', url: CATALOG_SOURCE },
  nasa: { label: 'NASA POWER', url: 'https://power.larc.nasa.gov/docs/services/api/temporal/monthly/' },
  soil: { label: 'ISRIC SoilGrids WCS', url: 'https://docs.isric.org/globaldata/soilgrids/wcs.html' },
}

