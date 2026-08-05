import { z } from 'zod';

type JsonSchemaProperty = {
  type?: string;
};

export function toZodInputSchema(schema: Record<string, unknown>): z.ZodTypeAny {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchemaProperty>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const shape: z.ZodRawShape = {};

  for (const [key, property] of Object.entries(properties)) {
    let field: z.ZodTypeAny;

    switch (property.type) {
      case 'integer':
        field = z.number().int();
        break;
      case 'string':
        field = z.string();
        break;
      default:
        field = z.unknown();
    }

    shape[key] = required.has(key) ? field : field.optional();
  }

  const objectSchema = z.object(shape);

  if (schema.additionalProperties === false) {
    return objectSchema.strict();
  }

  return objectSchema;
}
