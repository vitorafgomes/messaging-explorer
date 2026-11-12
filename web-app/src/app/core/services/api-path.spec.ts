import { apiPath } from './api-path';

describe('apiPath', () => {
  it('percent-encodes every interpolated value and leaves the literal parts alone', () => {
    const name = 'a/b?c#d e';
    const sub = 's/2';

    expect(apiPath`topics/${name}/subscriptions/${sub}/messages?count=${10}`)
      .toBe('topics/a%2Fb%3Fc%23d%20e/subscriptions/s%2F2/messages?count=10');
  });

  it('turns a name with / into one segment, so deleting the queue a/messages cannot reach the purge route of a', () => {
    expect(apiPath`queues/${'a/messages'}`).toBe('queues/a%2Fmessages');
  });

  it('keeps # and ? inside the segment, so purging orders#1 never becomes a request for the queue orders', () => {
    expect(apiPath`queues/${'orders#1'}/messages`).toBe('queues/orders%231/messages');
    expect(apiPath`queues/${'what?now'}/messages`).toBe('queues/what%3Fnow/messages');
  });

  it('encodes a value exactly once', () => {
    expect(apiPath`queues/${'50%off'}`).toBe('queues/50%25off');
    expect(apiPath`queues/${'a%2Fb'}`).toBe('queues/a%252Fb');
  });

  it('leaves names made only of unreserved characters unchanged', () => {
    expect(apiPath`queues/${'a.b-c_d~e'}`).toBe('queues/a.b-c_d~e');
  });

  it('writes numbers as their digits', () => {
    expect(apiPath`queues/${'q'}/deadletter/${42}/resubmit`).toBe('queues/q/deadletter/42/resubmit');
  });

  it('throws on an undefined value instead of writing the text undefined into the URL', () => {
    const name: string | undefined = undefined;

    expect(() => apiPath`queues/${name}/messages`).toThrowError(/^apiPath: value 0 of .* is undefined$/);
  });

  it('throws on a null value instead of writing the text null into the URL', () => {
    const name: string | null = null;

    expect(() => apiPath`queues/${name}/messages`).toThrowError(/^apiPath: value 0 of .* is null$/);
  });
});
