// A schedule the POST STATES as a requirement, converted to the applicant's
// local time. extractAsks() only catches "to apply, send..." lists and
// sentences ending in "?", so a starred hard requirement like
// "*Must be available during 9:00am-5:00pm MST" was invisible to the writer,
// and the application answered it with "open to a full-time schedule", which
// answers nothing and leaves the employer to do the timezone math themselves.

const PH_TZ = 'Asia/Manila';
const PH_OFFSET_MIN = 8 * 60;

// Abbreviations mapped to IANA zones so the offset is correct for the date,
// daylight saving included. Posts routinely write "MST" when they mean
// Mountain Time in September, which is actually MDT (UTC-6), an hour off.
const ZONES: Record<string, string> = {
  et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York', eastern: 'America/New_York',
  ct: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago', central: 'America/Chicago',
  mt: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver', mountain: 'America/Denver',
  pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pacific: 'America/Los_Angeles',
  akst: 'America/Anchorage', akdt: 'America/Anchorage',
  aest: 'Australia/Sydney', aedt: 'Australia/Sydney', awst: 'Australia/Perth',
  nzst: 'Pacific/Auckland', nzdt: 'Pacific/Auckland',
  gmt: 'Europe/London', bst: 'Europe/London',
  cet: 'Europe/Berlin', cest: 'Europe/Berlin', eet: 'Europe/Athens',
  utc: 'UTC',
};

// "9AM-5PM MST", "9:00am - 5:00pm (EST)", "8 to 4 PST", "09:00-17:00 CET".
const RANGE =
  /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|\bto\b|\buntil\b|\btill\b)\s*([01]?\d|2[0-3])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s*\(?\s*([a-z]{2,7})\b/gi;

export type RequiredSchedule = {
  quoted: string;      // what the post said
  localStart: string;  // "11:00 PM"
  localEnd: string;    // "7:00 AM"
  overnight: boolean;  // crosses local midnight
};

function offsetMinutes(tz: string, at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
    const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return /GMT|UTC/.test(name) ? 0 : null;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] ?? '0', 10));
  } catch {
    return null;
  }
}

function to24(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = /p/i.test(meridiem);
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function fmt(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(m % 60).padStart(2, '0');
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function detectRequiredSchedule(description: string, now: Date = new Date()): RequiredSchedule | null {
  const text = (description || '').slice(0, 12000);
  RANGE.lastIndex = 0;

  for (let m = RANGE.exec(text); m; m = RANGE.exec(text)) {
    const zone = ZONES[m[7].toLowerCase()];
    if (!zone) continue;

    const offset = offsetMinutes(zone, now);
    if (offset === null) continue;

    let startH = parseInt(m[1], 10);
    let endH = parseInt(m[4], 10);
    const startMin = parseInt(m[2] ?? '0', 10);
    const endMin = parseInt(m[5] ?? '0', 10);
    let startMer = m[3];
    let endMer = m[6];

    // "9-5 EST": a range that would otherwise run backwards is the ordinary
    // business day. With no meridiem anywhere ("9 to 5"), that means AM to PM;
    // with one only on the end, the start takes the other half.
    // A 24-hour range ("09:00-17:00") already runs forwards and is left alone.
    if (!startMer && !endMer && startH <= 12 && endH <= 12 && endH < startH) {
      startMer = 'am';
      endMer = 'pm';
    } else if (!startMer && endMer && startH >= to24(endH, endMer)) {
      startMer = /p/i.test(endMer) ? 'am' : 'pm';
    }

    startH = to24(startH, startMer);
    endH = to24(endH, endMer);

    const delta = PH_OFFSET_MIN - offset;
    const localStart = startH * 60 + startMin + delta;
    const localEnd = endH * 60 + endMin + delta;

    return {
      quoted: m[0].replace(/\s+/g, ' ').trim(),
      localStart: fmt(localStart),
      localEnd: fmt(localEnd),
      overnight: Math.floor(localStart / 1440) !== Math.floor((localEnd - 1) / 1440),
    };
  }
  return null;
}

// Does the reply actually answer the hours, or just gesture at them?
// "open to a full-time schedule" contains "full-time" and commits to nothing.
export function answersSchedule(reply: string): boolean {
  const body = (reply || '').toLowerCase();
  return /\d\s*(?::\d{2}\s*)?(?:a\.?m\.?|p\.?m\.?)|\bovernight\b|\bgraveyard\b|\bnight shift\b|\b\d{1,2}\s*(?:-|–|to)\s*\d{1,2}\b/.test(body);
}

export function scheduleBlock(s: RequiredSchedule | null, location?: string): string {
  if (!s) return '';
  // Always converted to Philippine time, so the label never needs the profile.
  const where = location?.trim() || "the applicant's local time (Philippines, UTC+8)";
  return `THE POST STATES A REQUIRED WORKING SCHEDULE: "${s.quoted}".
In ${where} that is ${s.localStart} to ${s.localEnd}${s.overnight ? ', overnight, starting the night before' : ''}.
This is the first thing this employer filters on, so answer it in the first two sentences, in the applicant's own local hours, and state plainly that this is the day they will work. Those converted hours are a fact: use them exactly as given here, never recompute them.
Do NOT write "open to a full-time schedule", "flexible with hours", or anything else that leaves the employer to do the math. Do NOT state where the applicant lives without the hours attached: on this board every applicant is in the Philippines, so the location alone tells them nothing and reads as filler.`;
}
