import { durationInput, durationSeconds, inputSeconds, toTimeSpan } from './duration';

describe('durations survive the round trip form -> wire -> form', () => {
  it.each([
    [{ amount: 45, unit: 'seconds' }, '00:00:45'],
    [{ amount: 30, unit: 'minutes' }, '00:30:00'],
    [{ amount: 14, unit: 'days' }, '14.00:00:00'],
    [{ amount: 93784, unit: 'seconds' }, '1.02:03:04']
  ] as const)('%o goes on the wire as the TimeSpan %s and comes back as the same form value', (form, wire) => {
    const seconds = inputSeconds(form);
    expect(seconds).not.toBeNull();

    expect(toTimeSpan(seconds!)).toBe(wire);
    expect(durationInput(wire)).toStrictEqual(form);
  });

  it('1 d 2 h 3 m 4 s read from the API is 93784 seconds and is written back unchanged', () => {
    expect(durationSeconds('1.02:03:04')).toBe(93784);
    expect(toTimeSpan(93784)).toBe('1.02:03:04');
  });

  it('fractional seconds keep their milliseconds on the wire', () => {
    expect(durationSeconds('1.02:03:04.5000000')).toBe(93784.5);
    expect(toTimeSpan(93784.5)).toBe('1.02:03:04.5000000');
  });

  it('an absent duration and the max TimeSpan (never) have no form value', () => {
    expect(durationSeconds(undefined)).toBeNull();
    expect(durationSeconds('10675199.02:48:05.4775807')).toBeNull();
    expect(durationInput('10675199.02:48:05.4775807')).toStrictEqual({ amount: null, unit: 'minutes' });
  });

  it('an empty amount is no value, not zero', () => {
    expect(inputSeconds({ amount: null, unit: 'days' })).toBeNull();
  });
});
