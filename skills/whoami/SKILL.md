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

If the API key is missing or invalid, tell the user to check their plugin config (`/plugin config lightsource`) or set `$LIGHTSOURCE_API_KEY`.
