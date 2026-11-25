/** Business-hours check in the org's timezone. Pure. */
export type BusinessHours = { days: number[]; start: string; end: string };

export function isWithinBusinessHours(hours: BusinessHours, timezone: string, now = Date.now()): boolean {
  let weekday: string, hh: string, mm: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(now));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    weekday = get("weekday"); hh = get("hour"); mm = get("minute");
  } catch {
    return false; // invalid timezone: treat as closed
  }
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  if (!hours.days.includes(day)) return false;
  const cur = `${hh}:${mm}`;
  return cur >= hours.start && cur < hours.end;
}
