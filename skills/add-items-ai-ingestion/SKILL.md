---
name: add-items-ai-ingestion
description: Uses the AI part ingestion pipeline to extract and add items to the platform from one or more files, instead of creating parts one by one.
---

## Goal

Upload one or more files to LightSource and use the AI extraction pipeline to ingest their parts into the catalog. Optionally add the approved parts to an existing RFQ.

## Arguments

- Input file(s) — one or more files to ingest (required). Usually files the user attached to the conversation; a path on disk also works. If the user referred to an attachment but none is available, ask them to drop the file into the prompt box rather than guessing a path.
- RFQ name or ID — if provided, add approved parts to this RFQ after ingestion (optional)

## Steps

### Step 1 — Upload each file

For each input file, follow the file upload procedure in `graphql-request` — normally one `upload_file` call per file. Collect the returned `userFileId` from each; these are the UserFile IDs passed to Step 2.

### Step 2 — Start AI ingestion batch

Call `extractItemsFromFiles` with all collected UserFile IDs.
Capture the returned `batch.id`.

### Step 3 — Poll until complete

Poll `aiPartIngestionBatch(id: <batch-id>)` every 5 seconds.
Stop when `isCompleted` is `true`.
Print progress updates (completed count, total files) while waiting.

### Step 4 — Approve all extracted parts

Call `approveAiExtractedParts` with `approvedPartsPayload: { batchId: "<batch-id>" }`.

If it returns a `PERMISSION_DENIED` error, the parts may have been auto-approved — do not treat this as a failure. Instead, query the batch for `isAllApproved` and `approvedPartsCount`. If `isAllApproved` is `true`, proceed as if approval succeeded.

Collect `PartRevision` IDs by querying the batch's ingestions for `extractedParts[].createdPartRevision.id`.

### Step 5 — Add to RFQ (optional)

Skip if no RFQ argument was provided.

Call `updateSourcingProject` with `options.addExistingParts` containing all `createdPartRevision.id` values collected in Step 4. These are already `PartRevision` IDs — no additional lookup needed.

## Mutation / query reference

### Start ingestion batch

```graphql
mutation {
  extractItemsFromFiles(
    input: { userFileIds: ["<user-file-id-1>", "<user-file-id-2>"] }
  ) {
    batch {
      id
    }
  }
}
```

### Poll batch status

```graphql
{
  aiPartIngestionBatch(id: "<batch-id>") {
    id
    isCompleted
    completedCount
    totalFiles
    ingestions(first: 50) {
      edges {
        node {
          id
          status {
            ... on AiPartIngestionDone {
              extractedParts {
                id
                name
                partNumber
                confidence
              }
            }
            ... on AiPartIngestionInProgress {
              status
              llmStatusMessage
            }
            ... on AiPartIngestionFailed {
              ingestionId
            }
          }
        }
      }
    }
  }
}
```

### Approve all parts in batch

```graphql
mutation {
  approveAiExtractedParts(
    input: { approvedPartsPayload: { batchId: "<batch-id>" } }
  ) {
    parts {
      id
    }
    batch {
      approvedPartsCount
    }
  }
}
```

If this returns `PERMISSION_DENIED`, check approval status and collect revision IDs via:

```graphql
{
  aiPartIngestionBatch(id: "<batch-id>") {
    isAllApproved
    approvedPartsCount
    ingestions(first: 10) {
      edges {
        node {
          extractedParts(first: 100) {
            edges {
              node {
                createdPartRevision {
                  id
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

### Add parts to RFQ

```graphql
mutation {
  updateSourcingProject(
    input: {
      id: "<rfq-id>"
      options: {
        addExistingParts: ["<part-revision-id-1>", "<part-revision-id-2>"]
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

- Supported file types: CSV, Excel, PDF, and other document types the platform accepts
- The AI extraction may take 10–60 seconds per file depending on size and complexity
- Parts with low confidence scores are still approved in bulk — the user can review in the UI
- `addExistingParts` requires `PartRevision` IDs (from `latestRevision.id`), not `Part` IDs
- If a file upload fails, skip that file, log the error, and continue with remaining files
- If ingestion of a specific file fails (`AiPartIngestionFailed`), log and continue — do not abort the whole batch
