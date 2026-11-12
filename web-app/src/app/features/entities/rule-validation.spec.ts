import { RuleDraft, emptyDraft, ruleErrors } from './rule-validation';

describe('a subscription rule is checked against the contract, each error naming the limit', () => {
  const sql = (patch: Partial<RuleDraft> = {}): RuleDraft => ({ ...emptyDraft(), name: 'physical-goods', filterType: 'Sql', sqlExpression: 'total > 0', ...patch });
  const correlation = (patch: Partial<RuleDraft> = {}): RuleDraft => ({ ...emptyDraft(), name: 'uk-orders', filterType: 'Correlation', ...patch });

  it('a valid SQL rule, a correlation rule with one field, and True and False with only a name have no error', () => {
    expect(ruleErrors(sql())).toStrictEqual({});
    expect(ruleErrors(correlation({ correlation: { ...emptyDraft().correlation, subject: 'order.created' } }))).toStrictEqual({});
    expect(ruleErrors({ ...emptyDraft(), name: 'all', filterType: 'True' })).toStrictEqual({});
    expect(ruleErrors({ ...emptyDraft(), name: 'none', filterType: 'False' })).toStrictEqual({});
  });

  describe('name: 1 to 50 letters, digits, ".", "-", "_", plus the reserved $Default', () => {
    const rule = 'Use 1 to 50 letters, digits, ".", "-" or "_"; $Default is the only name with "$".';

    it('empty is required; 51 characters, a space, a slash or another $ name are refused', () => {
      expect(ruleErrors(sql({ name: '' }))['name']).toBe('A name is required.');
      for (const name of ['a'.repeat(51), 'uk orders', 'uk/orders', '$Other', 'Default$']) {
        expect(ruleErrors(sql({ name }))['name'], name).toBe(rule);
      }
    });

    it('50 characters, dots, dashes, underscores and $Default are accepted', () => {
      for (const name of ['a'.repeat(50), 'eu.orders-v2_b', '$Default']) {
        expect(ruleErrors(sql({ name }))['name'], name).toBeUndefined();
      }
    });
  });

  describe('SQL filter: 1 to 1024 characters; action: at most 1024, with any filter', () => {
    it('an empty SQL expression is required and 1025 characters are too many; 1024 pass', () => {
      expect(ruleErrors(sql({ sqlExpression: '' }))['sqlExpression']).toBe('A SQL filter needs an expression.');
      expect(ruleErrors(sql({ sqlExpression: 'x'.repeat(1025) }))['sqlExpression']).toBe('The SQL filter must be at most 1024 characters.');
      expect(ruleErrors(sql({ sqlExpression: 'x'.repeat(1024) }))['sqlExpression']).toBeUndefined();
    });

    it('an action of 1025 characters is refused on a SQL and on a True rule; an empty action is no action', () => {
      expect(ruleErrors(sql({ sqlAction: 'x'.repeat(1025) }))['sqlAction']).toBe('The action must be at most 1024 characters.');
      expect(ruleErrors({ ...emptyDraft(), name: 'all', filterType: 'True', sqlAction: 'x'.repeat(1025) })['sqlAction'])
        .toBe('The action must be at most 1024 characters.');
      expect(ruleErrors(sql({ sqlAction: '' }))).toStrictEqual({});
    });

    it('the SQL expression of another filter kind is not checked, because it is not sent', () => {
      expect(ruleErrors(correlation({ sqlExpression: '', correlation: { ...emptyDraft().correlation, to: 'billing' } }))).toStrictEqual({});
    });
  });

  describe('correlation filter', () => {
    it('with no field and no property set it says a correlation filter needs at least one', () => {
      expect(ruleErrors(correlation())).toStrictEqual({ correlation: 'A correlation filter needs at least one field or property.' });
    });

    it('a system field of 129 characters is refused, naming the field; 128 pass', () => {
      const long = { ...emptyDraft().correlation, replyToSessionId: 'x'.repeat(129) };
      expect(ruleErrors(correlation({ correlation: long }))).toStrictEqual({ 'correlation.replyToSessionId': 'Reply to session id must be at most 128 characters.' });
      expect(ruleErrors(correlation({ correlation: { ...long, replyToSessionId: 'x'.repeat(128) } }))).toStrictEqual({});
    });

    it('a property name is required, at most 128 characters, and unique in the list', () => {
      const errors = ruleErrors(correlation({
        properties: [
          { name: '', type: 'String', value: 'a' },
          { name: 'p'.repeat(129), type: 'String', value: 'a' },
          { name: 'tenant', type: 'String', value: 'contoso-uk' },
          { name: 'tenant', type: 'String', value: 'contoso-eu' }
        ]
      }));

      expect(errors).toStrictEqual({
        'properties.0.name': 'A property name is required.',
        'properties.1.name': 'A property name must be at most 128 characters.',
        'properties.2.name': 'Another property has this name.',
        'properties.3.name': 'Another property has this name.'
      });
    });

    it('a value that does not parse as its type is an error naming the type', () => {
      const values: [string, string, string | undefined][] = [
        ['Int64', '3', undefined],
        ['Int64', '-9223372036854775808', undefined],
        ['Int64', '9223372036854775807', undefined],
        ['Int64', '9223372036854775808', 'An Int64 is a whole number from -9223372036854775808 to 9223372036854775807.'],
        ['Int64', '3.5', 'An Int64 is a whole number from -9223372036854775808 to 9223372036854775807.'],
        ['Int64', '1e3', 'An Int64 is a whole number from -9223372036854775808 to 9223372036854775807.'],
        ['Int64', '', 'An Int64 is a whole number from -9223372036854775808 to 9223372036854775807.'],
        ['Double', '2.5', undefined],
        ['Double', '-1E+20', undefined],
        ['Double', 'abc', 'A Double is a number such as 2.5 or -1E+20.'],
        ['Double', '', 'A Double is a number such as 2.5 or -1E+20.'],
        ['Boolean', 'true', undefined],
        ['Boolean', 'false', undefined],
        ['Boolean', 'yes', 'A Boolean is true or false.'],
        ['Boolean', 'True', 'A Boolean is true or false.'],
        ['String', '', undefined],
        ['String', 'anything at all', undefined]
      ];
      for (const [type, value, expected] of values) {
        const errors = ruleErrors(correlation({ properties: [{ name: 'p', type: type as never, value }] }));
        expect(errors['properties.0.value'], `${type} ${JSON.stringify(value)}`).toBe(expected);
      }
    });

    it('the correlation fields of another filter kind are not checked, because they are not sent', () => {
      expect(ruleErrors(sql({ properties: [{ name: '', type: 'Int64', value: 'x' }] }))).toStrictEqual({});
    });
  });
});
