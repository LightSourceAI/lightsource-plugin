---
description: Show the current LightSource user and active team tied to the configured API key.
---

Query the LightSource API and display:
- The current user's name and email address
- The active team name and namespace

```graphql
query WhoAmI {
  session {
    currentUser {
      display
      emailAddress
    }
    currentTeam {
      displayName
      namespace
    }
  }
}
```

Execute this via the graphql-request skill. Present the result clearly, e.g.:

> **Logged in as:** Jane Smith (jane@example.com)
> **Active team:** Acme Corp (`acme`)

This is also the credential check: if the key is missing or rejected, say so and relay the setup instructions from `graphql-request`, which owns credential handling.
