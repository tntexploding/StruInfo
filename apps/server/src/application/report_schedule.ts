import type {ReportSchedule} from './research_contract.js';

export function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    date: `${String(p.year)}-${String(p.month)}-${String(p.day)}`,
    time: `${String(p.hour)}:${String(p.minute)}`,
  };
}
export function validTimeZone(zone: string) {
  try {
    localParts(new Date(0), zone);
    return true;
  } catch {
    return false;
  }
}
export function zonedTime(
  date: string,
  time: string,
  zone: string,
): Date | undefined {
  const wall = Date.parse(date + 'T' + time + ':00Z');
  let utc = wall;
  for (let i = 0; i < 4; i++) {
    const p = localParts(new Date(utc), zone);
    const offset = Date.parse(p.date + 'T' + p.time + ':00Z') - utc;
    utc = wall - offset;
  }
  const p = localParts(new Date(utc), zone);
  return p.date === date && p.time === time ? new Date(utc) : undefined;
}
/** One latest due slot. DST gaps are skipped; repeated wall times have one slot ID. */
export function latestReportSlot(s: ReportSchedule, now: Date) {
  const today = localParts(now, s.timeZone).date;
  for (let days = 0; days < 40; days++) {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    if (s.cadence === 'weekly' && d.getUTCDay() !== 1) continue;
    if (s.cadence === 'monthly' && d.getUTCDate() !== 1) continue;
    const date = d.toISOString().slice(0, 10),
      due = zonedTime(date, s.localTime, s.timeZone);
    if (!due || due > now) continue;
    d.setUTCDate(d.getUTCDate() - 1);
    return {
      key: date + 'T' + s.localTime,
      due,
      reportDate: d.toISOString().slice(0, 10),
    };
  }
  return undefined;
}
export function inQuietHours(at: Date, zone: string, from: string, to: string) {
  const t = localParts(at, zone).time;
  return from === to
    ? false
    : from < to
      ? t >= from && t < to
      : t >= from || t < to;
}
