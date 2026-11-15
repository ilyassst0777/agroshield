import {STATUS_LABELS} from './qualitativeEngine.js'
import {SOURCES} from './rotationEngine.js'
export default function AssessmentDetails({option}){
 const a=option.assessment
 return <div className="assessment">{STATUS_LABELS[a.status]&&<p><strong>{STATUS_LABELS[a.status]}</strong></p>}
 {a.explanation&&<div className="written-explanation"><h3>{a.explanation.title}</h3>{a.explanation.paragraphs.map((text,i)=><p key={i}>{text}</p>)}<strong>Сравнение с альтернативами</strong><p>{a.explanation.comparison}</p><details><summary>Источники о механизмах</summary>{a.explanation.sourceIds.map(id=>SOURCES[id]&&<p key={id}><a href={SOURCES[id].url} target="_blank" rel="noreferrer">{SOURCES[id].label} ↗</a></p>)}</details></div>}
 {a.blocked.length>0&&<div role="alert"><strong>Почему не подходит по заданным условиям</strong>{a.blocked.map(t=><p key={t}>{t}</p>)}</div>}
 {a.strengths.length>0&&<div><strong>Что подходит</strong>{a.strengths.map(t=><p key={t}>{t}</p>)}</div>}
 {a.risks.length>0&&<div><strong>Что вызывает сомнения</strong>{a.risks.map(t=><p key={t}>{t}</p>)}</div>}
 <details><summary>Обоснование по данным поля</summary>{a.rows.map(row=><div key={row.label}><strong>{row.label} · {row.state}</strong><p>{row.detail}</p></div>)}
 {a.pending.length>0&&<><strong>Неполные проверки</strong>{a.pending.map(t=><p key={t}>{t}</p>)}</>}
 </details><p className="muted small">Предварительный вариант по доступным данным.</p></div>
}
