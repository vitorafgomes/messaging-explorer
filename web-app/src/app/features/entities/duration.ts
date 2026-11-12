/** Days in TimeSpan.MaxValue, which .NET uses for "never" on a TTL or an auto-delete. */
export const MAX_TIMESPAN_DAYS = 10675199;

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export const DURATION_UNITS: readonly DurationUnit[] = ['seconds', 'minutes', 'hours', 'days'];

const UNIT_SECONDS: Record<DurationUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };

/** A duration as the form holds it: an amount and its unit; an empty amount is no value. */
export interface DurationInput {
  amount: number | null;
  unit: DurationUnit;
}

/**
 * Reads a .NET TimeSpan string (`hh:mm:ss`, `d.hh:mm:ss`, with an optional fraction) or an
 * ISO 8601 duration (`P10DT12H30M15.500S`) into its parts.
 */
export function parseDuration(durationString: string): DurationParts {
  const result = { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };

  if (!durationString || durationString === '00:00:00') {
    return result;
  }

  const iso8601Match = durationString.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (iso8601Match) {
    result.days = parseInt(iso8601Match[1] || '0', 10);
    result.hours = parseInt(iso8601Match[2] || '0', 10);
    result.minutes = parseInt(iso8601Match[3] || '0', 10);
    const seconds = parseFloat(iso8601Match[4] || '0');
    result.seconds = Math.floor(seconds);
    result.milliseconds = Math.round((seconds - result.seconds) * 1000);
    return result;
  }

  const parts = durationString.split('.');
  if (parts.length >= 2) {
    if (parts[0].includes(':')) {
      const timeParts = parts[0].split(':');
      result.hours = parseInt(timeParts[0] || '0', 10);
      result.minutes = parseInt(timeParts[1] || '0', 10);
      result.seconds = parseInt(timeParts[2] || '0', 10);
      if (parts[1]) {
        result.milliseconds = parseInt(parts[1].substring(0, 3).padEnd(3, '0'), 10);
      }
    } else {
      result.days = parseInt(parts[0], 10);
      const timeParts = parts[1].split(':');
      result.hours = parseInt(timeParts[0] || '0', 10);
      result.minutes = parseInt(timeParts[1] || '0', 10);
      result.seconds = parseInt(timeParts[2] || '0', 10);
      if (parts[2]) {
        result.milliseconds = parseInt(parts[2].substring(0, 3).padEnd(3, '0'), 10);
      }
    }
  } else if (parts[0].includes(':')) {
    const timeParts = parts[0].split(':');
    result.hours = parseInt(timeParts[0] || '0', 10);
    result.minutes = parseInt(timeParts[1] || '0', 10);
    result.seconds = parseInt(timeParts[2] || '0', 10);
  }

  return result;
}

/** True for the TimeSpan .NET uses for "never". */
export function isNever(durationString: string | null | undefined): boolean {
  return !!durationString && parseDuration(durationString).days >= MAX_TIMESPAN_DAYS;
}

/** Total seconds of a TimeSpan string; null when it is absent or "never". */
export function durationSeconds(durationString: string | null | undefined): number | null {
  if (!durationString || isNever(durationString)) return null;
  const d = parseDuration(durationString);
  return d.days * 86400 + d.hours * 3600 + d.minutes * 60 + d.seconds + d.milliseconds / 1000;
}

/** The form value of a TimeSpan string, in the largest unit that holds it whole. */
export function durationInput(durationString: string | null | undefined): DurationInput {
  const seconds = durationSeconds(durationString);
  if (seconds === null) return { amount: null, unit: 'minutes' };
  const unit = [...DURATION_UNITS].reverse().find(u => seconds % UNIT_SECONDS[u] === 0) ?? 'seconds';
  return { amount: seconds / UNIT_SECONDS[unit], unit };
}

/** Total seconds of a form value; null when the amount is empty. */
export function inputSeconds(input: DurationInput): number | null {
  if (input.amount === null || input.amount === undefined || (input.amount as unknown) === '') return null;
  return Number(input.amount) * UNIT_SECONDS[input.unit];
}

/** The TimeSpan string the API reads: `hh:mm:ss` or `d.hh:mm:ss`, with seven fraction digits when needed. */
export function toTimeSpan(totalSeconds: number): string {
  const totalMs = Math.round(totalSeconds * 1000);
  const days = Math.floor(totalMs / 86400000);
  const hours = Math.floor(totalMs / 3600000) % 24;
  const minutes = Math.floor(totalMs / 60000) % 60;
  const seconds = Math.floor(totalMs / 1000) % 60;
  const ms = totalMs % 1000;
  const two = (n: number) => String(n).padStart(2, '0');
  const time = `${two(hours)}:${two(minutes)}:${two(seconds)}${ms ? '.' + String(ms).padStart(3, '0') + '0000' : ''}`;
  return days ? `${days}.${time}` : time;
}

/** A duration in words for a summary: "5 minutes", "1 day"; null is "Not set". */
export function describeSeconds(seconds: number | null): string {
  if (seconds === null) return 'Not set';
  const { amount, unit } = durationInput(toTimeSpan(seconds));
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
}
