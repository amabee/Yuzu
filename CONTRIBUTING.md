# Contributing to Yuzu

First off, thank you for your interest in contributing to **Yuzu**! 🍋

Yuzu is an open-source work management platform aiming to help teams organize projects, collaborate, automate workflows, and eventually build the internal systems that run their businesses.

Yuzu is still in early development. This guide will evolve as the project and its tooling mature.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Making changes](#making-changes)
- [Code and design guidelines](#code-and-design-guidelines)
- [Testing](#testing)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Security issues](#security-issues)
- [Licensing and contributions](#licensing-and-contributions)

## Code of conduct

Be respectful, constructive, and welcoming. Critique ideas and code, not people. Harassment, discrimination, personal attacks, and disruptive behavior are not acceptable.

Until a formal Code of Conduct is adopted, please follow these expectations in all project spaces, including issues, pull requests, and discussions.

## Ways to contribute

You can help Yuzu by:

- Reporting reproducible bugs.
- Suggesting and discussing features.
- Improving documentation and examples.
- Fixing bugs or implementing approved features.
- Improving accessibility, usability, and responsive behavior.
- Adding or improving tests.
- Reviewing pull requests.
- Helping with deployment instructions and developer experience.

For larger changes, open an issue or discussion first so we can agree on the scope and approach before you spend time implementing it.

## Before you start

1. Search existing issues and pull requests to see whether the topic has already been reported or discussed.
2. For a significant change, open an issue describing the problem, proposed solution, and alternatives.
3. Check the project roadmap and current project status in `README.md`.
4. Keep contributions focused. Smaller pull requests are generally easier to review.

Yuzu's planned technology stack includes Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma, and pnpm. Some choices or commands may change while the project is under development.

## Development setup

Yuzu's development setup is still being finalized. Once the repository includes a runnable application, the README will provide the current setup instructions.

In general, you should expect to:

1. Install a supported Node.js version and pnpm.
2. Fork the repository and clone your fork.
3. Install dependencies using the repository's documented command.
4. Configure local environment variables using the example environment file, if provided.
5. Start required services, such as PostgreSQL, using the documented local setup.
6. Apply database migrations and start the development server using the documented scripts.

**Do not guess at missing commands.** If the setup instructions are incomplete, open an issue or ask in a discussion so the project can document the correct process.

Never commit real credentials, tokens, private keys, production database dumps, or `.env` files containing secrets. Use example values in `.env.example`.

## Making changes

A typical contribution workflow looks like this:

1. Create a branch from the default branch.
2. Make one focused change.
3. Add or update tests where appropriate.
4. Run the relevant checks.
5. Update documentation if the change affects behavior, configuration, API responses, or setup.
6. Commit your changes and push your branch to your fork.
7. Open a pull request using the project template, if one is available.

Suggested branch names:

- `feat/short-description`
- `fix/short-description`
- `docs/short-description`
- `refactor/short-description`
- `test/short-description`

Do not include unrelated formatting changes or refactors in a bug fix unless they are necessary.

## Code and design guidelines

### General

- Prefer clear, readable, maintainable code over clever shortcuts.
- Use TypeScript types deliberately; avoid `any` unless there is a clear reason.
- Validate untrusted input at application boundaries.
- Handle errors explicitly and return helpful, consistent messages.
- Keep business logic in application or domain services rather than UI components or HTTP route handlers.
- Keep modules cohesive and avoid unnecessary abstractions.
- Never commit generated secrets or personal data.

### Database and API

- Use Prisma and the project's existing database conventions.
- Include migrations for schema changes and explain any operational impact.
- Consider transactions when a change updates multiple related records.
- Enforce authorization on the server for every protected operation. Hiding a button in the UI is not authorization.
- Keep REST API responses and validation errors consistent with existing conventions.
- Avoid breaking API changes unless they have been discussed and approved.
- Treat uploaded files, webhook payloads, and external API responses as untrusted input.

### UI and accessibility

- Follow the existing Yuzu design system and component patterns.
- Prefer reusable components when they provide genuine consistency.
- Ensure interactive controls have accessible labels, keyboard support, and visible focus states.
- Design for loading, empty, success, and error states—not only the happy path.
- Keep layouts usable on smaller screens.
- Avoid introducing visual styles or dependencies that conflict with established project conventions.
- Do not add new dependencies without a clear benefit.

### Automation and integrations

- Workflow actions must use approved, validated actions.
- Do not introduce unrestricted execution of arbitrary user-provided code.
- Consider retries, duplicate execution, rate limits, permissions, and auditability.
- Never log secrets or sensitive payloads.

## Testing

Add or update tests for behavior you change, especially around permissions, data validation, database operations, API endpoints, and workflow execution.

Before opening a pull request, run the checks supported by the repository. These may include:

- Linting
- Type checking
- Unit tests
- Integration tests
- Production build

Use the actual scripts documented in `package.json` or the repository documentation. In your pull request, list the commands you ran and whether they passed. If you could not run a check, explain why.

For authorization-sensitive changes, include tests for both allowed and denied access. Never rely solely on frontend tests for server-side security.

## Commit messages

Use short, descriptive commit messages. Conventional Commit-style prefixes are encouraged:

- `feat: add board filtering`
- `fix: enforce item permissions`
- `docs: clarify local setup`
- `test: cover invitation expiry`
- `refactor: extract board service`
- `chore: update dependencies`

This convention is recommended, not currently enforced unless repository tooling says otherwise.

## Pull requests

A good pull request should:

- Explain the problem and why the change is needed.
- Summarize the implementation.
- Link related issues using GitHub keywords where applicable (for example, `Closes #123`).
- Include tests and their results.
- Include screenshots or a short recording for meaningful UI changes.
- Document database migrations, configuration changes, and API changes.
- Call out trade-offs, limitations, and follow-up work.

Before submitting, check that:

- [ ] The change is focused and matches the agreed scope.
- [ ] Tests and relevant checks have been run, or limitations are explained.
- [ ] Documentation is updated where needed.
- [ ] No secrets, credentials, or private data are included.
- [ ] The change does not bypass server-side authorization.
- [ ] Accessibility and error states have been considered.

Maintainers may request changes, defer a contribution, or close a pull request that is out of scope. Please be open to feedback and keep discussion respectful.

## Reporting bugs

When opening a bug report, include as much of the following as is safe and relevant:

- A clear, descriptive title.
- Steps to reproduce the issue.
- Expected behavior and actual behavior.
- Relevant error messages or logs with secrets removed.
- Browser, operating system, and runtime versions where relevant.
- Whether the issue happens consistently or intermittently.

Please check for existing reports first. Do not include passwords, API keys, session cookies, customer data, or other sensitive information.

## Suggesting features

Feature suggestions are most useful when they explain:

- The problem or user need.
- Who experiences the problem.
- The proposed behavior.
- Alternative approaches you considered.
- Any security, privacy, permission, or migration implications.

Large features—especially new automation capabilities, integrations, data model changes, and extension points—should be discussed before implementation.

## Security issues

**Do not report exploitable security vulnerabilities in public issues or pull requests.**

Until the project publishes a dedicated security policy and private reporting process, contact the repository owner privately through GitHub. Share only the information needed to explain the issue, and avoid including real user data or production secrets.

Please do not test against systems or deployments you do not own or have explicit permission to assess.

## Licensing and contributions

Yuzu is intended to use the **GNU Affero General Public License v3.0 (AGPL-3.0)** for its community edition, subject to confirmation in the repository's `LICENSE` file.

By submitting a contribution, you agree that:

- You have the right to submit the contribution.
- Your contribution does not knowingly violate another person's rights or license terms.
- You identify relevant third-party code, assets, or dependencies and their licenses.
- You do not include confidential code, secrets, or material you are not authorized to publish.

Unless a separate written agreement says otherwise, contributions submitted to this repository are made under the license that applies to the relevant project files.

**Commercial relicensing note:** Yuzu may offer a separate commercial license in the future. The project must establish an appropriate contributor agreement or obtain other necessary rights before relicensing third-party contributions. Do not assume that contributing code automatically transfers copyright to the project owner or grants rights beyond the applicable license.

The license in the repository and any signed contributor agreement take precedence over this summary. If the licensing documents have not yet been added or finalized, please confirm them with the maintainers before contributing.

## Thank you

Every useful bug report, thoughtful discussion, documentation fix, test, and code contribution helps Yuzu improve.

Thanks for helping build a more flexible, open way to manage work.

**Yuzu — Don't just manage work. Build the systems that run it.**