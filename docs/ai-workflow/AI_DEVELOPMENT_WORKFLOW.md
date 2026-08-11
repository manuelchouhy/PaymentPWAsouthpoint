# AI Development Workflow

## 1. Alignment / Grill Me

Before implementation, Claude must interview the developer about the requested change.

The goal is to eliminate ambiguity before writing code.

Claude must clarify:

- Product goal
- Users affected
- Current behavior
- Desired behavior
- Data dependencies
- DOMO constraints
- Firebase or Azure backend target
- Edge cases
- Testing strategy
- Deployment risks
- Acceptance criteria

Claude must not write code during this phase.

## 2. PRD

After alignment, Claude creates or updates a PRD.

The PRD must include:

- Problem statement
- Goals
- Non-goals
- User stories
- Functional requirements
- Technical requirements
- Data requirements
- Testing requirements
- Acceptance criteria
- Risks
- Open questions

## 3. Vertical Slice Planning

Claude must break the PRD into independently testable vertical slices.

Prefer slices that cross UI, backend, data, and tests when relevant.

Avoid splitting work only into horizontal layers like:

- Database only
- API only
- UI only

unless there is a strong reason.

Each slice must fit in a small, reviewable PR (target ≤ ~400 lines of change). If a slice is larger, split it; when slices depend on each other, chain them as stacked PRs.

## 4. Zoho Task Formatting

Each task must be ready to copy into Zoho Projects.

Each task must include:

- Title
- Description
- Acceptance criteria
- Dependencies
- Test plan
- Deployment target
- Estimated complexity
- Affected area: DOMO, Firebase, Azure, Playwright, docs, config

## 5. Implementation

Claude must implement one selected vertical slice at a time.

Rules:

- Read the PRD first.
- Read the selected task first.
- Use TDD when practical.
- Add or update Playwright tests for UI behavior changes.
- Keep changes focused.
- Do not touch unrelated files.
- Do not deploy.

## 6. QA

Before marking work complete, Claude must run or propose:

- Unit tests
- Type checks
- Lint checks
- Playwright tests
- Manual QA checklist

If tests cannot be run, Claude must explain why.

## 7. Clean-Context Review

For important changes, a second review must be performed from a clean context.

Run this as a loop via `/review-loop`: `/code-review` → fix real findings → re-review, repeating until no medium/high-severity findings remain (or a 5-turn cap).

The reviewer must check:

- Requirements coverage
- Bugs
- Security risks
- Deployment risks
- Test gaps
- Overengineering
- DOMO/Firebase/Azure constraints

## 8. Human Approval

Human approval is required before:

- Deploying to DOMO
- Deploying Firebase Functions
- Deploying Azure backend changes
- Changing production config
- Changing secrets
- Changing Firestore rules or indexes
- Changing auth, permissions, or external integrations