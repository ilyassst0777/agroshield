import ScoringDetails from './ScoringDetails.jsx'

export default function AnalysisArchive({ field }) {
  return <section className="panel"><h2>История анализов</h2><p className="muted">Отдельно для поля «{field.name}». Сохранённые результаты используют данные на момент решения.</p>
    {!field.analyses?.length ? <p className="subtle-note">Результатов и решений пока нет.</p> : field.analyses.map(entry => <div className="info-card" key={entry.id}>
      <div className="section-head"><h3>{({ approve: 'Утверждённый план', draft: 'Черновик', reject: 'Отклонённый вариант', proposal: 'Предложение фермера' })[entry.type] || 'Решение'}</h3><small className="muted">{new Date(entry.date).toLocaleDateString('ru-RU')}</small></div>
      <p>{entry.name || entry.text}</p><p className="muted small">Версия данных: {entry.dataVersion}</p>
      {entry.result && <details><summary>Открыть сохранённый расчёт и исходные сведения</summary>
        <div className="year-grid">{entry.result.crops.map((crop, index) => <div className="year" key={index}><small>{entry.result.startYear + index}</small><strong>{crop}</strong></div>)}</div>
        <ScoringDetails scoring={entry.result.scoring} />
        <div className="subtle-note"><strong>Данные на момент решения</strong><p>Поле: {entry.result.inputSnapshot.name}. Площадь: {entry.result.inputSnapshot.areaHa ?? 'не указана'} га. Бюджет: {entry.result.inputSnapshot.budget ?? 'не указан'} ₸.</p>
          <p>История: {entry.result.inputSnapshot.history.map(row => `${row.year} — ${row.crop}`).join('; ') || 'нет записей'}.</p>
          <p>Наблюдения: {entry.result.inputSnapshot.observations || 'нет записей'}.</p>
          <p>NASA: {entry.result.inputSnapshot.climate?.source || 'не загружена'}; последний сезон {entry.result.inputSnapshot.climate?.latestYear || 'не указан'}.</p>
          <p>Версия правил: {entry.result.ruleVersion}.</p>
        </div>
      </details>}
    </div>)}
    <p className="muted small">План — намерение, а не фактическая история посевов.</p>
  </section>
}
