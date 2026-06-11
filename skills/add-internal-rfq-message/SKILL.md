---
name: add-internal-rfq-message
description: Adds a message to the internal (team-only) message thread of an RFQ (sourcing project).
---

## Arguments

- RFQ — either its name (e.g. "Electronics Q1") or its ID. If a name is given, resolve it first.
- Message content — the text of the message to post

## Steps

1. If given a name instead of an ID, resolve it using the RFQ name → ID lookup in `graphql-request`
2. Call `sourcingProjectAddInternalMessageThreadMessage` with the resolved project ID and message content
3. Return the message ID and updated thread item count

## Mutation reference

### Add an internal message

```graphql
mutation {
  sourcingProjectAddInternalMessageThreadMessage(
    input: {
      sourcingProjectId: "<rfq-id>"
      contents: "Your message here"
      attachments: []
    }
  ) {
    messageThread {
      id
      itemCount
    }
    messageEdge {
      node {
        id
      }
    }
  }
}
```

### Read existing internal thread messages (optional)

```graphql
{
  sourcingProject(id: "<rfq-id>") {
    teamInternalMessageThread {
      id
      itemCount
      items(first: 20) {
        edges {
          node {
            id
            timestamp
            inner {
              ... on MessageThreadMessage {
                contents
              }
            }
          }
        }
      }
    }
  }
}
```

## Notes

- `attachments` is required — pass an empty list `[]` if there are no attachments
- This posts to the **internal** (team-only) thread, not to supplier-facing threads
- The returned `messageThread.id` can be used with `messageThread(id: ...)` for subsequent queries
