---
name: optimize-rfq-award
description: Triggers the AI award optimization step for an RFQ (sourcing project), polls until the plan is ready, then approves it to create an award scenario.
---

## Arguments

- RFQ — either its name or ID. If a name is given, resolve it first.
- `userPrompt` — optimization goal, e.g. "minimize cost" or "split 60/40 between lowest cost and preferred supplier"
- `quotePackageIds` — list of quote package IDs to include. If not provided, fetch them from the sourcing project.
- `awardScenarioTitle` (optional) — title for the created award scenario; defaults to a generated name.

## Steps

### Step 1 — Resolve RFQ ID

If given a name, resolve it using the RFQ name → ID lookup in `graphql-request`. Use the returned ID for all subsequent calls.

### Step 2 — Resolve quote package IDs (if not provided)

```graphql
{
  sourcingProject(id: "<rfq-id>") {
    latestRevision {
      quotePackages {
        edges {
          node {
            id
          }
        }
      }
    }
  }
}
```

### Step 3 — Start optimization

```graphql
mutation {
  sourcingProjectCreateOptimizationFromSourcingProject(
    input: {
      sourcingProjectId: "<rfq-id>"
      quotePackageIds: ["<qp-id-1>", "<qp-id-2>"]
      userPrompt: "<userPrompt>"
    }
  ) {
    attempt {
      id
      result {
        __typename
        ... on AwardScenarioAiOptimizationAttemptPending {
          __typename
        }
        ... on AwardScenarioAiOptimizationAttemptFailed {
          error
        }
        ... on AwardScenarioAiOptimizationAttemptSucceeded {
          plan {
            __typename
          }
        }
      }
    }
  }
}
```

Capture `attempt.id`. If `result` is already `AwardScenarioAiOptimizationAttemptFailed`, stop and report the error.

### Step 4 — Poll until complete

Poll `awardScenarioAiOptimizationAttempt` every 5 seconds until `result.__typename` is no longer `AwardScenarioAiOptimizationAttemptPending`:

```graphql
{
  awardScenarioAiOptimizationAttempt(id: "<attempt-id>") {
    id
    result {
      __typename
      ... on AwardScenarioAiOptimizationAttemptFailed {
        error
      }
      ... on AwardScenarioAiOptimizationAttemptSucceeded {
        plan {
          __typename
        }
      }
    }
    executionResult {
      __typename
      ... on AwardScenarioAiOptimizationExecutionSucceeded {
        createdAwardScenario {
          id
        }
      }
    }
  }
}
```

- If `Failed`: stop and report `error`.
- If `Succeeded`: proceed to Step 5.

### Step 5 — Approve the plan

```graphql
mutation {
  sourcingProjectApproveOptimizationPlan(
    input: {
      attemptId: "<attempt-id>"
      awardScenarioTitle: "<awardScenarioTitle>" # optional
    }
  ) {
    attempt {
      executionResult {
        __typename
        ... on AwardScenarioAiOptimizationExecutionSucceeded {
          createdAwardScenario {
            id
          }
        }
        ... on AwardScenarioAiOptimizationExecutionFailed {
          __typename
        }
      }
    }
  }
}
```

### Step 6 — Return summary

Report:

- RFQ ID
- Attempt ID
- Award scenario ID (from `createdAwardScenario.id`)
- Status: success or failure with error message

## Notes

- Plan generation runs in the background — polling is required. Do not assume it completes instantly.
- If no quote packages exist on the RFQ, the optimization cannot proceed — report this clearly and stop.
- `executionResult` tracks the separate approval/execution phase; `result` tracks the plan generation phase. Both must be `Succeeded` for full completion.
