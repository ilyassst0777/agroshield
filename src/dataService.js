const TIMEOUT = 125_000
export async function api(path, payload, isFile = false) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch('/api/' + path, {
      method: 'POST',
      headers: isFile ? undefined : {'Content-Type': 'application/json'},
      body: isFile ? payload : JSON.stringify(payload),
      signal: controller.signal,
    })
    let body
    try { body = await response.json() } catch { throw Error('Сервер вернул неожиданный ответ. Проверьте, запущен ли Python API.') }
    if (!response.ok) throw Error(typeof body.detail === 'string' ? body.detail : `Ошибка HTTP ${response.status}`)
    return body
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Истекло время ожидания сервиса. Повторите попытку.', {cause:error})
    if (error instanceof TypeError) throw new Error('Не найден Python API. Запустите Python API и Vite.', {cause:error})
    throw error
  } finally { clearTimeout(timer) }
}
export function loadNasa(field, force = false) {
  const center = field.center || [54.87, 69.15]
  return api('nasa',{lat: center[0],lon:center[1],force})
}
export function loadSoil(field, force = false) {
  const center = field.center || [54.87, 69.15]
  return api('soil',{lat:center[0],lon:center[1],geometry:field.geometry||null,force})
}
export function previewUpload(file){const data = new FormData();data.append('file',file);return api('files/preview',data,true)}
export function commitUpload(token){return api('files/commit',{token})}
