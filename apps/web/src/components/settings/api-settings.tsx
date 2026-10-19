"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import {
  createdTokenSchema,
  expiryLabel,
  TOKEN_LIMIT,
  tokenExpiries,
  tokenListSchema,
  type ApiTokenView,
} from "@/lib/api-token-contract";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
  PauseModal,
} from "@/components/pause/pause-dialog";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import { ago } from "@/components/team/people-manager";

type Field = { name: string; type: string; required: boolean; notes: string };
export type ReferenceEndpoint = {
  method: "GET" | "POST";
  path: string;
  group: string;
  summary: string;
  description: string | null;
  access: "read" | "write";
  returns: string;
  query: Field[];
  body: Field[];
};
type Tab = "MINE" | "REFERENCE" | "ALL";

/** Settings → API: your tokens, the reference, and (admins) all tokens. */
export function ApiSettings({
  currentUserId,
  isAdmin,
  baseUrl,
  reference,
}: {
  currentUserId: string;
  isAdmin: boolean;
  baseUrl: string;
  reference: ReferenceEndpoint[];
}) {
  const [tab, setTab] = useState<Tab>("MINE");
  return (
    <section className="api-settings">
      <div className="people-admin-tabs" role="group" aria-label="API sections">
        {(
          [
            ["MINE", "Your tokens"],
            ["REFERENCE", "Reference"],
            ...(isAdmin ? ([["ALL", "All tokens"]] as const) : []),
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "REFERENCE" ? (
        <Reference baseUrl={baseUrl} endpoints={reference} />
      ) : (
        <Tokens
          key={tab}
          currentUserId={currentUserId}
          all={tab === "ALL"}
          baseUrl={baseUrl}
        />
      )}
    </section>
  );
}

function Tokens({
  currentUserId,
  all,
  baseUrl,
}: {
  currentUserId: string;
  all: boolean;
  baseUrl: string;
}) {
  const client = useQueryClient();
  const key = ["principal", currentUserId, "api-tokens", all ? "all" : "mine"];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"READ" | "WRITE">("READ");
  const [expires, setExpires] = useState<keyof typeof tokenExpiries>("90");
  const [created, setCreated] = useState<{
    token: string;
    view: ApiTokenView;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiTokenView | null>(null);
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const list = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      tokenListSchema.parse(
        (
          await apiRequest(`/api/v1/tokens/list${all ? "?all=1" : ""}`, {
            signal,
          })
        ).data,
      ),
  });
  const fail = (error: Error) =>
    setNotice({
      id: crypto.randomUUID(),
      kind: "error",
      title: "Couldn't update tokens",
      message: error.message,
    });
  const create = useMutation({
    mutationFn: async () =>
      createdTokenSchema.parse(
        (
          await apiRequest("/api/v1/tokens/create", {
            method: "POST",
            json: { name, access, expires },
          })
        ).data,
      ),
    onSuccess: (result) => {
      setCreating(false);
      setName("");
      setCopied(false);
      setCreated(result);
    },
    onError: fail,
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["principal", currentUserId, "api-tokens"],
      }),
  });
  const revoke = useMutation({
    mutationFn: (token: ApiTokenView) =>
      apiRequest("/api/v1/tokens/revoke", {
        method: "POST",
        json: { id: token.id },
      }),
    onSuccess: (_, token) => {
      setRevoking(null);
      setNotice({
        id: crypto.randomUUID(),
        kind: "success",
        message: `“${token.name}” no longer works.`,
      });
    },
    onError: fail,
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["principal", currentUserId, "api-tokens"],
      }),
  });
  const tokens = list.data?.tokens ?? [];
  const active = tokens.filter(
    (token) => expiryLabel(token.expiresAt).tone !== "gone",
  ).length;
  return (
    <>
      <YuzuToast notice={notice} />
      {!all && (
        <div className="api-bar">
          <span>
            {active} of {TOKEN_LIMIT} tokens
          </span>
          <PauseButton
            tone="primary"
            disabled={active >= TOKEN_LIMIT}
            onClick={() => setCreating(true)}
          >
            Create token
          </PauseButton>
        </div>
      )}
      {list.isPending ? (
        <p role="status" className="audit-empty">
          Loading tokens…
        </p>
      ) : list.error ? (
        <p role="alert" className="audit-empty">
          {list.error.message}
        </p>
      ) : !tokens.length ? (
        <p className="audit-empty">
          {all
            ? "Nobody has an API token yet."
            : "No tokens yet. Create one to connect a script or tool."}
        </p>
      ) : (
        <ul className="people-admin-rows api-tokens">
          {tokens.map((token) => {
            const expiry = expiryLabel(token.expiresAt);
            return (
              <li key={token.id}>
                <div className="min-w-0">
                  <b>{token.name}</b>
                  <small>
                    <code>{token.prefix}…</code>
                    {token.owner ? ` · ${token.owner}` : ""} ·{" "}
                    {token.lastUsedAt
                      ? `used ${ago(token.lastUsedAt).toLowerCase()}`
                      : "never used"}
                  </small>
                </div>
                <span className="api-access" data-access={token.access}>
                  {token.access === "WRITE" ? "Read & write" : "Read only"}
                </span>
                <span className="api-expiry" data-tone={expiry.tone}>
                  {expiry.text}
                </span>
                <button
                  type="button"
                  className="api-revoke"
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => setRevoking(token)}
                >
                  {expiry.tone === "gone" ? "Remove" : "Revoke"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!all && (
        <p className="people-admin-foot">
          Tokens can read and change board work only. Team, settings and tokens
          stay in the app. Base URL: <code>{baseUrl}</code>
        </p>
      )}

      <PauseModal
        open={creating}
        onOpenChange={setCreating}
        title="Create an API token"
        description="It acts as you, with exactly your access."
        as="form"
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              type="submit"
              disabled={create.isPending || !name.trim()}
            >
              {create.isPending ? "Creating…" : "Create token"}
            </PauseButton>
          </>
        }
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="task-field-label">
          Name
          <input
            className="task-select"
            aria-label="Token name"
            placeholder="e.g. Weekly report script"
            maxLength={60}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="task-field-label">
          Access
          <span
            className="email-settings-seg"
            role="radiogroup"
            aria-label="Access"
          >
            {(
              [
                ["READ", "Read only"],
                ["WRITE", "Read & write"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={access === value}
                onClick={() => setAccess(value)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
        <div className="task-field-label">
          Expires
          <span
            className="email-settings-seg"
            role="radiogroup"
            aria-label="Expires"
          >
            {(
              Object.entries(tokenExpiries) as [
                keyof typeof tokenExpiries,
                string,
              ][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={expires === value}
                onClick={() => setExpires(value)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
      </PauseModal>

      <PauseModal
        open={Boolean(created)}
        onOpenChange={(open) => !open && setCreated(null)}
        title="Your new token"
        description={
          created
            ? `“${created.view.name}” · ${created.view.access === "WRITE" ? "Read & write" : "Read only"} · ${expiryLabel(created.view.expiresAt).text}`
            : undefined
        }
        actions={
          <PauseClose asChild>
            <PauseButton tone="primary">Done</PauseButton>
          </PauseClose>
        }
      >
        <div className="api-reveal">
          <code aria-label="New API token">{created?.token}</code>
          <PauseButton
            onClick={async () => {
              if (!created) return;
              try {
                await navigator.clipboard.writeText(created.token);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </PauseButton>
        </div>
        <p className="api-warn">
          Copy it now. Yuzu keeps only a fingerprint, so this is the only time
          you&apos;ll see it.
        </p>
      </PauseModal>

      <PauseDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        intent="danger"
        title={`Revoke “${revoking?.name ?? ""}”?`}
        description="Anything using it stops working right away. This can't be undone."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              data-autofocus
              disabled={revoke.isPending}
              onClick={() => revoking && revoke.mutate(revoking)}
            >
              Revoke token
            </PauseButton>
          </>
        }
      />
    </>
  );
}

function Reference({
  baseUrl,
  endpoints,
}: {
  baseUrl: string;
  endpoints: ReferenceEndpoint[];
}) {
  const groups = [...new Set(endpoints.map((item) => item.group))];
  return (
    <div className="api-reference">
      <p className="people-admin-foot">
        Send <code>Authorization: Bearer $YUZU_TOKEN</code>. Responses are JSON:{" "}
        <code>{"{ data, requestId }"}</code> or{" "}
        <code>{"{ error: { code, message } }"}</code>. Each token can make 120
        requests a minute.{" "}
        <a href="/api/v1/openapi.json" download="yuzu-openapi.json">
          Download openapi.json
        </a>
      </p>
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <h2 className="audit-day">{group}</h2>
          {endpoints
            .filter((item) => item.group === group)
            .map((endpoint) => (
              <details
                key={`${endpoint.method} ${endpoint.path}`}
                className="api-endpoint"
              >
                <summary>
                  <span className="api-method" data-method={endpoint.method}>
                    {endpoint.method}
                  </span>
                  <code>{endpoint.path}</code>
                  <small>
                    {endpoint.access === "write" ? "Read & write" : "Read"} ·{" "}
                    {endpoint.summary}
                  </small>
                </summary>
                <div className="api-endpoint-body">
                  {endpoint.description && <p>{endpoint.description}</p>}
                  <p>Returns: {endpoint.returns}.</p>
                  {[...endpoint.query, ...endpoint.body].length > 0 && (
                    <table className="api-fields">
                      <tbody>
                        {[...endpoint.query, ...endpoint.body].map((field) => (
                          <tr key={field.name}>
                            <td>
                              <code>{field.name}</code>
                            </td>
                            <td>
                              {field.type}
                              {field.notes ? ` · ${field.notes}` : ""}
                              {field.required && (
                                <span className="api-required">required</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <pre>{example(baseUrl, endpoint)}</pre>
                </div>
              </details>
            ))}
        </section>
      ))}
    </div>
  );
}

function example(baseUrl: string, endpoint: ReferenceEndpoint) {
  const required = (fields: Field[]) =>
    fields.filter((field) => field.required);
  const path = endpoint.path.replace("{id}", "<id>");
  if (endpoint.method === "GET") {
    const query = required(endpoint.query)
      .map((field) => `${field.name}=<${field.name}>`)
      .join("&");
    return `curl "${baseUrl}${path}${query ? `?${query}` : ""}" \\\n  -H "Authorization: Bearer $YUZU_TOKEN"`;
  }
  const body = Object.fromEntries(
    required(endpoint.body).map((field) => [field.name, `<${field.name}>`]),
  );
  return `curl -X POST "${baseUrl}${path}" \\\n  -H "Authorization: Bearer $YUZU_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'`;
}
