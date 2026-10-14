"use client";
import { useState } from "react";
import { Columns3, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BoardSurface({
  name,
  fields,
  statuses,
  group,
}: {
  name: string;
  fields: { id: string; name: string }[];
  statuses: string[];
  group: string;
}) {
  const [view, setView] = useState<"board" | "table">("board");
  return (
    <section className="mt-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex gap-2" aria-label="Board view">
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            <Columns3 size={16} />
            Board
          </Button>
          <Button
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <Table2 size={16} />
            Table
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">{group} · 0 tasks</span>
      </div>
      {view === "board" ? (
        <div className="overflow-x-auto pb-3">
          <div
            className={`grid gap-4 ${statuses.length > 1 ? "min-w-[660px]" : ""}`}
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, statuses.length)}, minmax(200px, 1fr))`,
            }}
          >
            {(statuses.length ? statuses : [group]).map((status) => (
              <section
                key={status}
                className="min-h-72 rounded-xl border bg-secondary/40 p-3"
              >
                <div className="mb-3 flex items-center justify-between px-1 py-2">
                  <h2 className="text-sm">
                    <span className="mr-2 inline-block size-2 rounded-full bg-primary/60" />
                    {status}
                  </h2>
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
                    0
                  </span>
                </div>
                <div className="rounded-lg border border-dashed bg-card px-4 py-8 text-center text-xs leading-6 text-muted-foreground">
                  A little room for what’s next.
                  <br />
                  No tasks yet.
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table
            className={`w-full text-left text-sm ${fields.length ? "min-w-[700px]" : ""}`}
          >
            <caption className="sr-only">{name} fields</caption>
            <thead>
              <tr>
                {fields.map((field) => (
                  <th
                    scope="col"
                    key={field.id}
                    className="border-b px-5 py-4 font-medium"
                  >
                    {field.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={Math.max(1, fields.length)}
                  className="p-12 text-center"
                >
                  <Columns3 size={26} className="mx-auto mb-4 text-primary" />
                  <p className="font-medium">
                    A clean start for {group.toLowerCase()}.
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    No sample records were created during installation.
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-5 text-xs text-muted-foreground">
        Your saved fields:{" "}
        {fields.map((field) => field.name).join(" · ") ||
          "No fields configured"}
        . Task editing arrives with the board engine.
      </p>
    </section>
  );
}
