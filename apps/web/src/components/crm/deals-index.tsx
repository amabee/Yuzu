"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Handshake, Plus } from "lucide-react";
import "./crm.css";
import { PageCrumbs } from "@/components/page-crumbs";
import { saveError } from "./use-crm";
import { moneyTotals, useCreatePipeline, usePipelines } from "./use-deals";

/** The workspace's pipelines, and a way to start one. */
export function DealsIndex({
  principalId,
  workspaceId,
  workspaceName,
}: {
  principalId: string;
  workspaceId: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const pipelines = usePipelines(principalId, workspaceId);
  const create = useCreatePipeline(principalId);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = pipelines.data;
  return (
    <div className="crm-page">
      <PageCrumbs
        items={[{ label: "CRM", href: "/crm" }, { label: "Deals" }]}
      />
      <header className="crm-page-head">
        <div>
          <p className="crm-page-context">{workspaceName}</p>
          <h1>Deals</h1>
          <p className="crm-page-lede">
            Each pipeline is a sales process with its own stages, from first
            conversation to won or lost.
          </p>
        </div>
      </header>
      {pipelines.isError ? (
        <div className="crm-empty-state" role="alert">
          <b>Pipelines couldn&apos;t load</b>
          <span>{saveError(pipelines.error)}</span>
        </div>
      ) : !data ? (
        <div className="crm-empty-state" aria-busy="true">
          <span>Loading pipelines…</span>
        </div>
      ) : (
        <>
          {data.pipelines.length > 0 ? (
            <ul className="deal-pipelines">
              {data.pipelines.map((pipeline) => (
                <li key={pipeline.boardId}>
                  <Link href={`/crm/deals/${pipeline.boardId}`}>
                    <Handshake size={18} aria-hidden="true" />
                    <span>
                      <b>{pipeline.name}</b>
                      <small>
                        {pipeline.archived
                          ? "Archived"
                          : `${pipeline.openCount} open ${pipeline.openCount === 1 ? "deal" : "deals"}${
                              Object.keys(pipeline.openTotals).length
                                ? ` · ${moneyTotals(pipeline.openTotals)}`
                                : ""
                            }`}
                      </small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="crm-empty-state">
              <b>No pipelines yet</b>
              <span>
                {data.canCreate
                  ? "Start one below. It comes with New, Qualified, Proposal, Negotiation, Won and Lost stages you can change."
                  : "Ask an administrator or a board manager to start a pipeline."}
              </span>
            </div>
          )}
          {data.canCreate && (
            <form
              className="deal-new-pipeline"
              onSubmit={(event) => {
                event.preventDefault();
                const value = name.trim();
                if (!value) return;
                create.mutate(
                  { workspaceId, name: value },
                  {
                    onSuccess: ({ boardId }) => {
                      setName("");
                      setError(null);
                      router.push(`/crm/deals/${boardId}`);
                      router.refresh();
                    },
                    onError: (failure) => setError(saveError(failure)),
                  },
                );
              }}
            >
              <label htmlFor="new-pipeline">New pipeline</label>
              <div>
                <input
                  id="new-pipeline"
                  value={name}
                  maxLength={100}
                  placeholder="e.g. New business, Renewals"
                  onChange={(event) => setName(event.target.value)}
                />
                <button
                  type="submit"
                  className="crm-button"
                  data-tone="primary"
                  disabled={!name.trim() || create.isPending}
                >
                  <Plus size={14} aria-hidden="true" />
                  {create.isPending ? "Creating…" : "Create pipeline"}
                </button>
              </div>
              {error && (
                <span role="alert" className="crm-field-error">
                  {error}
                </span>
              )}
            </form>
          )}
        </>
      )}
    </div>
  );
}
