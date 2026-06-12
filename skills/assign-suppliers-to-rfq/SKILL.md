---
name: assign-suppliers-to-rfq
description: Assigns relevant suppliers to an RFQ (request for quote) based on part categories, with fallback to quote history.
---

## Arguments

- RFQ — either its name (e.g. "Claude-driven") or its ID. If a name is given, resolve it first.

## Steps

1. If given a name instead of an ID, resolve it using the RFQ name → ID lookup in `graphql-request`
2. Fetch the parts on the RFQ to extract their categories
3. For each unique category, search for suppliers using `quoteProviderSearch` with the category name as the query
4. If category search yields no results, fall back to `companySearch` using the category name
5. Collect unique supplier contact IDs or emails from the results
6. Call `sourcingProjectSupplierAdd` with the collected supplier IDs
7. Return a summary: how many suppliers were added and which categories they matched

## Query references

### Get parts and categories on an RFQ

```graphql
{
  sourcingProject(id: "<rfq-id>") {
    latestRevision {
      sourcingProjectParts {
        edges {
          node {
            partRevision {
              part {
                id
                category {
                  categoryInfo {
                    id
                    name
                  }
                  customName
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### Search suppliers by category (primary)

```graphql
{
  quoteProviderSearch(query: "PCB Assembly", first: 10) {
    edges {
      node {
        id
        name
        email
      }
    }
  }
}
```

### Search companies by category (fallback)

```graphql
{
  companySearch(query: "PCB Assembly", first: 10) {
    edges {
      node {
        id
        name
      }
    }
  }
}
```

### Add suppliers to RFQ

```graphql
mutation {
  sourcingProjectSupplierAdd(
    input: {
      sourcingProjectId: "<rfq-id>"
      rolodexContactIds: ["<contact-id-1>", "<contact-id-2>"]
      # OR use supplierEmails if only email is available
      supplierEmails: ["supplier@example.com"]
    }
  ) {
    supplierEdges {
      node {
        id
      }
    } # payload type is SourcingProjectAddSupplierPayload — no sourcingProject field
  }
}
```

## Notes

- Deduplicate suppliers across categories before adding — do not add the same supplier twice
- Prioritize suppliers matched by part category over generic company search results
- If no suppliers are found for a category, log it and continue — do not fail the whole operation
- Return a clear summary of which categories matched which suppliers
