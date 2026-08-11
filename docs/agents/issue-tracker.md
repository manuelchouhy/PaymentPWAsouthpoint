# Issue tracker: Local Markdown + Zoho Projects

## Primary: Local Markdown

Issues y PRDs técnicos para este repo viven como archivos markdown en `.scratch/`.

### Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

### When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

### When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Secondary: Zoho Projects

High-level, non-technical tasks are tracked in Zoho Projects via the MCP server. Use Zoho Projects for:

- Registering milestones and high-level deliverables
- Tracking progress visible to stakeholders
- Task summaries that don't need implementation detail

When creating a Zoho task, keep the description at a business/product level. The detailed technical breakdown lives in `.scratch/`.
