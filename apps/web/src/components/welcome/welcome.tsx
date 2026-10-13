"use client";

import { useLayoutEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { GetStartedButton } from "./get-started-button";
import { initWelcomeMotion } from "./motion";
import { HeroMascot, SplashFruit } from "./yuzu-art";
import { LANES, TASKS } from "./example-board";
import "./welcome.css";

export function Welcome({ fontClassName }: { fontClassName: string }) {
  const root = useRef<HTMLDivElement>(null);
  // Layout effect, so GSAP undoes its pins and inline styles before React removes the page.
  useLayoutEffect(() => initWelcomeMotion(root.current!), []);

  return (
    <div ref={root} className={`yw ${fontClassName}`}>
      <a className="skip" href="#ready">
        Skip to Get Started
      </a>

      <div className="splash" id="splash" aria-hidden="true">
        <div className="sp-stage" id="spStage">
          <div className="sp-shadow" id="spShadow" />
          <div className="sp-word" id="spWord">
            <span className="sp-lt" id="spL0">
              y
            </span>
            <span className="sp-lt" id="spL1">
              u
            </span>
            <span className="sp-lt" id="spL2">
              <span id="spU">u</span>
              <span id="spZ">z</span>
            </span>
            <span className="sp-lt" id="spL3">
              u<i className="sp-base" id="spBase" />
            </span>
          </div>
          <div className="sp-pos" id="spPos">
            <div className="sp-fruit" id="spFruit">
              <SplashFruit />
            </div>
          </div>
        </div>
      </div>

      <header className="top" id="top">
        <div className="wrap">
          <Link className="logo" href="/welcome" aria-label="Yuzu">
            <Image
              src="/logo-animated.svg"
              width={38}
              height={38}
              alt=""
              unoptimized
              priority
            />
            <b>yuzu</b>
          </Link>
          <Link className="to-setup" href="/setup">
            Skip to setup
          </Link>
        </div>
      </header>

      <div className="rail-probe" id="railProbe" />
      <svg className="trail" id="trail" aria-hidden="true">
        <defs>
          <mask id="trailMask" maskUnits="userSpaceOnUse">
            <path
              id="trailReveal"
              fill="none"
              stroke="#fff"
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray="0 1"
            />
          </mask>
        </defs>
        <path
          id="trailPath"
          fill="none"
          stroke="#4D8DBA"
          strokeOpacity=".75"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="1 14"
          mask="url(#trailMask)"
        />
      </svg>

      <main>
        <section className="hero" aria-labelledby="hero-h">
          <div className="wrap">
            <div data-band>
              <h1 id="hero-h">
                <span className="ln">
                  <span>Don&apos;t just manage work.</span>
                </span>{" "}
                <span className="ln">
                  <span>Build the systems that run it.</span>
                </span>
              </h1>
              <p className="lede">
                Bring your team&apos;s tasks, conversations and decisions into
                one workspace. Shape boards around how you actually work, and
                run all of it on your own server.
              </p>
              <div className="cta">
                <a className="see" href="#see">
                  See how it works
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M6 13l6 6 6-6" />
                  </svg>
                </a>
              </div>
              <div className="fine">
                <span>
                  <i />
                  Open source
                </span>
                <span>
                  <i />
                  Self-hosted
                </span>
                <span>
                  <i />
                  Your data stays on your server
                </span>
              </div>
            </div>
            <div className="mascot-anchor" id="mAnchor" aria-hidden="true">
              <div className="m-fly" id="mFly">
                <div className="m-follow" id="mFollow">
                  <div className="m-land" id="mLand">
                    <HeroMascot />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="scene morph" id="see" aria-labelledby="morph-h">
          <div className="scene-in wrap" data-band>
            <div className="sh">
              <h2 id="morph-h">One list. Two ways to look at it.</h2>
              <div>
                <p>
                  Every board is a table you can sort and a Kanban you can drag.
                  Same tasks, same fields, whichever view you open.
                </p>
                <div className="toggle" role="group" aria-label="Example view">
                  <button type="button" data-mode="table" aria-pressed="true">
                    Table
                  </button>
                  <button type="button" data-mode="kanban" aria-pressed="false">
                    Kanban
                  </button>
                </div>
              </div>
            </div>
            <div className="stage" id="stage">
              <span className="tag">Example board, not saved</span>
              <div className="stage-in" id="stageIn">
                <div className="thead">
                  <span>Task</span>
                  <span>Status</span>
                  <span>Person</span>
                  <span>Due</span>
                </div>
                {LANES.map((lane) => (
                  <div
                    key={lane.key}
                    className="lanebg"
                    data-k={lane.key}
                    style={{ background: lane.tint }}
                  >
                    <h3>
                      <i style={{ background: lane.color }} />
                      {lane.name}
                    </h3>
                  </div>
                ))}
                {TASKS.map((task) => {
                  const lane = LANES.find((l) => l.key === task.status)!;
                  const avatar = (
                    <span className={`av ${task.person.tone}`}>
                      {task.person.initials}
                    </span>
                  );
                  return (
                    <div key={task.name} className="item">
                      <div className="rowv">
                        <span className="nm">{task.name}</span>
                        <span className={`pill s-${task.status}`}>
                          <i />
                          {lane.name}
                        </span>
                        <span className="per">
                          {avatar}
                          {task.person.name}
                        </span>
                        <span className="due">{task.due}</span>
                      </div>
                      <div className="cardv">
                        <span className="nm">{task.name}</span>
                        <span className="mt">
                          <span className="due">{task.due}</span>
                          {avatar}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="scene gate" id="gate" aria-labelledby="gate-h">
          <div className="scene-in wrap" data-band>
            <div className="sh">
              <h2 id="gate-h">Some changes should wait for a yes.</h2>
              <p>
                Turn on approvals for the fields that matter. Edits to them wait
                for an approver, and the board keeps showing what&apos;s true
                right now.
              </p>
            </div>
            <div className="gate-grid">
              <ol className="beats">
                <li>
                  <div>
                    <b>Sarah moves a card to Done</b>
                    <span>
                      Status needs approval on this board, so the move becomes a
                      request.
                    </span>
                  </div>
                </li>
                <li>
                  <div>
                    <b>The card stays where it is</b>
                    <span>
                      It&apos;s marked as waiting, and Mia gets the request with
                      both values side by side.
                    </span>
                  </div>
                </li>
                <li>
                  <div>
                    <b>Mia approves, then it moves</b>
                    <span>
                      The change applies and lands in the task&apos;s history.
                      Nobody can approve their own request.
                    </span>
                  </div>
                </li>
              </ol>
              <div className="gstage" aria-hidden="true">
                <div className="glane l">
                  <b>
                    <i style={{ background: "var(--st-review)" }} />
                    In review
                  </b>
                </div>
                <div className="glane r">
                  <b>
                    <i style={{ background: "var(--st-done)" }} />
                    Done
                  </b>
                </div>
                <div className="gghost" id="ghost">
                  Proposed: lands here once approved
                </div>
                <div className="gcard" id="gcard">
                  <div className="nm">Kanban keyboard moves</div>
                  <div className="mt">
                    Frontend, due Oct 18<span className="av a2">SC</span>
                  </div>
                  <div className="gtape" id="gtape">
                    <span className="bgok" />
                    <span className="no">Move to Done waiting for Mia</span>
                    <span className="yes">Approved by Mia</span>
                  </div>
                </div>
                <div className="req" id="req">
                  <div className="h">
                    <span className="av a3">MR</span>
                    <b>Approval request</b>
                  </div>
                  <div className="d">
                    Status <s>In review</s> to <b>Done</b>
                  </div>
                  <div className="acts">
                    <span>Reject</span>
                    <span className="ok" id="okBtn">
                      Approve
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="scene yours" aria-labelledby="yours-h">
          <div className="scene-in wrap" data-band>
            <h2 id="yours-h">
              Make it fit your team, not the other way around.
            </h2>
            <div className="two">
              <div className="panel">
                <h3>Fields you name yourself</h3>
                <p>
                  Add the columns your work needs. Every field shows up in the
                  table, on cards and in filters.
                </p>
                <div className="fields">
                  {[
                    ["Estimate", "hours"],
                    ["Sprint", "choice"],
                    ["Budget", "number"],
                    ["Customer", "text"],
                    ["Spec", "link"],
                    ["Launch", "date"],
                  ].map(([name, kind]) => (
                    <span key={name}>
                      {name} <em>{kind}</em>
                    </span>
                  ))}
                  <span className="add">Add field</span>
                </div>
              </div>
              <div className="panel dark">
                <h3>Runs where you run things</h3>
                <p>
                  Yuzu is open source. Host it on your own hardware or cloud,
                  and keep tasks, files and history under your control.
                </p>
                <pre>
                  <span className="c"># on your server</span>
                  {
                    "\ngit clone https://github.com/amabee/Yuzu\ncd Yuzu && docker compose up -d"
                  }
                </pre>
              </div>
            </div>
            <p className="later">
              Coming after 1.0: automations, templates and more views.
              They&apos;re on the roadmap, not in this release.
            </p>
          </div>
        </section>

        <section className="ready" id="ready" aria-labelledby="ready-h">
          <div className="wrap" data-band>
            <h2 id="ready-h">Ready when you are.</h2>
            <p>
              Setup takes a few steps: your owner account, this
              installation&apos;s name and timezone, email delivery, then your
              first workspace and board.
            </p>
            <GetStartedButton />
            <p className="note">
              Board editing, collaboration, and approvals become available as
              their milestones are completed. Setup creates the starting
              structure.
            </p>
          </div>
          <div className="land" id="mLandSpot" aria-hidden="true" />
        </section>
      </main>
    </div>
  );
}
