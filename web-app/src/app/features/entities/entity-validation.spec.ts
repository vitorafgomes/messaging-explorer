import { fieldError, forwardTargetError, nameError } from './entity-validation';

describe('entity validation mirrors the limits of the contract and names the allowed range', () => {
  describe('names', () => {
    it('a queue or topic name: 1 to 260 letters, digits, ".", "-", "_", "/", not starting or ending with "/"', () => {
      for (const kind of ['queue', 'topic'] as const) {
        expect(nameError(kind, 'orders/retry.v2-a_b')).toBeNull();
        expect(nameError(kind, 'a'.repeat(260))).toBeNull();
        expect(nameError(kind, 'a'.repeat(261))).toBe('Use 1 to 260 letters, digits, ".", "-", "_" or "/", not starting or ending with "/".');
        expect(nameError(kind, '/orders')).toBe('Use 1 to 260 letters, digits, ".", "-", "_" or "/", not starting or ending with "/".');
        expect(nameError(kind, 'orders/')).toBe('Use 1 to 260 letters, digits, ".", "-", "_" or "/", not starting or ending with "/".');
        expect(nameError(kind, 'or ders')).toBe('Use 1 to 260 letters, digits, ".", "-", "_" or "/", not starting or ending with "/".');
        expect(nameError(kind, '')).toBe('A name is required.');
      }
    });

    it('a subscription name: 1 to 50 letters, digits, ".", "-", "_"; no "/"', () => {
      expect(nameError('subscription', 'a'.repeat(50))).toBeNull();
      expect(nameError('subscription', 'a'.repeat(51))).toBe('Use 1 to 50 letters, digits, ".", "-" or "_".');
      expect(nameError('subscription', 'a/b')).toBe('Use 1 to 50 letters, digits, ".", "-" or "_".');
    });
  });

  it.each([
    ['lockDuration', 5, 300, 4, 301, 'Lock duration must be between 5 seconds and 5 minutes.'],
    ['maxDeliveryCount', 1, 2000, 0, 2001, 'Max delivery count must be between 1 and 2000.'],
    ['duplicateDetectionHistoryTimeWindow', 20, 7 * 86400, 19, 7 * 86400 + 1, 'Duplicate detection window must be between 20 seconds and 7 days.']
  ] as const)('%s accepts %d and %d and refuses %d and %d with the range', (field, low, high, below, above, message) => {
    expect(fieldError(field, low)).toBeNull();
    expect(fieldError(field, high)).toBeNull();
    expect(fieldError(field, below)).toBe(message);
    expect(fieldError(field, above)).toBe(message);
  });

  it('message time to live is at least 1 second; auto delete on idle is at least 5 minutes', () => {
    expect(fieldError('defaultMessageTimeToLive', 1)).toBeNull();
    expect(fieldError('defaultMessageTimeToLive', 0)).toBe('Message time to live must be at least 1 second.');
    expect(fieldError('autoDeleteOnIdle', 300)).toBeNull();
    expect(fieldError('autoDeleteOnIdle', 299)).toBe('Auto delete on idle must be at least 5 minutes.');
  });

  it('max size is a positive whole number of megabytes', () => {
    expect(fieldError('maxSizeInMegabytes', 1024)).toBeNull();
    expect(fieldError('maxSizeInMegabytes', 0)).toBe('Max size must be a positive whole number of megabytes.');
    expect(fieldError('maxSizeInMegabytes', 1.5)).toBe('Max size must be a positive whole number of megabytes.');
  });

  it('a whole number field refuses a fraction', () => {
    expect(fieldError('maxDeliveryCount', 2.5)).toBe('Max delivery count must be between 1 and 2000.');
  });

  it('user metadata is at most 1024 characters', () => {
    expect(fieldError('userMetadata', 'x'.repeat(1024))).toBeNull();
    expect(fieldError('userMetadata', 'x'.repeat(1025))).toBe('User metadata must be at most 1024 characters.');
  });

  it('an empty value is not checked against a range: it means "not set"', () => {
    expect(fieldError('lockDuration', null)).toBeNull();
  });

  describe('forward targets', () => {
    const loaded = ['orders', 'orders-retry', 'events'];

    it('an existing queue or topic other than the entity is accepted; none (empty) is accepted', () => {
      expect(forwardTargetError('orders-retry', loaded, 'orders')).toBeNull();
      expect(forwardTargetError('', loaded, 'orders')).toBeNull();
    });

    it('the entity itself, or a name that is not a loaded queue or topic, is refused', () => {
      expect(forwardTargetError('orders', loaded, 'orders')).toBe('Choose a queue or topic other than this one.');
      expect(forwardTargetError('typed-by-hand', loaded, 'orders')).toBe('Choose a queue or topic other than this one.');
    });
  });
});
