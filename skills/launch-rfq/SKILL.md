---
name: launch-rfq
description: Fire-and-forget pipeline that creates an RFQ (request for quote), adds all parts from a file, assigns relevant suppliers, adds a collaborator, and posts an internal team notification — no human-in-the-loop.
---

## Arguments

- RFQ name / title (required)
- Input file with the parts list (required) — an attachment from the conversation or a path on disk
- Collaborator name or email (optional) — team member to add as a collaborator; skip Phase 4 if not provided
- Suppliers (optional) — skip Phase 3 if not provided
- Internal message (optional) — custom message text; if provided, use it verbatim instead of the default summary

## Steps

Execute each phase in sequence without pausing for feedback.

### Phase 1 — Create RFQ

Call `createSourcingProject` with `options.title` set to the RFQ name from arguments.
Capture the returned RFQ ID for subsequent phases.
Construct the RFQ URL as: `https://app.lightsource.ai/source/sp/<id>/overview`

```graphql
mutation {
  createSourcingProject(input: { options: { title: "My RFQ" } }) {
    sourcingProject {
      id
      latestRevision {
        title
      }
    }
  }
}
```

### Phase 2 — Add items

Follow the `add-items-ai-ingestion` skill instructions using the input file from arguments and the RFQ ID from Phase 1.
The AI ingestion skill will upload the file, extract parts, approve them, and add them to the RFQ.
Capture the part count and categories from its output.

### Phase 3 — Assign suppliers

Skip this phase if no suppliers argument was provided.
Otherwise, follow the `assign-suppliers-to-rfq` skill instructions using the RFQ ID from Phase 1.

### Phase 4 — Add collaborator

Skip this phase if no collaborator argument was provided.
Otherwise, follow the `add-rfq-collaborator` skill instructions using the RFQ ID from Phase 1 and the collaborator argument.

### Phase 5 — Notify team via internal message

Follow the `add-internal-rfq-message` skill instructions using the RFQ ID from Phase 1.
If a custom internal message was provided as an argument, use it verbatim.
Otherwise, generate a message that summarizes what was set up, for example:

> "RFQ '<title>' has been created and populated with <N> parts across <categories>. <N> suppliers have been assigned. <Collaborator name> has been added as a collaborator."

## Final output

Return a single consolidated summary:

- RFQ ID and URL
- Number of parts added
- List of parts with their categories
- Number of suppliers assigned
- Which suppliers were matched to which categories
- Any categories for which no suppliers were found
- Collaborator added
- Internal message sent (yes/no)

## Notes

- Do not ask for confirmation between phases
- Do not stop on non-critical failures (e.g. a category with no matching suppliers, collaborator not found) — log and continue
- Phases 3 and 4 are optional — skip them entirely if the corresponding arguments are not provided
- If Phase 1 or Phase 2 fails entirely, stop and report the error clearly
- **Scope:** This skill creates and fully populates an RFQ (title, parts, suppliers). The final step of transmitting the RFQ to suppliers is outside the scope of this skill and must be performed by the user in the LightSource UI.
