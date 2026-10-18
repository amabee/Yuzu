"use client";
import { Lock, Users } from "lucide-react";
import { projectColors } from "@/lib/project-contract";

const colorNames: Record<(typeof projectColors)[number], string> = {
  teal: "Teal",
  blue: "Blue",
  sky: "Sky",
  citrus: "Citrus",
  green: "Green",
  coral: "Coral",
  rose: "Rose",
  slate: "Slate",
};

export function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: (typeof projectColors)[number]) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Project color"
      className="project-swatches"
    >
      {projectColors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={colorNames[color]}
          title={colorNames[color]}
          className="project-swatch project-badge"
          data-color={color}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

export function VisibilityChoice({
  value,
  onChange,
  workspaceName,
}: {
  value: "PUBLIC" | "PRIVATE";
  onChange: (value: "PUBLIC" | "PRIVATE") => void;
  workspaceName: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="task-field-label mb-2">Who can see it</legend>
      <label className="project-choice">
        <input
          type="radio"
          name="project-visibility"
          checked={value === "PUBLIC"}
          onChange={() => onChange("PUBLIC")}
          className="mt-1"
        />
        <span className="flex items-center gap-2 text-sm font-medium">
          <Users size={15} /> Workspace
        </span>
        <small>Everyone in {workspaceName} can see it</small>
      </label>
      <label className="project-choice">
        <input
          type="radio"
          name="project-visibility"
          checked={value === "PRIVATE"}
          onChange={() => onChange("PRIVATE")}
          className="mt-1"
        />
        <span className="flex items-center gap-2 text-sm font-medium">
          <Lock size={15} /> Private
        </span>
        <small>Only people you add</small>
      </label>
    </fieldset>
  );
}
