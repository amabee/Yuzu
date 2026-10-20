"use client";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import { recordOf, type BoardState } from "@/lib/board-contract";
import { lower } from "@/lib/record-types";

export type LinkDraft = {
  targetBoardId: string;
  many: boolean;
  mirrorMany: boolean;
  mirrorName: string;
};
export type RollupDraft = {
  relationFieldId: string;
  aggregate: "count" | "sum";
  targetFieldId: string | null;
};

const targetsSchema = z.object({
  boards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      plural: z.string(),
      canManage: z.boolean(),
      numberFields: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
});

/** The extra choices for a new "Link to board" field or a rollup. */
export function LinkFieldSetup({
  state,
  type,
  link,
  rollup,
  onLink,
  onRollup,
}: {
  state: BoardState;
  type: "RELATION" | "ROLLUP";
  link: LinkDraft;
  rollup: RollupDraft;
  onLink: (draft: LinkDraft) => void;
  onRollup: (draft: RollupDraft) => void;
}) {
  const record = recordOf(state);
  const targets = useQuery({
    queryKey: ["principal", state.currentUserId, "link-targets", state.boardId],
    queryFn: async ({ signal }) =>
      targetsSchema.parse(
        (
          await apiRequest(
            `/api/v1/boards/link-targets?boardId=${state.boardId}`,
            { signal },
          )
        ).data,
      ).boards,
  });
  const boards = targets.data ?? [];
  if (targets.isPending)
    return <p className="text-xs text-muted-foreground">Loading boards…</p>;
  if (type === "RELATION") {
    const manageable = boards.filter((board) => board.canManage);
    const target = boards.find((board) => board.id === link.targetBoardId);
    return (
      <div className="link-setup">
        <label className="task-field-label">
          Links to
          <select
            aria-label="Board to link to"
            className="task-select"
            required
            value={link.targetBoardId}
            onChange={(event) =>
              onLink({
                ...link,
                targetBoardId: event.target.value,
                // Name the mirror after these records unless one was typed.
                mirrorName: link.mirrorName || record.plural,
              })
            }
          >
            <option value="">Choose a board</option>
            {manageable.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </label>
        <label className="task-field-label">
          Each {lower(record.singular)} links to
          <select
            aria-label="How many each record links to"
            className="task-select"
            value={link.many ? "many" : "one"}
            onChange={(event) =>
              onLink({ ...link, many: event.target.value === "many" })
            }
          >
            <option value="many">
              many {lower(target?.plural ?? "records")}
            </option>
            <option value="one">
              one {lower(target?.plural ?? "record").replace(/s$/, "")}
            </option>
          </select>
        </label>
        <label className="task-field-label">
          On {target?.name ?? "the other board"}, the mirror field is called
          <input
            aria-label="Mirror field name"
            className="task-select"
            required
            maxLength={80}
            value={link.mirrorName}
            onChange={(event) =>
              onLink({ ...link, mirrorName: event.target.value })
            }
          />
        </label>
        <label className="task-field-label">
          …and each of those links to
          <select
            aria-label="How many each linked record links back to"
            className="task-select"
            value={link.mirrorMany ? "many" : "one"}
            onChange={(event) =>
              onLink({ ...link, mirrorMany: event.target.value === "many" })
            }
          >
            <option value="one">one {lower(record.singular)}</option>
            <option value="many">many {lower(record.plural)}</option>
          </select>
        </label>
        {!manageable.length && (
          <p className="text-xs text-muted-foreground">
            You can link to boards you manage in this workspace, since their
            mirror field is added there.
          </p>
        )}
      </div>
    );
  }
  const relations = state.fields.filter((field) => field.type === "RELATION");
  const relation = relations.find(
    (field) => field.id === rollup.relationFieldId,
  );
  const linkedBoard = boards.find(
    (board) => board.id === relation?.relation?.targetBoardId,
  );
  return (
    <div className="link-setup">
      <label className="task-field-label">
        Through
        <select
          aria-label="Link field to roll up"
          className="task-select"
          required
          value={rollup.relationFieldId}
          onChange={(event) =>
            onRollup({
              ...rollup,
              relationFieldId: event.target.value,
              targetFieldId: null,
            })
          }
        >
          <option value="">Choose a link field</option>
          {relations.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </label>
      <label className="task-field-label">
        Show
        <select
          aria-label="Rollup calculation"
          className="task-select"
          value={rollup.aggregate}
          onChange={(event) =>
            onRollup({
              ...rollup,
              aggregate: event.target.value as RollupDraft["aggregate"],
            })
          }
        >
          <option value="count">how many are linked</option>
          <option value="sum">the total of a number field</option>
        </select>
      </label>
      {rollup.aggregate === "sum" && (
        <label className="task-field-label">
          Field to total
          <select
            aria-label="Number field to total"
            className="task-select"
            required
            value={rollup.targetFieldId ?? ""}
            onChange={(event) =>
              onRollup({ ...rollup, targetFieldId: event.target.value || null })
            }
          >
            <option value="">Choose a number field</option>
            {(linkedBoard?.numberFields ?? []).map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!relations.length && (
        <p className="text-xs text-muted-foreground">
          Add a Link to board field first; rollups count or total through it.
        </p>
      )}
    </div>
  );
}
