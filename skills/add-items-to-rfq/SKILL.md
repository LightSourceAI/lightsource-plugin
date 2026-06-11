---
name: add-items-to-rfq
description: Creates parts from an input file and adds them to an existing RFQ (request for quote).
---

## Arguments

- RFQ — either its name (e.g. "Test") or its ID. If a name is given, resolve it first using the RFQ name → ID lookup in `graphql-request`.
- One of:
  - Input file path with new parts to create (creates parts then adds them)
  - Part name(s) or part number(s) to search for and add as existing parts

## Steps — new parts (from file)

1. Parse the input file for parts — each part needs at minimum: name, part number, quantity type, quantity unit
2. For each part, call `partCreate` and collect the returned `part.latestRevision.id` (NOT `part.id`)
3. If the part has a category in the input file, call `partSetCategory` using the part ID
4. Call `updateSourcingProject` with `options.addExistingParts` containing all collected `latestRevision.id` values
5. If the input file specifies volumes per part, include them via `options.updatePartOrderInfo`
6. Return a summary: how many parts were added and the RFQ ID

## Steps — existing parts (by name or part number)

1. For each part name or number provided, call `partSearch` with it as the `query`
2. If multiple results are returned, pick the closest match by name/number
3. Collect `latestRevision.id` from each result (NOT `node.id`) — `addExistingParts` requires PartRevision IDs
4. Do not rely solely on `partSearch` for exact part number lookups — it uses fuzzy matching and may return wrong results. If you have the `Part.id`, use `part(id: "...")` to fetch the correct `latestRevision.id` directly.
5. Call `updateSourcingProject` with `options.addExistingParts` containing the collected revision IDs
6. Return a summary: which parts were found and added, and the RFQ ID

## Mutation references

### Create a part

```graphql
mutation {
  partCreate(
    input: {
      options: {
        name: "Resistor 10k"
        num: "RES-10K"
        quantityType: COUNT # enum: COUNT, AREA, ENERGY, LENGTH, POWER, TIME, VOLUME, WEIGHT
        quantityPreferredUnit: COUNT_EACH # must match quantityType prefix, e.g. COUNT_EACH, COUNT_LOT, WEIGHT_KILOGRAM
        notes: "optional notes"
        targetCost: "0.05"
        targetCostCurrency: USD
      }
    }
  ) {
    part {
      id
      latestRevision {
        id
      } # use latestRevision.id for addExistingParts — NOT part.id
    }
  }
}
```

### Set part category (if category provided)

```graphql
mutation {
  partSetCategory(
    input: {
      partId: "<part-id>"
      options: {
        categoryInfoId: "<category-info-id>" # from partCategoryInfoSearch
        # OR
        customName: "Custom Category Name"
      }
    }
  ) {
    part {
      id
    }
  }
}
```

### Look up category ID by name

```graphql
{
  partCategoryInfoSearch(query: "PCB", first: 5) {
    edges {
      node {
        id
        name
      }
    }
  }
}
```

### Search for an existing part by name or number

```graphql
{
  partSearch(query: "Resistor 10k", first: 5) {
    edges {
      node {
        id
        num
        latestRevision {
          id
          name
        } # capture latestRevision.id here
      }
    }
  }
}
```

### Fetch a single part by ID (preferred when Part.id is known)

```graphql
{
  part(id: "<part-id>") {
    latestRevision {
      id
      name
    }
  }
}
```

### Add parts to RFQ

```graphql
mutation {
  updateSourcingProject(
    input: {
      id: "<rfq-id>"
      options: {
        addExistingParts: ["<part-revision-id-1>", "<part-revision-id-2>"] # PartRevision IDs, not Part IDs
      }
    }
  ) {
    sourcingProject {
      id
      latestRevision {
        partCount
      }
    }
  }
}
```

## Notes

- `quantityType` enum values: `COUNT`, `AREA`, `ENERGY`, `LENGTH`, `POWER`, `TIME`, `VOLUME`, `WEIGHT` — there is no `DISCRETE` or `CONTINUOUS`
- `quantityPreferredUnit` must match the `quantityType` prefix (e.g. `COUNT_EACH`, `COUNT_LOT`, `WEIGHT_KILOGRAM`)
- Common plain-language quantity type mappings:
  | Input value | quantityType | quantityPreferredUnit |
  |-------------|-------------|----------------------|
  | each, unit | COUNT | COUNT_EACH |
  | box, lot | COUNT | COUNT_LOT |
  | kg | WEIGHT | WEIGHT_KILOGRAM |
  | g | WEIGHT | WEIGHT_GRAM |
  | m | LENGTH | LENGTH_METER |
  | reel | COUNT | COUNT_LOT |
- Strip currency symbols (e.g. `$`, `€`, `£`) from cost fields in the input file before passing to `targetCost`
- **`addExistingParts` requires `PartRevision` IDs** — passing `Part` IDs will fail with "Malformed relay id key". Always use `latestRevision.id`.
- `partSearch` uses fuzzy matching and may return wrong results for similar part numbers — prefer `part(id: ...)` when the Part ID is already known
- If the input file has no part numbers, generate sequential ones (e.g. PART-001, PART-002)
- Category lookup is optional — skip `partSetCategory` if no category info is available
