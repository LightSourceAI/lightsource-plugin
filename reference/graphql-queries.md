# LightSource GraphQL Query Reference

Ready-to-use queries and mutations for common operations. All requests go to `https://api.lightsource.ai/graphql` with `Authorization: Bearer $LIGHTSOURCE_API_KEY`.

---

## Auth & Teams

### List teams for current user

```graphql
query CurrentUserTeams {
  session {
    currentUser {
      teamList(first: 9999, query: "") {
        edges {
          node {
            id
            namespace
          }
        }
      }
    }
  }
}
```

### Set active team

```graphql
mutation SetActiveTeam($teamId: ID!) {
  accountsSetActiveTeam(input: { teamId: $teamId }) {
    result {
      ... on UserSession {
        currentTeam {
          id
          displayName
        }
      }
      ... on SetActiveTeamFailure {
        failureType
      }
    }
  }
}
```

### List team members

```graphql
query TeamMembership {
  session {
    currentTeam {
      namespace
      displayName
      members(first: 999) {
        edges {
          node {
            user {
              emailAddress
              display
            }
            teamMemberRole
            joined
            lastLogin
          }
        }
      }
    }
  }
}
```

---

## Sourcing Projects

### Search sourcing projects (with quote data)

```graphql
query SourcingProjectSearch(
  $query: String!
  $searchOptions: SourcingProjectSearchOptions
  $first: Int!
) {
  sourcingProjectSearch(
    query: $query
    searchOptions: $searchOptions
    first: $first
  ) {
    edges {
      node {
        id
        ord
        lifecycleStage
        owner {
          id
          display
          emailAddress
        }
        created
        latestRevision {
          title
          lastUpdated
          sourcingProjectParts {
            edges {
              node {
                partRevision {
                  name
                  num
                }
                orderInfo {
                  quantityUnit
                  frequency
                  recurringQuantity
                }
              }
            }
          }
        }
        suppliers {
          edges {
            node {
              latestQuotePackage {
                ...QuotePackageData
              }
              requestsForQuote {
                edges {
                  node {
                    respondByDate
                    sendTimestamp
                    ord
                    quotePackages(finalizedOnly: true) {
                      edges {
                        node {
                          ...QuotePackageData
                        }
                      }
                    }
                  }
                }
              }
              inner {
                ... on InvitedSupplier {
                  email
                }
                ... on ConcreteSourcingProjectSupplier {
                  supplier {
                    team {
                      companyInSessionTeamRolodex {
                        externalId
                        displayName
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

fragment QuotePackageData on QuotePackage {
  id
  sendTimestamp
  cost(
    includeEdt: true
    includeTooling: true
    useLatestRevisionOrderSchedule: true
    range: { orderFrequency: YEARLY }
  ) {
    perPart {
      partRevision {
        part {
          externalId
        }
      }
      cost {
        sourceCurrency
        value
      }
    }
    total {
      sourceCurrency
      value
    }
  }
  requestedParts {
    edges {
      quote {
        quoteRevision {
          ... on QuoteRevision {
            partBreakdown {
              cost
            }
            toolBreakdown {
              cost
            }
            edtBreakdown {
              cost
            }
          }
        }
      }
    }
  }
}
```

Variables: `{ "query": "", "first": 15, "searchOptions": { "createdAfter": 0 } }`

### Detailed quote data for a sourcing project

```graphql
query DetailedQuoteData($sourcingProjectId: ID!) {
  sourcingProject(id: $sourcingProjectId) {
    ord
    latestRevision {
      title
    }
    suppliers {
      edges {
        node {
          ...SourcingProjectSupplierData
          latestQuotePackage {
            ...QuotePackageData
          }
        }
      }
    }
  }
}

fragment SourcingProjectSupplierData on SourcingProjectSupplier {
  id
  state
  inner {
    ... on InvitedSupplier {
      email
    }
    ... on ConcreteSourcingProjectSupplier {
      supplier {
        team {
          namespace
          companyInSessionTeamRolodex {
            externalId
            displayName
          }
        }
      }
    }
  }
}

fragment QuotePackageData on QuotePackage {
  quotes {
    edges {
      node {
        partRevision {
          num
          name
          part {
            externalId
          }
        }
        quoteViewItem {
          quoteView {
            data {
              fieldValues {
                metadata {
                  displayName
                }
                value {
                  ... on QuoteViewTable {
                    rows(first: 9999) {
                      edges {
                        node {
                          fieldValues {
                            metadata {
                              displayName
                            }
                            value {
                              ... on QuoteViewTableFieldValueInnerView {
                                value {
                                  ...QuotedValue
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                  ... on QuoteViewTableFieldValueInnerView {
                    value {
                      ...QuotedValue
                    }
                  }
                }
              }
            }
          }
        }
        quoteRevision {
          partCost: breakdown(kind: PART) {
            cost
          }
          toolCost: breakdown(kind: TOOL) {
            cost
          }
          edtCost: breakdown(kind: EDT) {
            cost
          }
        }
      }
    }
  }
}

fragment QuotedValue on QuoteViewValue {
  ... on QuoteViewTextValue {
    text
  }
  ... on QuoteViewScalarValue {
    value {
      value
    }
  }
}
```

Variables: `{ "sourcingProjectId": "<id>" }`

---

## Programs

### Search programs

```graphql
query ProgramSearch($searchOptions: ProgramSearchOptions!, $first: Int!) {
  programSearch(searchOptions: $searchOptions, first: $first) {
    edges {
      node {
        id
        name
        creator {
          display
          emailAddress
        }
      }
    }
  }
}
```

Variables: `{ "first": 15, "searchOptions": { "query": "" } }`

---

## RFI

### Search RFI events

```graphql
query RfiSearch($searchFilter: RfiEventFilterParams, $first: Int!) {
  session {
    currentTeam {
      ownedRfiEvents(eventFilters: $searchFilter, first: $first) {
        edges {
          node {
            id
            name
            description
            creatorUser {
              display
              emailAddress
            }
          }
        }
      }
    }
  }
}
```

Variables: `{ "first": 15, "searchFilter": { "draftsOnly": false } }`
