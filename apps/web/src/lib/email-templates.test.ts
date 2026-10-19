import { describe, expect, it } from "vitest";
import {
  digestEmail,
  escapeHtml,
  instantEmail,
  instantSubject,
  ruleEmail,
} from "./email-templates";

const links = {
  origin: "https://yuzu.example.com",
  settingsUrl: "https://yuzu.example.com/settings/notifications",
  unsubscribeUrl: "https://yuzu.example.com/api/v1/email/unsubscribe?t=abc",
  reason: "You get these instantly for assignments.",
  unsubscribeLabel: "Unsubscribe from assignment emails",
};

describe("notification emails", () => {
  it("writes short subjects per kind", () => {
    expect(
      instantSubject({
        kind: "ASSIGNMENT",
        actorName: "Mia Santos",
        message: "assigned you to this task",
        taskName: "Checkout redesign",
      }),
    ).toBe("Mia assigned you: Checkout redesign");
    expect(
      instantSubject({
        kind: "AUTOMATION",
        actorName: "Mia",
        message: "Checkout redesign just shipped 🎉",
        taskName: "Checkout redesign",
      }),
    ).toBe("Checkout redesign just shipped 🎉");
  });

  it("escapes everything people typed and keeps a plain-text twin", () => {
    const email = instantEmail(
      {
        appName: "Yuzu",
        kind: "ASSIGNMENT",
        actorName: "Mia <script>",
        message: "assigned you to this task",
        taskName: 'Fix "quotes" & <b>tags</b>',
        boardName: "Q4 Launch",
        projectName: null,
        taskUrl: "https://yuzu.example.com/boards/b?task=t",
        details: { status: "In progress", due: "Oct 24" },
      },
      links,
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain(
      "Fix &quot;quotes&quot; &amp; &lt;b&gt;tags&lt;/b&gt;",
    );
    expect(email.html).toContain(
      "https://yuzu.example.com/email/yuzu-logo.png",
    );
    expect(email.text).toContain(
      "Open the task: https://yuzu.example.com/boards/b?task=t",
    );
    expect(email.text).toContain("Unsubscribe from assignment emails:");
    expect(escapeHtml(`'`)).toBe("&#39;");
  });

  it("counts and groups the digest", () => {
    const email = digestEmail(
      {
        appName: "Yuzu",
        firstName: "John",
        greeting: "Good morning",
        appUrl: "https://yuzu.example.com/",
        groups: [
          {
            board: "Q4 Launch",
            items: [
              {
                kind: "MENTION",
                line: "Riley mentioned you on Pricing page",
                meta: "11:20",
              },
              {
                kind: "AUTOMATION",
                line: "Launch post just shipped",
                meta: "16:05",
              },
            ],
          },
        ],
      },
      links,
    );
    expect(email.subject).toBe("2 updates on Yuzu today");
    expect(email.text).toContain(
      "Q4 Launch\n- Riley mentioned you on Pricing page (11:20)",
    );
  });

  it("sends a rule's own subject and message", () => {
    const email = ruleEmail(
      {
        appName: "Yuzu",
        subject: "Heads up: Pricing page is due Oct 24",
        message: "Pricing page is due Oct 24",
        ruleName: "Due reminder",
        taskName: "Pricing page",
        taskUrl: "https://yuzu.example.com/boards/b?task=t",
      },
      links,
    );
    expect(email.subject).toBe("Heads up: Pricing page is due Oct 24");
    expect(email.html).toContain("From the “Due reminder” rule");
  });
});
