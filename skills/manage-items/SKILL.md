---
name: manage-items
description: Search, update, archive, delete, and attach files to items (parts) in LightSource. Use for one-off item operations; for bulk creates/updates use the item-sync skill instead.
---

## Arguments

- Operation — one of: `search`, `update`, `archive`, `delete`, `attach-file`
- Item ID or search query — depending on operation
- Additional fields depending on operation (see each section below)

---

## Search items

```graphql
query ItemSearch($query: String!, $first: Int!) {
  partSearch(query: $query, first: $first) {
    edges {
      node {
        id
        externalId
        latestRevision {
          id
          generation
          name
          num
          quantityPreferredUnit
          customProperties(first: 20) {
            edges {
              node {
                metadata { name id }
                visibility
                numberValue
                stringValue
                userValue { id emailAddress }
              }
            }
          }
        }
      }
    }
  }
}
```

Variables: `{ "query": "<search-term>", "first": 15 }`

Returns `latestRevision.id` and `generation` — both are needed for update operations.

---

## Update item fields or custom properties

```graphql
mutation ItemUpdate($input: BatchUpdatePartsInput!) {
  updateParts(input: $input) {
    parts {
      id
      latestRevision { name num }
    }
  }
}
```

Variables:
```json
{
  "input": {
    "options": [
      {
        "partRevisionId": "<latestRevision.id>",
        "partRevisionGeneration": 0,
        "updateOption": {
          "finalizeRevision": false,
          "customProperties": [
            {
              "metadataId": "<custom-property-metadata-id>",
              "stringValue": "value",
              "visibility": "INTERNAL"
            }
          ]
        }
      }
    ]
  }
}
```

- `partRevisionId` and `partRevisionGeneration` come from `partSearch` → `latestRevision`
- `visibility` options: `INTERNAL` (team-only), `SUPPLIERS` (visible to assigned suppliers)
- For number-type custom properties use `numberValue`; for user-type use `userValue`
- Set `finalizeRevision: true` to seal the current revision and create a new one in history

## Update item metadata (category or external ID)

```graphql
mutation ItemMetadataUpdate($input: PartMetadataBatchUpdateInput!) {
  partUpdateMetadataBatch(input: $input) {
    parts {
      id
      externalId
      latestRevision { name num }
    }
  }
}
```

Variables:
```json
{
  "input": {
    "updates": [
      { "partId": "<part-id>", "externalId": "new-external-id" }
    ]
  }
}
```

---

## Attach a file to an item

### Step 1 — Upload the file

Follow the file upload procedure in `graphql-request` (prepare → PUT → finalize). Capture the returned `userFile.id`.

### Step 2 — Attach file to item

```graphql
mutation AttachFile($input: BatchUpdatePartsInput!) {
  updateParts(input: $input) {
    parts {
      id
      latestRevision {
        files { edges { node { id name } } }
      }
    }
  }
}
```

Variables:
```json
{
  "input": {
    "options": [
      {
        "partRevisionId": "<latestRevision.id>",
        "partRevisionGeneration": 0,
        "updateOption": {
          "addFiles": ["<userFile.id>"],
          "removeFiles": []
        }
      }
    ]
  }
}
```

---

## Archive an item

```graphql
mutation ArchiveItem($itemID: ID!) {
  partUpdateMetadata(input: { partId: $itemID, archived: true }) {
    part { id }
  }
}
```

Variables: `{ "itemID": "<part-id>" }`

---

## Delete an item

```graphql
mutation DeleteItem($itemID: ID!) {
  partDelete(input: { partId: $itemID }) {
    deletedPartId
  }
}
```

Variables: `{ "itemID": "<part-id>" }`

Returns an error if the item is referenced by a sourcing project or RFI — archive instead if deletion is blocked.

---

## Notes

- `partSearch` uses fuzzy matching — if you have the `Part.id`, use `part(id: "...")` to fetch `latestRevision.id` directly and avoid wrong matches
- `partRevisionGeneration` is required for update mutations — always fetch it from `partSearch` first
- The same `UserFile` can be attached to multiple items — reuse `userFile.id` without re-uploading
- Prefer `archive` over `delete` if the item might be referenced elsewhere
