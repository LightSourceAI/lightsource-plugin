---
name: add-rfq-collaborator
description: Adds one or more team members as collaborators on an RFQ (sourcing project).
---

## Arguments

- RFQ — either its name (e.g. "Electronics Q1") or its ID. If a name is given, resolve it first.
- User(s) — name(s) or email address(es) of team members to add as collaborators.

## Steps

1. If given an RFQ name instead of an ID, resolve it using the RFQ name → ID lookup in `graphql-request`
2. For each user, search team members via `clientUserInfo.team.members(query: ...)` and collect `node.user.id`
3. If a search returns multiple results, pick the closest match by name/email. If ambiguous, ask the user.
4. Call `sourcingProjectCollaboratorAdd` with the RFQ ID and collected user IDs
5. Return a summary: which users were added and the RFQ ID

## Query references

### Search team members by name or email

```graphql
{
  clientUserInfo {
    team {
      members(query: "alice", first: 5) {
        edges {
          node {
            user {
              id
              emailAddress
              display
            }
          }
        }
      }
    }
  }
}
```

Use `node.user.id` as the collaborator ID. Search by partial name or email — e.g. `"alice"` or `"alice@example.com"`.

## Mutation reference

### Add collaborators to an RFQ

```graphql
mutation {
  sourcingProjectCollaboratorAdd(
    input: {
      id: "<rfq-id>"
      userIds: ["<user-id-1>", "<user-id-2>"]
    }
  ) {
    sourcingProject {
      id
    }
    collaboratorEdges {
      node {
        user {
          id
          display
          emailAddress
        }
      }
    }
  }
}
```

## Notes

- `clientUserInfo.team.members` only searches within the current user's team — cross-team users cannot be added this way
- If no results match, report clearly and do not proceed with the mutation
- Multiple users can be added in a single `sourcingProjectCollaboratorAdd` call — collect all IDs first, then call once
