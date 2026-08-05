import { toZodInputSchema } from '../../src/tools/json-schema-to-zod';

describe('toZodInputSchema', () => {
  it('converts an empty object schema', () => {
    const schema = toZodInputSchema({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });

    expect(schema.parse({})).toEqual({});
    expect(() => schema.parse({ extra: true })).toThrow();
  });

  it('converts optional and required fields', () => {
    const schema = toZodInputSchema({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        search: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    });

    expect(schema.parse({ id: 1 })).toEqual({ id: 1 });
    expect(() => schema.parse({})).toThrow();
  });
});
