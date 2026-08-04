export type AlpacaCalendarDay = {
  date?: string;
  close?: string;
};

function dateOffset(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousWeekday(value: string) {
  let date = dateOffset(value, -1);
  while ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) {
    date = dateOffset(date, -1);
  }
  return date;
}

export function newYorkDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function newYorkMinutes(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function sessionCloseMinutes(session: AlpacaCalendarDay) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(session.close ?? ""));
  if (!match) return 16 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Select the latest fully closed regular US equity session.
 * Alpaca's calendar exposes the current session even before its close, so
 * today's date is only eligible after that session's regular close time.
 */
export function latestClosedUsSession(
  calendar: AlpacaCalendarDay[],
  now = new Date(),
) {
  const today = newYorkDate(now);
  const dates = calendar
    .map((item) => String(item.date ?? ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today)
    .sort();
  const todaySession = calendar.find((item) => String(item.date ?? "") === today);
  if (todaySession && newYorkMinutes(now) >= sessionCloseMinutes(todaySession)) {
    return today;
  }
  return dates.filter((date) => date < today).at(-1) ?? previousWeekday(today);
}
