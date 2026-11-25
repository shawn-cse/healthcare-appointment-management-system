import { env } from '../config/env.js';

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a @db.Date value (UTC midnight Date) to YYYY-MM-DD */
export function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD into a UTC-midnight Date suitable for Prisma @db.Date */
export function parseIsoDate(str: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, day, 0, 0, 0, 0));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/** Format a @db.Time value (1970-01-01THH:MM:SS.000Z) to HH:MM */
export function timeToHm(t: Date): string {
  return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** Format a @db.Time value to 12-hour e.g. 6:00 PM */
export function timeTo12h(t: Date): string {
  const h24 = t.getUTCHours();
  const min = t.getUTCMinutes();
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad2(min)} ${period}`;
}

/** Parse 24h ("18:00", "18:00:00") or 12h ("09:30 AM", "01:30 PM") into @db.Time Date */
export function parseTimeStr(raw: string): Date | null {
  const s = raw.trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(am|pm)?$/i.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  const period = m[4]?.toUpperCase();

  if (min < 0 || min > 59 || sec < 0 || sec > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return new Date(Date.UTC(1970, 0, 1, hour, min, sec, 0));
}

/** Current local date string (YYYY-MM-DD) in configured hospital timeZone */
export function localDateIso(now = new Date(), timeZone = env.timeZone): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Current local Date (at UTC midnight) representing today in hospital timeZone */
export function localTodayDate(now = new Date(), timeZone = env.timeZone): Date {
  return parseIsoDate(localDateIso(now, timeZone))!;
}

/** Add signed days to a YYYY-MM-DD or @db.Date UTC-midnight Date */
export function addDaysDate(base: Date | string, days: number): Date {
  const d = typeof base === 'string' ? parseIsoDate(base)! : new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Convert JS Date.getUTCDay() (0=Sun..6=Sat) to Python/Django weekday (0=Mon..6=Sun) */
export function pythonWeekday(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** Compute timezone offset in milliseconds for a UTC date in an IANA timeZone */
function getTimeZoneOffsetMs(utcDate: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(utcDate);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const h = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, h, map.minute, map.second);
  return asUtc - utcDate.getTime();
}

/** Combine @db.Date and @db.Time in hospital timeZone into exact UTC Date */
export function localStartUtc(slotDate: Date, startTime: Date, timeZone = env.timeZone): Date {
  const y = slotDate.getUTCFullYear();
  const m = slotDate.getUTCMonth();
  const d = slotDate.getUTCDate();
  const hh = startTime.getUTCHours();
  const mm = startTime.getUTCMinutes();
  const ss = startTime.getUTCSeconds();

  const guess = new Date(Date.UTC(y, m, d, hh, mm, ss));
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset);
}
