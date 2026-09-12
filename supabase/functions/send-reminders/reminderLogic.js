// Extrait heure/minute/date locales via Intl.formatToParts — contrat garanti
// par la spec ECMAScript, contrairement à un aller-retour toLocaleString/Date.
export function localParts(timezone, now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutesOfDay: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

const WINDOW_MINUTES = 5;

export function isDueNow(target, timezone, now, windowMinutes = WINDOW_MINUTES) {
  if (!target) return false;
  const [th, tm] = target.split(":").map(Number);
  const { minutesOfDay } = localParts(timezone, now);
  const diff = minutesOfDay - (th * 60 + tm);
  return diff >= 0 && diff < windowMinutes;
}
