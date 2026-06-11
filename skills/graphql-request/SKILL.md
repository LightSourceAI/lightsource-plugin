---
name: graphql-request
description: Executes a GraphQL query or mutation against the LightSource API. Handles endpoint selection and authentication. All other skills should delegate API calls through this skill.
---

## Goal

Send a GraphQL request to the LightSource API and return the response.

## Endpoint

| GraphQL endpoint                     | API key source                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `https://api.lightsource.ai/graphql` | **Claude Code:** plugin config stores the key in `~/.claude/.credentials.json`; the harness injects it as `$CLAUDE_PLUGIN_OPTION_API_KEY` in skill scripts, otherwise read it directly from the file. **Claude Desktop / manual:** set `$LIGHTSOURCE_API_KEY` as an environment variable. |

## How to use from another skill

Instead of hardcoding a curl command, describe the GraphQL operation needed and note:

> "Execute this via the graphql-request skill."

## Execution

Use GraphQL variables instead of string interpolation to avoid JSON escaping issues, especially when passing arrays or user-provided strings:

```bash
# $CLAUDE_PLUGIN_OPTION_API_KEY is injected by the harness from ~/.claude/.credentials.json
# when running inside a skill script. For direct Bash tool calls, read it from the file.
LS_API_KEY="${CLAUDE_PLUGIN_OPTION_API_KEY:-$LIGHTSOURCE_API_KEY}"
if [ -z "$LS_API_KEY" ]; then
  LS_API_KEY=$(jq -r '.pluginSecrets["lightsource@lightsource"].api_key' "$HOME/.claude/.credentials.json")
fi
curl -s -X POST https://api.lightsource.ai/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LS_API_KEY" \
  -d '{"query": "mutation Foo($id: ID!) { ... }", "variables": {"id": "..."}}'
```

- Always check the response for a top-level `errors` array — if present, report the errors and do not proceed as if the call succeeded
- Store the presigned upload URL in a shell variable immediately after receiving it — never copy-paste it manually, as special characters will be mangled

## Common lookups

### Resolve an RFQ name → ID

Used by any skill that accepts an RFQ name or ID. If given a name, run this first and use the returned `id` for all subsequent calls. Pick the closest match by title if multiple results are returned; confirm with the user if ambiguous.

```graphql
{
  sourcingProjectSearch(query: "<name>", first: 5) {
    edges {
      node {
        id
        latestRevision {
          title
        }
      }
    }
  }
}
```

## File upload procedure

Used whenever a file must be uploaded to LightSource before being attached to an item, ingestion batch, or sync transaction.

### Step 1 — Prepare upload

```graphql
mutation {
  userFilePrepareUpload(input: { mimeType: "<mime-type>" }) {
    uploadUrl
    pendingUpload {
      id
    }
  }
}
```

Capture `uploadUrl` and `pendingUpload.id`.

### Step 2 — PUT file to upload URL

```bash
curl -s -X PUT "<uploadUrl>" \
  -H "Content-Type: <mime-type>" \
  --data-binary @"<local-file-path>"
```

No `Authorization` header — the URL is presigned.

### Step 3 — Finalize upload

```graphql
mutation {
  userFileFinalizeUpload(
    input: {
      fileId: "<pendingUpload.id>"
      fileName: "<display-name>"
      accessLevel: PRIVATE
    }
  ) {
    pendingUpload {
      status
      userFile {
        id
      }
    }
  }
}
```

`accessLevel` options: `PRIVATE` (team-only), `PUBLIC_LIGHTSOURCE` (visible to connected teams), `PUBLIC_INTERNET`. Check `status` — if not `COMPLETE`, report the error and stop. The returned `userFile.id` is used by other mutations to reference the uploaded file.
