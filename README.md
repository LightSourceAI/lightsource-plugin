# LightSource for Claude Code

Automate sourcing workflows in LightSource directly from Claude Code: create RFQs, run AI award optimization, sync parts and BOMs, and manage suppliers.

## Prerequisites

- [Claude Code](https://claude.ai/code) installed
- A LightSource account with an API key — get one at **Settings → API Keys** in the app

## Installation

**Step 1 — Add the LightSource marketplace** (one-time per machine):

```
/plugin marketplace add LightSourceAI/claude-plugin
```

**Step 2 — Install the plugin**:

```
/plugin install @lightsource:lightsource
```

**Step 3 — Enter your API key**:

Claude Code will prompt you for your API key when the plugin is enabled. Get one from **Settings → API Keys** in the LightSource app.

Alternatively, set it as an environment variable (useful for CI or scripted setups):

```bash
export LIGHTSOURCE_API_KEY="your_api_key_here"
```

## Skills

Skills are invoked as `/lightsource:<skill-name>` in Claude Code.

### Sourcing (RFQ)

| Skill                                   | Description                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/lightsource:launch-rfq`               | Full pipeline: create an RFQ, add parts from a file, assign suppliers, add a collaborator, and post an internal team message |
| `/lightsource:add-items-to-rfq`         | Add parts to an existing RFQ from a file or by part name/number                                                              |
| `/lightsource:add-items-ai-ingestion`   | Use the AI ingestion pipeline to extract and add parts from one or more files                                                |
| `/lightsource:assign-suppliers-to-rfq`  | Assign relevant suppliers to an RFQ based on part categories                                                                 |
| `/lightsource:optimize-rfq-award`       | Trigger AI award optimization, poll until ready, then approve to create an award scenario                                    |
| `/lightsource:add-internal-rfq-message` | Post a message to the internal (team-only) thread of an RFQ                                                                  |
| `/lightsource:add-rfq-collaborator`     | Add one or more team members as collaborators on an RFQ                                                                      |

### Parts & BOMs

| Skill                       | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| `/lightsource:manage-items` | Search, update, archive, delete, and attach files to individual parts |

### Suppliers

| Skill                           | Description                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| `/lightsource:manage-suppliers` | Query, update, and manage supplier companies and contacts in your rolodex |

### API (advanced)

| Skill                          | Description                                                              |
| ------------------------------ | ------------------------------------------------------------------------ |
| `/lightsource:graphql-request` | Execute a GraphQL query or mutation directly against the LightSource API |

## Support

Questions or issues? Contact [support@lightsource.ai](mailto:support@lightsource.ai).
