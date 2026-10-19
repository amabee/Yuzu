import { z } from "zod";
import { apiEndpoints, type ApiEndpoint } from "./api-registry";
import { TOKEN_RATE_PER_MINUTE } from "./api-token-contract";

type JsonSchema = Record<string, unknown> & {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
};

export const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
    target: "openapi-3.0",
  }) as JsonSchema;

/** One row per field: name, type, whether it's required, and its notes. */
export function fieldsOf(schema: z.ZodType | undefined) {
  if (!schema) return [];
  const json = jsonSchema(schema);
  // Unions (e.g. "edit" or "delete") list each variant's fields once.
  const variants = (json.oneOf ?? json.anyOf ?? [json]) as JsonSchema[];
  const seen = new Map<
    string,
    { name: string; type: string; required: boolean; notes: string }
  >();
  for (const variant of variants)
    for (const [name, field] of Object.entries(variant.properties ?? {}))
      if (!seen.has(name))
        seen.set(name, {
          name,
          type: describeType(field),
          required:
            variants.length === 1 && Boolean(variant.required?.includes(name)),
          notes: field.description ?? constraints(field),
        });
  // Required fields first, otherwise in schema order.
  return [...seen.values()].sort(
    (a, b) => Number(b.required) - Number(a.required),
  );
}

function describeType(field: JsonSchema): string {
  if (Array.isArray(field.enum))
    return field.enum.map((value) => JSON.stringify(value)).join(" | ");
  if ("const" in field) return JSON.stringify(field.const);
  if (field.type === "array")
    return `${describeType((field.items as JsonSchema) ?? {})}[]`;
  if (field.format === "uuid") return "id";
  if (Array.isArray(field.anyOf))
    return (field.anyOf as JsonSchema[]).map(describeType).join(" | ");
  return typeof field.type === "string" ? field.type : "value";
}

function constraints(field: JsonSchema) {
  const notes: string[] = [];
  if (typeof field.maxLength === "number")
    notes.push(`up to ${field.maxLength} characters`);
  if (typeof field.pattern === "string" && field.pattern.includes("\\d{4}"))
    notes.push("YYYY-MM-DD");
  if (typeof field.maximum === "number" && typeof field.minimum === "number")
    notes.push(`${field.minimum}–${field.maximum}`);
  if ("default" in field)
    notes.push(`default ${JSON.stringify(field.default)}`);
  return notes.join(", ");
}

const errorResponse = {
  description: "An error",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
          requestId: { type: "string" },
        },
      },
    },
  },
};

function operation(endpoint: ApiEndpoint) {
  const query = endpoint.query ? jsonSchema(endpoint.query) : null;
  const pathParams = [...endpoint.path.matchAll(/\{(\w+)\}/g)].map(
    ([, name]) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }),
  );
  return {
    summary: endpoint.summary,
    description: [
      endpoint.description,
      endpoint.access === "write"
        ? "Needs a Read & write token."
        : "Works with any token.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    tags: [endpoint.group],
    "x-yuzu-access": endpoint.access,
    parameters: [
      ...pathParams,
      ...Object.entries(query?.properties ?? {}).map(([name, schema]) => ({
        name,
        in: "query",
        required: Boolean(query?.required?.includes(name)),
        schema,
      })),
    ],
    ...(endpoint.body
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: jsonSchema(endpoint.body) },
            },
          },
        }
      : {}),
    responses: {
      "200": { description: endpoint.returns },
      "401": errorResponse,
      "403": errorResponse,
      "409": errorResponse,
      "422": errorResponse,
      "429": errorResponse,
    },
  };
}

/** OpenAPI 3.0 for every endpoint API tokens may call. */
export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of apiEndpoints)
    (paths[endpoint.path] ??= {})[endpoint.method.toLowerCase()] =
      operation(endpoint);
  return {
    openapi: "3.0.3",
    info: {
      title: "Yuzu API",
      version: "1",
      description: `Send \`Authorization: Bearer <token>\` with a token from Settings → API. A token acts as its owner, with exactly their access. Responses are \`{ data, requestId }\` or \`{ error: { code, message }, requestId }\`. Each token can make ${TOKEN_RATE_PER_MINUTE} requests a minute.`,
    },
    servers: [{ url: serverUrl }],
    security: [{ token: [] }],
    components: {
      securitySchemes: { token: { type: "http", scheme: "bearer" } },
    },
    paths,
  };
}
