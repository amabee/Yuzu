// Sample tasks for the welcome page's Table/Kanban example. Nothing here is saved.
// Status names match the Project tasks template that setup creates.

export const LANES = [
  {
    key: "todo",
    name: "To do",
    color: "var(--st-todo)",
    tint: "color-mix(in srgb, var(--st-todo) 10%, transparent)",
  },
  {
    key: "work",
    name: "In progress",
    color: "var(--st-work)",
    tint: "color-mix(in srgb, var(--st-work) 10%, transparent)",
  },
  {
    key: "done",
    name: "Done",
    color: "var(--st-done)",
    tint: "color-mix(in srgb, var(--st-done) 10%, transparent)",
  },
] as const;

type Status = (typeof LANES)[number]["key"];
type Person = { initials: string; tone: string; name: string };

const mia: Person = { initials: "MR", tone: "a3", name: "Mia" };
const sarah: Person = { initials: "SC", tone: "a2", name: "Sarah" };
const owner: Person = { initials: "JP", tone: "a1", name: "John Paul" };
const lee: Person = { initials: "LK", tone: "a4", name: "Lee" };
const ana: Person = { initials: "AN", tone: "a5", name: "Ana" };

export const TASKS: {
  name: string;
  status: Status;
  person: Person;
  due: string;
}[] = [
  {
    name: "Draft launch announcement",
    status: "todo",
    person: mia,
    due: "Oct 22",
  },
  {
    name: "Invite the beta team",
    status: "work",
    person: sarah,
    due: "Oct 18",
  },
  {
    name: "Pick the board fields",
    status: "done",
    person: owner,
    due: "Oct 9",
  },
  { name: "Set up email delivery", status: "work", person: lee, due: "Oct 20" },
  {
    name: "Write the onboarding guide",
    status: "todo",
    person: ana,
    due: "Oct 28",
  },
  { name: "Create the Q4 board", status: "done", person: owner, due: "Oct 7" },
];
