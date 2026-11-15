import { CRITERIA } from './scoringEngine.js'

export default function ScoringDetails({scoring}) {
  if (!scoring) return null
  return <div className="info-card" style={{marginTop:16}}>
    <h3>Как рассчитан выбор</h3>
    <p><strong>{scoring.score === null ? 'Недостаточно данных' : `${scoring.score} / 100`}</strong> · рассчитано критериев {scoring.coverage}/{scoring.criteriaCount || Object.keys(scoring.dimensions).length}</p>
    <p className="subtle-note">Учтено {scoring.usedWeight ?? '—'}% суммарного веса. Пропуски не означают нулевой риск. Версия правил: {scoring.ruleVersion || 'прежняя'}.</p>
    <p className="muted small">Баллы — прозрачная эвристика прототипа, а не вероятность урожая и не коэффициенты FAO/ROTAT.</p>
    <div className="table-scroll"><table>
      <thead><tr><th>Критерий</th><th>Вес</th><th>Оценка</th></tr></thead>
      <tbody>{Object.entries(scoring.dimensions).map(([id,d])=><tr key={id}>
        <td>{CRITERIA[id]}</td><td>{scoring.weights[id]}%</td><td>{d.score===null?'Не оценён':`${d.score}/100`}</td>
      </tr>)}</tbody>
    </table></div>
    {Object.entries(scoring.dimensions).map(([id,d])=><details key={id} style={{marginTop:9}}>
      <summary>{CRITERIA[id]} — {d.score===null?'нет данных':d.score+' баллов'}</summary>
      {d.notes.map((note,i)=><p className="small" key={i}>· {note}</p>)}
    </details>)}
    {scoring.limitations.length>0&&<div className="subtle-note"><strong>Что ещё нужно проверить</strong>{scoring.limitations.map((line,i)=><p key={i}>· {line}</p>)}</div>}
    <p className="muted small">{scoring.method}</p>
  </div>
}
