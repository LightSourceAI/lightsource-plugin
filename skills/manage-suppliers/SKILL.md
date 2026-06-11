---
name: manage-suppliers
description: Query, update, and manage supplier companies and contacts in the LightSource rolodex. Covers listing all suppliers, looking up by external ID, updating company details, and creating or updating contacts.
---

## Arguments

- Operation — one of: `list`, `lookup`, `update-company`, `create-contact`, `update-contact`
- Additional fields depending on operation (see each section below)

---

## List all suppliers

Returns all companies in the team's rolodex with their contacts and locations.

```graphql
query AllSuppliers {
  session {
    currentTeam {
      rolodexCompanies(first: 9999) {
        edges {
          node {
            id
            externalId
            displayName
            searchContacts(first: 9999) {
              edges {
                node {
                  id
                  displayName
                  email
                }
              }
            }
            teamLocations(first: 9999) {
              edges {
                label
                isPrimary
                node { id }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## Look up a company by external ID

Useful when you have a supplier ID from an external system and need to find the LightSource company or its team namespace.

```graphql
query FetchSupplierByExternalId($companyId: String!) {
  clientUserInfo {
    team {
      rolodexCompanyByExternalId(companyExternalId: $companyId) {
        companyTeams {
          team {
            namespace
          }
        }
      }
    }
  }
}
```

Variables: `{ "companyId": "<your-external-id>" }`

---

## Update a company

```graphql
mutation UpdateCompany {
  rolodexCompanyUpdate(
    input: {
      companyId: "<company-id>"
      displayName: "New Name"
    }
  ) {
    company {
      id
      displayName
    }
  }
}
```

Use the `id` from a `rolodexCompanies` or `rolodexCompanyByExternalId` lookup. All fields other than `companyId` are optional.

---

## Create an offline contact

Creates a new contact under an existing company. Use this for contacts who are not yet LightSource users.

```graphql
mutation CreateContact {
  createRolodexAdhocContact(
    input: {
      rolodexCompanyId: "<company-id>"
      displayName: "John Smith"
      email: "john@example.com"
      title: "CEO"
    }
  ) {
    createdContactEdge {
      node {
        id
        displayName
      }
    }
  }
}
```

All fields except `rolodexCompanyId` are optional.

---

## Update a contact

```graphql
mutation UpdateContact {
  rolodexUpdateContact(
    input: {
      contactId: "<contact-id>"
      displayName: "New Name"
      email: "new@example.com"
    }
  ) {
    contact {
      id
      displayName
    }
  }
}
```

Use the `id` from a `searchContacts` result. All fields except `contactId` are optional.

---

## Notes

- `externalId` on a company is your system's ID — set it via `rolodexCompanyUpdate` or during company ingest to enable `rolodexCompanyByExternalId` lookups
- `rolodexCompanies` returns all companies in your team's rolodex — use `searchContacts` on each node to get contacts
- Offline contacts (created via `createRolodexAdhocContact`) are not LightSource accounts — they receive email invitations when added to sourcing projects
- To add a supplier to an RFQ, use the `assign-suppliers-to-rfq` skill with the contact ID or email
