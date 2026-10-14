"use client";
import { useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Columns3,
  FolderOpen,
  Home,
  LayoutGrid,
  Mail,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Type,
  Undo2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  contrast,
  fontFamily,
  fontOptions,
  presets,
  previewThemeSchema,
  type PreviewColors,
  type PreviewTheme,
} from "./theme-model";

const tasks = [
  {
    title: "Plan the first team workspace",
    tags: ["Planning", "Product"],
    lane: 0,
    initials: "AL",
    date: "Oct 18",
    count: 2,
  },
  {
    title: "Explore the new board layout",
    tags: ["Design", "UI"],
    lane: 0,
    initials: "KC",
    date: "Oct 20",
    count: 3,
  },
  {
    title: "Define member editing access",
    tags: ["Permissions", "Product"],
    lane: 0,
    initials: "AL",
    date: "Oct 21",
    count: 1,
  },
  {
    title: "Build the appearance editor",
    tags: ["Frontend", "Design"],
    lane: 1,
    initials: "AL",
    date: "Oct 18",
    count: 5,
  },
  {
    title: "Refine onboarding surfaces",
    tags: ["Design", "Experience"],
    lane: 1,
    initials: "KC",
    date: "Oct 19",
    count: 2,
  },
  {
    title: "Review invitation experience",
    tags: ["Accounts", "Experience"],
    lane: 2,
    initials: "JM",
    date: "Oct 17",
    count: 3,
  },
  {
    title: "Choose the default theme",
    tags: ["Design", "Brand"],
    lane: 2,
    initials: "KC",
    date: "Oct 18",
    count: 2,
  },
  {
    title: "Test password recovery",
    tags: ["Accounts", "Testing"],
    lane: 3,
    initials: "JM",
    date: "Oct 16",
    count: 1,
  },
  {
    title: "Prepare local email testing",
    tags: ["Setup", "Testing"],
    lane: 3,
    initials: "AL",
    date: "Oct 15",
    count: 2,
  },
];
const lanes = ["To do", "In progress", "Review", "Done"];
const colorLabels: [keyof PreviewColors, string][] = [
  ["primary", "Primary action"],
  ["canvas", "Canvas"],
  ["ink", "Text"],
  ["paper", "Surface"],
  ["border", "Borders"],
  ["sidebar", "Sidebar"],
  ["sidebarInk", "Sidebar text"],
  ["muted", "Muted text"],
];

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ap-range">
      <span>
        {label}
        <output>
          {value}
          {suffix}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function AppearancePreview({
  fontClass,
  editor,
}: {
  fontClass: string;
  editor?: {
    theme: PreviewTheme;
    onChange: (theme: PreviewTheme) => void;
    actions: React.ReactNode;
    busy?: boolean;
  };
}) {
  const [localTheme, setLocalTheme] = useState<PreviewTheme>(() =>
    structuredClone(presets[0]),
  );
  const theme = editor?.theme ?? localTheme;
  const setTheme = editor?.onChange ?? setLocalTheme;
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [section, setSection] = useState<"colors" | "type" | "shape">("colors");
  const [view, setView] = useState<"board" | "form">("board");
  const [history, setHistory] = useState<PreviewTheme[]>([]);
  const [notice, setNotice] = useState("");
  const [selectedTask, setSelectedTask] = useState<
    (typeof tasks)[number] | null
  >(null);
  const importFile = useRef<HTMLInputElement>(null);
  const colors = theme[mode];
  function update(next: PreviewTheme) {
    setHistory((items) => [...items.slice(-39), theme]);
    setTheme(next);
    setNotice("");
  }
  function change<K extends keyof PreviewTheme>(
    key: K,
    value: PreviewTheme[K],
  ) {
    update({ ...theme, [key]: value });
  }
  const buttonInk =
    contrast(colors.primary, "#FFFFFF") > contrast(colors.primary, "#101820")
      ? "#FFFFFF"
      : "#101820";
  const variables = {
    "--background": colors.canvas,
    "--foreground": colors.ink,
    "--card": colors.paper,
    "--card-foreground": colors.ink,
    "--popover": colors.paper,
    "--popover-foreground": colors.ink,
    "--primary": colors.primary,
    "--primary-foreground": buttonInk,
    "--secondary": colors.canvas,
    "--secondary-foreground": colors.ink,
    "--accent": colors.canvas,
    "--accent-foreground": colors.ink,
    "--border": colors.border,
    "--input": colors.border,
    "--ring": colors.primary,
    "--muted": colors.canvas,
    "--muted-foreground": colors.muted,
    "--ap-sidebar": colors.sidebar,
    "--ap-sidebar-ink": colors.sidebarInk,
    "--ap-heading": fontFamily(theme.headingFont),
    "--ap-body": fontFamily(theme.bodyFont),
    "--ap-radius": `${theme.radius}px`,
    "--ap-shadow": `${theme.shadow}px`,
    "--ap-blur": `${theme.blur}px`,
    "--ap-glass": `${theme.glass}%`,
    "--ap-elevation":
      theme.shadow === 0
        ? "none"
        : `0 ${Math.max(1, theme.shadow / 3)}px ${theme.shadow * 2.5}px ${theme.shadow / 15}px rgba(0, 0, 0, ${mode === "dark" ? 0.12 + theme.shadow / 75 : 0.04 + theme.shadow / 180})`,
    "--ap-card-elevation":
      theme.shadow === 0
        ? "none"
        : `0 ${Math.max(1, theme.shadow / 6)}px ${theme.shadow}px rgba(0, 0, 0, ${mode === "dark" ? 0.1 + theme.shadow / 100 : 0.02 + theme.shadow / 250})`,
    "--ap-font-size": `${theme.fontSize}px`,
    "--ap-heading-weight": theme.headingWeight,
    "--ap-tracking": `${theme.tracking}em`,
    "--ap-leading": theme.lineHeight,
  } as CSSProperties;
  async function saveDraft() {
    try {
      localStorage.setItem(
        "yuzu:appearance-design-draft",
        JSON.stringify(theme),
      );
      setNotice(
        "Draft saved in this browser. Your teammates’ theme is unchanged.",
      );
    } catch {
      setNotice(
        "This browser could not save the draft. Export JSON to keep a copy.",
      );
    }
  }
  function loadDraft() {
    try {
      const saved = localStorage.getItem("yuzu:appearance-design-draft");
      if (!saved) {
        setNotice("No saved preview draft in this browser yet.");
        return;
      }
      update(previewThemeSchema.parse(JSON.parse(saved)));
      setNotice("Saved preview draft loaded.");
    } catch {
      setNotice(
        "The saved draft could not be loaded. Choose a preset to start again.",
      );
    }
  }
  function exportTheme() {
    const blob = new Blob([JSON.stringify(theme, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${theme.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Preview theme exported as JSON.");
  }
  async function importTheme(file?: File) {
    if (!file) return;
    try {
      if (file.size > 16_384) throw new Error();
      update(previewThemeSchema.parse(JSON.parse(await file.text())));
      setNotice("Theme imported into this preview.");
    } catch {
      setNotice(
        "That file is not a valid Yuzu preview theme. Import a JSON file exported by this editor.",
      );
    } finally {
      if (importFile.current) importFile.current.value = "";
    }
  }
  return (
    <div
      className={`appearance-preview ${editor ? "global-editor" : ""} ${fontClass}`}
      style={variables}
      data-mode={mode}
    >
      <header className="ap-preview-bar">
        <div>
          <span className="ap-preview-dot" />
          {editor ? "Theme studio" : "Phase 0.5"}{" "}
          <span className="ap-preview-caption">
            {editor ? "Live draft preview" : "Interactive design preview"}
          </span>
        </div>
        <span className="ap-preview-caption">
          {editor
            ? "Sample content · draft preview"
            : "Sample data · no global changes"}
        </span>
      </header>
      <div className="ap-layout">
        <aside className="ap-sidebar">
          <div className="ap-brand">
            <Image src="/logo.svg" width={35} height={35} alt="" />
            <strong>
              yuzu<span>.</span>
            </strong>
          </div>
          <div className="ap-workspace">
            <span className="ap-workspace-symbol">
              <Users size={17} />
            </span>
            <div>
              <b>Our team</b>
              <small>Main workspace</small>
            </div>
            <ChevronDown size={15} />
          </div>
          <nav aria-label="Sample workspace navigation">
            <span className="ap-nav-item">
              <Home size={17} />
              Overview
            </span>
            <span className="ap-nav-item ap-active">
              <LayoutGrid size={17} />
              Boards<span className="ap-nav-count">3</span>
            </span>
            <span className="ap-nav-item">
              <ShieldCheck size={17} />
              Approvals
            </span>
            <span className="ap-nav-item">
              <Settings2 size={17} />
              Settings
            </span>
          </nav>
          <p className="ap-sidebar-label">Workspace boards</p>
          <div className="ap-board-list">
            <span className="ap-selected-board">
              <Columns3 size={15} /> Product development
              <span className="ap-tiny-dot" />
            </span>
            <span>
              <Columns3 size={15} /> Team operations
            </span>
            <span>
              <Columns3 size={15} /> Design direction
            </span>
          </div>
          <div className="ap-sidebar-bottom">
            <div className="ap-sidebar-callout">
              <Palette size={21} />
              <b>A space that feels like yours.</b>
              <p>One shared theme. Your own light or dark preference.</p>
            </div>
            <span className="ap-nav-item">
              <CircleHelp size={16} />
              Help & guidance
            </span>
            <div className="ap-profile">
              <span className="ap-avatar">AL</span>
              <div>
                <b>Angel</b>
                <small>Installation owner</small>
              </div>
              <ChevronDown size={14} />
            </div>
          </div>
        </aside>
        <main className="ap-workspace-main">
          <div className="ap-topbar">
            <div className="ap-breadcrumb">
              Workspaces
              <ChevronRight size={13} />
              Our team
            </div>
            <div className="ap-top-actions">
              <span className="ap-connected">
                <span />
                All changes in preview
              </span>
              <span className="ap-avatar ap-avatar-small">AL</span>
            </div>
          </div>
          <div className="ap-content">
            <div className="ap-page-heading">
              <div>
                <p>Our team / Product</p>
                <h1>
                  {view === "board"
                    ? "Product development"
                    : "Account experience"}
                </h1>
                <span>
                  {view === "board"
                    ? "A little structure. A shared direction. Room to grow."
                    : "Clear forms, calm surfaces, and the same visual language."}
                </span>
              </div>
              <div className="ap-people">
                <span className="ap-avatar">AL</span>
                <span className="ap-avatar ap-avatar-other">KC</span>
                <span className="ap-avatar ap-avatar-third">JM</span>
                <span className="ap-person-count">+2</span>
              </div>
            </div>
            <div className="ap-viewbar">
              <div className="ap-views">
                <button
                  aria-pressed={view === "board"}
                  onClick={() => setView("board")}
                >
                  <Columns3 size={16} />
                  Workspace
                </button>
                <button
                  aria-pressed={view === "form"}
                  onClick={() => setView("form")}
                >
                  <Mail size={16} />
                  Account form
                </button>
              </div>
              <span className="ap-sample-label">Sample content</span>
            </div>
            {view === "board" ? (
              <>
                <div className="ap-board-toolbar">
                  <span>
                    <FolderOpen size={15} />
                    Launch project
                    <ChevronDown size={14} />
                  </span>
                  <span className="ap-toolbar-note">
                    Select a card to preview the detail panel
                  </span>
                  <span className="ap-view-icons">
                    <LayoutGrid size={16} />
                  </span>
                </div>
                <div className="ap-board">
                  {lanes.map((lane, index) => (
                    <section className={`ap-lane ap-lane-${index}`} key={lane}>
                      <header>
                        <span className="ap-lane-dot" />
                        <h2>{lane}</h2>
                        <span>
                          {tasks.filter((task) => task.lane === index).length}
                        </span>
                      </header>
                      <div className="ap-lane-cards">
                        {tasks
                          .filter((task) => task.lane === index)
                          .map((task) => (
                            <button
                              className="ap-task-card"
                              key={task.title}
                              onClick={() => setSelectedTask(task)}
                            >
                              <b>{task.title}</b>
                              <div className="ap-tags">
                                {task.tags.map((tag, tagIndex) => (
                                  <span
                                    key={tag}
                                    className={
                                      tagIndex === 0 ? "ap-tag-primary" : ""
                                    }
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              <footer>
                                <span className="ap-card-comments">
                                  ↳ {task.count}
                                </span>
                                <span>{task.date}</span>
                                <span className="ap-avatar ap-avatar-small">
                                  {task.initials}
                                </span>
                              </footer>
                            </button>
                          ))}
                      </div>
                      <div className="ap-lane-bottom">
                        <Plus size={14} /> Room for what’s next
                      </div>
                    </section>
                  ))}
                </div>
                <div className="ap-under-board">
                  <div>
                    <span className="ap-summary-icon">
                      <Check size={16} />
                    </span>
                    <div>
                      <b>A clear view of your team’s work.</b>
                      <p>
                        Adjust the theme on the right. The workspace responds as
                        you go.
                      </p>
                    </div>
                  </div>
                  <span className="ap-live-label">Live preview</span>
                </div>
              </>
            ) : (
              <div className="ap-form-stage">
                <section className="ap-account-card">
                  <div className="ap-account-mark">
                    <Image src="/logo.svg" width={40} height={40} alt="Yuzu" />
                  </div>
                  <h2>Welcome back.</h2>
                  <p>A familiar space for your team’s next chapter.</p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      setNotice(
                        "This is a sample form. No sign-in request was sent.",
                      );
                    }}
                  >
                    <label>
                      Email address
                      <Input
                        type="email"
                        defaultValue="angel@example.test"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Password
                      <Input
                        type="password"
                        defaultValue="sample-only-password"
                        autoComplete="off"
                      />
                    </label>
                    <span className="ap-forgot">Forgot password?</span>
                    <Button type="submit">Sign in</Button>
                  </form>
                  <small>Sample account form · visual preview only</small>
                </section>
              </div>
            )}
          </div>
        </main>
        <aside className="ap-editor">
          <header className="ap-editor-heading">
            <span className="ap-editor-mark">
              <Palette size={19} />
            </span>
            <div>
              <h2>Make it your Yuzu.</h2>
              <p>Shape your team’s shared space.</p>
            </div>
          </header>
          <fieldset className="ap-editor-scroll" disabled={editor?.busy}>
            <div className="ap-theme-title">
              <label htmlFor="theme-name">Theme name</label>
              <Input
                id="theme-name"
                value={theme.name}
                maxLength={50}
                onChange={(event) => change("name", event.target.value)}
              />
            </div>
            <div className="ap-presets">
              <label htmlFor="theme-preset">
                Start with a preset{" "}
                <span className="ap-choice-count">{presets.length} themes</span>
              </label>
              <select
                id="theme-preset"
                value={
                  presets.some((preset) => preset.name === theme.name)
                    ? theme.name
                    : "custom"
                }
                onChange={(event) => {
                  const preset = presets.find(
                    (item) => item.name === event.target.value,
                  );
                  if (preset) update(structuredClone(preset));
                }}
              >
                <option value="custom" disabled>
                  Custom theme
                </option>
                {presets.map((preset) => (
                  <option key={preset.name}>{preset.name}</option>
                ))}
              </select>
              <div className="ap-preset-swatches">
                {presets.map((preset) => (
                  <button
                    key={preset.name}
                    aria-label={`Apply ${preset.name} preset`}
                    title={preset.name}
                    aria-pressed={theme.name === preset.name}
                    onClick={() => update(structuredClone(preset))}
                  >
                    <i style={{ background: preset.light.sidebar }} />
                    <i style={{ background: preset.light.primary }} />
                    <i style={{ background: preset.light.canvas }} />
                  </button>
                ))}
              </div>
            </div>
            <div className="ap-mode-control" aria-label="Preview color mode">
              <button
                aria-pressed={mode === "light"}
                onClick={() => setMode("light")}
              >
                <Sun size={15} />
                Light
              </button>
              <button
                aria-pressed={mode === "dark"}
                onClick={() => setMode("dark")}
              >
                <Moon size={15} />
                Dark
              </button>
            </div>
            <p className="ap-mode-hint">
              {editor
                ? "Preview either mode. Everyone keeps their own mode."
                : "Mode is personal. Your global theme includes both."}
            </p>
            <div className="ap-editor-tabs" aria-label="Theme controls">
              {(["colors", "type", "shape"] as const).map((tab) => (
                <button
                  key={tab}
                  aria-pressed={section === tab}
                  onClick={() => setSection(tab)}
                >
                  {tab === "colors" ? (
                    <Palette size={14} />
                  ) : tab === "type" ? (
                    <Type size={14} />
                  ) : (
                    <SlidersHorizontal size={14} />
                  )}
                  {tab === "colors"
                    ? "Colors"
                    : tab === "type"
                      ? "Type"
                      : "Depth"}
                </button>
              ))}
            </div>
            {section === "colors" && (
              <div className="ap-color-controls">
                <div className="ap-section-intro">
                  <h3>{mode === "light" ? "Light" : "Dark"} palette</h3>
                  <span>Semantic colors, made yours.</span>
                </div>
                {colorLabels.map(([key, label]) => (
                  <label className="ap-color-row" key={key}>
                    <span>{label}</span>
                    <div>
                      <input
                        aria-label={`${label} color`}
                        type="color"
                        value={colors[key]}
                        onChange={(event) =>
                          change(mode, { ...colors, [key]: event.target.value })
                        }
                      />
                      <code>{colors[key].toUpperCase()}</code>
                    </div>
                  </label>
                ))}
                <div
                  className={`ap-contrast ${contrast(colors.ink, colors.paper) < 4.5 ? "ap-contrast-low" : ""}`}
                >
                  <ShieldCheck size={17} />
                  <div>
                    <b>
                      {contrast(colors.ink, colors.paper).toFixed(1)}:1 text
                      contrast
                    </b>
                    <small>
                      {contrast(colors.ink, colors.paper) >= 4.5
                        ? "Body text meets the 4.5:1 target."
                        : "Adjust text or surface color for readability."}
                    </small>
                  </div>
                </div>
              </div>
            )}
            {section === "type" && (
              <div className="ap-type-controls">
                <div className="ap-section-intro">
                  <h3>Give words their voice.</h3>
                  <span>A shared rhythm from welcome to work.</span>
                </div>
                {(["headingFont", "bodyFont"] as const).map((key) => (
                  <label className="ap-select-control" key={key}>
                    {key === "headingFont" ? "Heading font" : "Body font"}
                    <select
                      aria-label={
                        key === "headingFont" ? "Heading font" : "Body font"
                      }
                      value={theme[key]}
                      onChange={(event) =>
                        change(
                          key,
                          event.target.value as PreviewTheme[typeof key],
                        )
                      }
                    >
                      {fontOptions.map((font) => (
                        <option key={font}>{font}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <Range
                  label="Body size"
                  value={theme.fontSize}
                  min={12}
                  max={18}
                  suffix="px"
                  onChange={(value) => change("fontSize", value)}
                />
                <Range
                  label="Heading weight"
                  value={theme.headingWeight}
                  min={400}
                  max={800}
                  step={100}
                  onChange={(value) => change("headingWeight", value)}
                />
                <Range
                  label="Letter spacing"
                  value={theme.tracking}
                  min={-0.04}
                  max={0.08}
                  step={0.01}
                  suffix="em"
                  onChange={(value) => change("tracking", value)}
                />
                <Range
                  label="Line height"
                  value={theme.lineHeight}
                  min={1.3}
                  max={1.8}
                  step={0.1}
                  onChange={(value) => change("lineHeight", value)}
                />
                <div className="ap-type-specimen">
                  <b>
                    A little structure.
                    <br />
                    Room to grow.
                  </b>
                  <p>
                    Bring your team’s work into focus. A clear view, a shared
                    direction, and a space that feels like yours.
                  </p>
                </div>
              </div>
            )}
            {section === "shape" && (
              <div className="ap-depth-controls">
                <div className="ap-section-intro">
                  <h3>A little depth. A lot of clarity.</h3>
                  <span>Keep the working surfaces readable.</span>
                  <p className="ap-depth-hint">
                    Applies to the top bar, floating summary, and glass sample.
                    Task cards stay crisp.
                  </p>
                </div>
                <Range
                  label="Corner radius"
                  value={theme.radius}
                  min={0}
                  max={24}
                  suffix="px"
                  onChange={(value) => change("radius", value)}
                />
                <Range
                  label="Shadow strength"
                  value={theme.shadow}
                  min={0}
                  max={30}
                  onChange={(value) => change("shadow", value)}
                />
                <Range
                  label="Surface opacity"
                  value={theme.glass}
                  min={20}
                  max={100}
                  suffix="%"
                  onChange={(value) => change("glass", value)}
                />
                <Range
                  label="Backdrop blur"
                  value={theme.blur}
                  min={0}
                  max={20}
                  suffix="px"
                  onChange={(value) => change("blur", value)}
                />
                <div className="ap-depth-stage">
                  <div className="ap-depth-backdrop" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="ap-depth-specimen">
                    <span>
                      <Palette size={24} />
                    </span>
                    <b>Space, with a softer edge.</b>
                    <p>
                      Adjust opacity and blur to see the shapes behind this
                      surface soften.
                    </p>
                  </div>
                </div>
                <p className="ap-depth-hint">
                  {theme.glass === 100
                    ? "At 100% opacity the backdrop is hidden. Lower opacity to reveal the blur."
                    : `${theme.glass}% opacity · ${theme.blur}px blur. The content stays sharp while the backdrop softens.`}
                </p>
              </div>
            )}
            <div className="ap-file-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={exportTheme}
                disabled={!theme.name.trim()}
              >
                <ArrowDownToLine size={14} />
                Export JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => importFile.current?.click()}
              >
                <ArrowUpFromLine size={14} />
                Import JSON
              </Button>
              <input
                ref={importFile}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                aria-label="Import preview theme JSON"
                onChange={(event) => {
                  void importTheme(event.target.files?.[0]);
                }}
              />
            </div>
            {!editor && (
              <button className="ap-load-draft" onClick={loadDraft}>
                Load saved preview draft
              </button>
            )}
          </fieldset>
          <footer className="ap-editor-footer">
            {editor && notice && <p role="status">{notice}</p>}
            {editor ? (
              editor.actions
            ) : (
              <>
                {notice && <p role="status">{notice}</p>}
                <div>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Undo theme change"
                    disabled={!history.length}
                    onClick={() => {
                      const previous = history.at(-1);
                      if (previous) {
                        setTheme(previous);
                        setHistory((items) => items.slice(0, -1));
                        setNotice("");
                      }
                    }}
                  >
                    <Undo2 size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Reset preview theme"
                    onClick={() => update(structuredClone(presets[0]))}
                  >
                    <RotateCcw size={16} />
                  </Button>
                  <Button
                    className="ap-save"
                    disabled={!theme.name.trim()}
                    onClick={() => {
                      void saveDraft();
                    }}
                  >
                    Save preview draft
                  </Button>
                </div>
                <small>
                  <ShieldCheck size={12} />
                  Global publishing will be limited to owners/admins.
                </small>
              </>
            )}
          </footer>
        </aside>
      </div>
      <Sheet
        open={Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
      >
        <SheetContent
          className={`appearance-preview ap-task-sheet ${fontClass}`}
          style={variables}
        >
          <SheetTitle>{selectedTask?.title}</SheetTitle>
          <SheetDescription>
            Sample task detail · design preview only
          </SheetDescription>
          {selectedTask && (
            <>
              <span className="ap-detail-status">
                {lanes[selectedTask.lane]}
              </span>
              <div className="ap-tags">
                {selectedTask.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <h3>Description</h3>
              <p>
                Build a calm, flexible workspace with readable surfaces and a
                theme that the team can make its own.
              </p>
              <h3>Checklist</h3>
              <div className="ap-detail-checks">
                {[
                  "Explore the visual direction",
                  "Define semantic theme tokens",
                  "Review light and dark variants",
                  "Connect global publishing",
                ].map((text, index) => (
                  <label key={text}>
                    <input type="checkbox" defaultChecked={index < 2} />
                    {text}
                  </label>
                ))}
              </div>
              <div className="ap-detail-owner">
                <span className="ap-avatar">{selectedTask.initials}</span>
                <div>
                  <b>Design team</b>
                  <small>Sample assignee</small>
                </div>
              </div>
              <Button onClick={() => setSelectedTask(null)}>
                Back to workspace preview
              </Button>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
