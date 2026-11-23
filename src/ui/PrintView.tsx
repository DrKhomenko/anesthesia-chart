import { useLiveQuery } from 'dexie-react-hooks';
import { db, CLINIC_SETTINGS_ID, DEFAULT_CLINIC_NAME, defaultGasOf, recoveryScaleOf, type CaseRec, type DrugAdmin, type Infusion, type RegionalBlock, type VitalTick } from '../db/db';
import { SPECIES_RU, fmt, fmtTime } from '../core/logic';
import { computeTimeline, fmtDuration } from '../core/timeline';
import { buildSeries, drugTotals, niceRange, type Series } from '../core/report';
import { go, goToCaseList } from './App';
import { formatTickGas, gasColumnLabel, resolveCaseGas } from '../core/gas';
import { formatVolumeMl, infusionChangesText, infusionVolumeMl, liveInfusions, startedAtOf } from '../core/infusions';
import { formatAnestheticLine, guidanceLabel, liveBlocks, sideLabel } from '../core/regional';


const PHASE_RU: Record<string, string> = { premed: 'Премедикация', induction: 'Индукция', maintenance: 'Поддержание', recovery: 'Пробуждение', cpr: 'СЛР' };
const SEX_RU: Record<string, string> = { female: 'самка', male: 'самец', femaleSpayed: 'самка стер.', maleNeutered: 'самец кастр.' };
const YN: Record<string, string> = { yes: 'да', no: 'нет' };
const tm = (s?: string | null) => (s ? fmtTime(new Date(s)) : '—');
const v = (s?: string | number | null) => (s == null || s === '' ? '—' : String(s));
const n = (x: number | null | undefined, d = 0) => (x == null ? '—' : fmt(x, d));

export function PrintView({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const c = await db.cases.get(id);
    const admins = (await db.drugAdmins.where('caseId').equals(id).toArray()).filter(a => !a.deletedAt).sort((a, b) => a.givenAt.localeCompare(b.givenAt));
    const ticks = (await db.vitals.where('caseId').equals(id).toArray()).filter(t => !t.deletedAt).sort((a, b) => a.at.localeCompare(b.at));
    const clinic = await db.clinicSettings.get(CLINIC_SETTINGS_ID);
    const infusions = liveInfusions(await db.infusions.where('caseId').equals(id).toArray());
    const blocks = liveBlocks(await db.regionalBlocks.where('caseId').equals(id).toArray());
    return { c, admins, ticks, clinic, infusions, blocks };
  }, [id]);
  if (!data) return <div className="pdoc">Загрузка…</div>;
  if (!data.c) return <div className="pdoc">Карта не найдена. <button onClick={() => go('/')}>К списку</button></div>;
  return <div className="pdoc">
    <div className="pdoc-bar noprint">
      <button className="btn sec" onClick={() => void goToCaseList()}>Карты</button>
      <button className="btn sec" onClick={() => go(`/case/${id}/recovery`)}>← Назад</button>
      <button className="btn pri" onClick={() => window.print()}>Сохранить PDF / Печать</button>
      <span className="pdoc-hint">На iPad/iPhone: «Печать» → жест «развести двумя пальцами» на превью или «Поделиться» → «Сохранить в Файлы». Работает без интернета.</span>
    </div>
    <ChartDoc c={data.c} admins={data.admins} ticks={data.ticks} infusions={data.infusions} blocks={data.blocks} clinicName={data.clinic?.clinicName?.trim() || DEFAULT_CLINIC_NAME} scale={recoveryScaleOf(data.clinic)} defaultGas={defaultGasOf(data.clinic)} />
  </div>;
}

export function ChartDoc({ c, admins, ticks, infusions = [], blocks = [], clinicName, scale, defaultGas }: { c: CaseRec; admins: DrugAdmin[]; ticks: VitalTick[]; infusions?: Infusion[]; blocks?: RegionalBlock[]; clinicName: string; scale: string[]; defaultGas?: ReturnType<typeof defaultGasOf> }) {
  const tl = computeTimeline({ ...c, firstPremedAt: admins.find(a => a.phase === 'premed')?.givenAt ?? null });
  const ind = c.induction ?? {}; const r = c.recovery ?? {};
  const pv = c.preInductionVitals ?? {}; const bv = c.baselineVitals ?? {};
  const totals = drugTotals(admins);
  const series = buildSeries(ticks);
  const qual = r.quality ? `${r.quality}${scale[r.quality - 1] ? ` — ${scale[r.quality - 1]}` : ''}` : '—';
  const transfer = r.transferTo === 'ward' ? 'стационар' : r.transferTo === 'icu' ? 'ОРИТ' : r.transferTo === 'home' ? 'домой' : '—';
  const comps = [...(r.complications ?? []), ...(r.otherComplication?.trim() ? [r.otherComplication.trim()] : [])];
  return <div className="pdoc-page">
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <div><h1>Анестезиологическая карта № {c.number}</h1><div className="psub">{clinicName}</div></div>
      <div className="psub" style={{ textAlign: 'right' }}>{new Date(c.date).toLocaleDateString('ru-RU')}</div>
    </div>
    <h2>Пациент</h2>
    <div className="kv">
      <div><span>Кличка: </span>{v(c.patientName)}</div>
      <div><span>Вид / порода: </span>{SPECIES_RU[c.species]}{c.breed ? `, ${c.breed}` : ''}</div>
      <div><span>Пол / возраст: </span>{SEX_RU[c.sex] ?? '—'}{c.ageText ? `, ${c.ageText}` : ''}</div>
      <div><span>Вес: </span>{c.weightKg ? `${c.weightKg} кг` : '—'}</div>
      <div><span>ASA: </span>{c.asaClass ? `${c.asaClass}${c.asaEmergency ? 'E' : ''}` : '—'}</div>
      <div><span>Владелец: </span>{v(c.ownerName)}</div>
      <div><span>Диагноз: </span>{v(c.diagnosis)}</div>
      <div><span>Операция: </span>{v(c.operation)}</div>
      <div><span>Аллергии / особенности: </span>{v(c.allergiesNotes)}</div>
      <div><span>Хирург: </span>{v(c.surgeon)}</div>
      <div><span>Анестезиолог: </span>{v(c.anesthesiologist)}</div>
      <div><span>Анестезист: </span>{v(c.anesthetist)}</div>
    </div>
    <h2>Время</h2>
    <div className="kv">
      <div><span>Начало анестезии: </span>{tm(c.anesthesiaStartAt)}</div>
      <div><span>Конец анестезии: </span>{tm(c.anesthesiaEndAt)}</div>
      <div><span>Длительность: </span><b>{tl.anesthesia ? fmtDuration(tl.anesthesia.minutes) : '—'}</b></div>
      <div><span>Начало операции: </span>{tm(c.surgeryStartAt)}</div>
      <div><span>Конец операции: </span>{tm(c.surgeryEndAt)}</div>
      <div><span>Длительность: </span><b>{tl.surgery ? fmtDuration(tl.surgery.minutes) : '—'}</b></div>
    </div>
    <h2>Исходные показатели</h2>
    <table><thead><tr><th></th><th>Время</th><th>T °C</th><th>ЧСС</th><th>ЧДД</th><th>SpO₂</th><th>АД (С/Д/Ср)</th></tr></thead><tbody>
      <tr><td>Осмотр</td><td>{tm(bv.at)}</td><td className="n">{v(bv.tempC)}</td><td className="n">{v(bv.hr)}</td><td className="n">{v(bv.rr)}</td><td className="n">{v(bv.spo2)}</td><td className="n">{v(bv.sys)}/{v(bv.dia)}/{v(bv.map)}</td></tr>
      <tr><td>До индукции</td><td>{tm(pv.at)}</td><td className="n">{v(pv.tempC)}</td><td className="n">{v(pv.hr)}</td><td className="n">{v(pv.rr)}</td><td className="n">{v(pv.spo2)}</td><td className="n">{v(pv.sys)}/{v(pv.dia)}/{v(pv.map)}</td></tr>
    </tbody></table>
    <h2>Препараты</h2>
    {admins.length === 0 ? <div className="psub">Нет записей</div> :
      <table><thead><tr><th>Этап</th><th>Время</th><th>Препарат</th><th>Доза</th><th>мг</th><th>Конц.</th><th>мл</th><th>Путь</th><th>Ввёл</th></tr></thead><tbody>
        {admins.map(a => <tr key={a.id}><td>{PHASE_RU[a.phase] ?? a.phase}</td><td>{tm(a.givenAt)}</td><td>{a.drugNameSnapshot}</td>
          <td className="n">{a.doseValue ? `${a.doseValue} ${a.doseUnit === 'mcg/kg' ? 'мкг/кг' : 'мг/кг'}` : '—'}</td><td className="n">{n(a.totalMg, 3)}</td>
          <td className="n">{a.concentration != null ? `${fmt(a.concentration, 3)} ${a.concentrationUnit === 'mcg/ml' ? 'мкг/мл' : a.concentrationUnit === 'percent' ? '%' : 'мг/мл'}` : '—'}</td>
          <td className="n">{n(a.volumeMl, 2)}</td><td>{a.route}</td><td>{v(a.givenBy)}</td></tr>)}
      </tbody></table>}
    <h2>Индукция и интубация</h2>
    <div className="kv">
      <div><span>Маска: </span>{YN[ind.maskInduction ?? ''] ?? '—'}</div>
      <div><span>ЭТТ: </span>{ind.ettSizeMm ? `${ind.ettSizeMm} мм` : '—'}</div>
      <div><span>Манжета: </span>{YN[ind.cuff ?? ''] ?? '—'}</div>
      <div><span>Попыток: </span>{v(ind.attempts)}</div>
      <div><span>Интубация: </span>{tm(ind.intubatedAt)}</div>
      <div><span>Лидокаин-спрей: </span>{YN[ind.lidocaineSpray ?? ''] ?? '—'}</div>
      <div><span>Подключение к НДА: </span>{tm(ind.connectedAt)}</div>
      <div><span>ИВЛ: </span>{v(ind.ventMode)}{ind.pinsp ? ` · Pinsp ${ind.pinsp}` : ''}{ind.vt ? ` · VT ${ind.vt}` : ''}{ind.rr ? ` · ЧД ${ind.rr}` : ''}{ind.peep ? ` · PEEP ${ind.peep}` : ''}</div>
      <div><span>Газ: </span>{ind.gas ? `${ind.gas === 'sevo' ? 'Sevo' : 'Iso'} ${ind.gasPct ?? ''}%` : '—'}{ind.o2Flow ? ` · O₂ ${ind.o2Flow} л/мин` : ''}</div>
    </div>
    {ind.intubationComplications?.trim() && <div className="psub">Осложнения интубации: {ind.intubationComplications}</div>}
    {ind.notes?.trim() && <div className="psub">Заметки: {ind.notes}</div>}
    <div className="avoid">
      <h2>Тренды</h2>
      {series.length ? <TrendChart series={series} /> : <div className="psub">Нет записей показателей</div>}
    </div>
    <h2>Показатели (поддержание)</h2>
    {ticks.length === 0 ? <div className="psub">Нет записей</div> :
      <table><thead><tr><th>Время</th><th>ЧСС</th><th>SpO₂</th><th>EtCO₂</th><th>АД С/Д/Ср</th><th>T</th><th>ЧД</th><th>Режим</th><th>VT</th><th>{gasColumnLabel(ticks, resolveCaseGas({ maintenanceGas: c.maintenanceGas, inductionGas: c.induction?.gas, defaultGas }))}</th></tr></thead><tbody>
        {ticks.map(t => <tr key={t.id}><td>{tm(t.at)}</td><td className="n">{n(t.hr)}</td><td className="n">{n(t.spo2)}</td><td className="n">{n(t.etco2)}</td>
          <td className="n">{t.sys == null && t.dia == null && t.map == null ? '—' : `${n(t.sys)}/${n(t.dia)}/${n(t.map)}${t.mapManual ? ' вруч.' : ''}`}</td><td className="n">{n(t.tempC ?? t.t2, 1)}</td>
          <td className="n">{n(t.rr ?? t.rrMeas)}</td><td>{t.ventMode || '—'}</td><td className="n">{n(t.vtInsp)}</td><td className="n">{formatTickGas(t, fmt)}</td></tr>)}
      </tbody></table>}
    <h2>Инфузии</h2>
    {infusions.length === 0 ? <div className="psub">Нет записей</div> :
      <table><thead><tr><th>Раствор</th><th>Начало</th><th>Скорость / изменения</th><th>Окончание</th><th>Объём, мл</th></tr></thead><tbody>
        {infusions.map(inf => {
          const start = startedAtOf(inf);
          const endAt = inf.endedAt ?? c.anesthesiaEndAt ?? null;
          const vol = infusionVolumeMl(inf, endAt ?? new Date());
          return <tr key={inf.id}>
            <td>{inf.solutionName || '—'}</td>
            <td>{start ? tm(start) : '—'}</td>
            <td>{infusionChangesText(inf, iso => tm(iso)) || '—'}</td>
            <td>{inf.endedAt ? tm(inf.endedAt) : (c.anesthesiaEndAt ? tm(c.anesthesiaEndAt) + ' (конец анестезии)' : 'идёт')}</td>
            <td className="n">{formatVolumeMl(vol)}</td>
          </tr>;
        })}
      </tbody></table>}
    <h2>Регионарная анестезия</h2>
    {blocks.length === 0 ? <div className="psub">Нет записей</div> :
      <table><thead><tr><th>Время</th><th>Блокада</th><th>Сторона</th><th>Анестетик</th><th>Наведение</th><th>Адъювант</th><th>Примечание</th></tr></thead><tbody>
        {blocks.map(b => <tr key={b.id}>
          <td>{tm(b.at)}</td>
          <td>{b.blockName || '—'}</td>
          <td>{sideLabel(b.side)}</td>
          <td>{(b.anesthetics ?? []).length ? (b.anesthetics ?? []).map(a => formatAnestheticLine(a, c.weightKg)).join('; ') : '—'}</td>
          <td>{guidanceLabel(b.guidance)}</td>
          <td>{b.adjuvant?.trim() || '—'}</td>
          <td>{b.note?.trim() || '—'}</td>
        </tr>)}
      </tbody></table>}
    <div className="avoid">
      <h2>Пробуждение</h2>
      <div className="kv">
        <div><span>Экстубация: </span>{tm(r.extubatedAt)}</div>
        <div><span>T при экстубации: </span>{r.tempAtExtubation ? `${r.tempAtExtubation} °C` : '—'}</div>
        <div><span>Качество: </span>{qual}</div>
        <div><span>Перевод: </span>{transfer}{r.transferAt ? ` в ${tm(r.transferAt)}` : ''}</div>
        <div style={{ gridColumn: 'span 2' }}><span>Осложнения: </span>{comps.length ? comps.join(', ') : 'не отмечены'}</div>
      </div>
      {r.notes?.trim() && <div className="psub">Заметки: {r.notes}</div>}
    </div>
    <div className="avoid">
      <h2>Итого по препаратам</h2>
      {totals.length === 0 ? <div className="psub">—</div> :
        <table><thead><tr><th>Препарат</th><th>Введений</th><th>Всего, мг</th><th>Всего, мл</th></tr></thead><tbody>
          {totals.map(t => <tr key={t.name}><td>{t.name}</td><td className="n">{t.count}</td><td className="n">{n(t.totalMg, 3)}</td><td className="n">{n(t.totalMl, 2)}</td></tr>)}
        </tbody></table>}
      <div className="sign">
        <span>Анестезиолог: <b>{r.signedBy || c.anesthesiologist || '________________'}</b>{r.signedAt ? ` · подписано ${new Date(r.signedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span>
        <span>Подпись: ____________</span>
      </div>
    </div>
  </div>;
}

const COLORS: Record<string, { c: string; dash?: string }> = {
  hr: { c: '#d0021b' }, spo2: { c: '#1f6feb' }, etco2: { c: '#1a7f37', dash: '6 3' },
  sys: { c: '#000', dash: '2 2' }, dia: { c: '#555', dash: '2 2' }, map: { c: '#000' }, temp: { c: '#b35900' },
};

export function TrendChart({ series }: { series: Series[] }) {
  const main = series.filter(s => s.key !== 'temp');
  const temp = series.find(s => s.key === 'temp');
  const all = series.flatMap(s => s.points.map(p => p.t));
  const t0 = Math.min(...all), t1 = Math.max(...all, t0 + 60_000);
  return <div>
    {main.length > 0 && <Plot series={main} t0={t0} t1={t1} range={niceRange(main.flatMap(s => s.points.map(p => p.v)), 20, true)} h={190} />}
    {temp && <Plot series={[temp]} t0={t0} t1={t1} range={niceRange(temp.points.map(p => p.v), 0.5)} h={80} />}
  </div>;
}

function Plot({ series, t0, t1, range, h }: { series: Series[]; t0: number; t1: number; range: [number, number]; h: number }) {
  const W = 720, L = 38, R = 8, T = 8, B = 18;
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (val: number) => T + (1 - (val - range[0]) / (range[1] - range[0])) * (h - T - B);
  const yTicks = 4; const ticksY = Array.from({ length: yTicks + 1 }, (_, i) => range[0] + (i * (range[1] - range[0])) / yTicks);
  const stepMs = pickStep(t1 - t0);
  const ticksX: number[] = []; for (let t = Math.ceil(t0 / stepMs) * stepMs; t <= t1; t += stepMs) ticksX.push(t);
  return <svg viewBox={`0 0 ${W} ${h + 16}`} role="img" aria-label="Тренды">
    {ticksY.map(v0 => <g key={v0}><line x1={L} x2={W - R} y1={y(v0)} y2={y(v0)} stroke="#ddd" strokeWidth={0.7} />
      <text x={L - 4} y={y(v0) + 3} fontSize={9} textAnchor="end">{fmt(v0, range[1] - range[0] < 5 ? 1 : 0)}</text></g>)}
    {ticksX.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={T} y2={h - B} stroke="#eee" strokeWidth={0.7} />
      <text x={x(t)} y={h - 6} fontSize={9} textAnchor="middle">{fmtTime(new Date(t))}</text></g>)}
    {series.map(s => { const st = COLORS[s.key] ?? { c: '#000' };
      return <g key={s.key}>
        <polyline fill="none" stroke={st.c} strokeWidth={1.6} strokeDasharray={st.dash} points={s.points.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />
        {s.points.map(p => <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r={1.8} fill={st.c} />)}
      </g>; })}
    {series.map((s, i) => { const st = COLORS[s.key] ?? { c: '#000' };
      return <g key={`l${s.key}`} transform={`translate(${L + i * 78},${h + 8})`}>
        <line x1={0} x2={16} y1={0} y2={0} stroke={st.c} strokeWidth={2} strokeDasharray={st.dash} /><text x={20} y={3} fontSize={9.5}>{s.label}</text></g>; })}
  </svg>;
}
function pickStep(ms: number) {
  const min = ms / 60_000;
  for (const s of [5, 10, 15, 30, 60, 120]) if (min / s <= 10) return s * 60_000;
  return 240 * 60_000;
}
