# Generated onboarding and season API client

The transport sources of truth are
`specs/001-farmer-onboarding-first-field/contracts/onboarding.openapi.yaml` and
`specs/002-first-season-setup/contracts/seasons.openapi.yaml`.
`openapi-typescript` generates `src/generated/onboarding-api.ts` and
`src/generated/seasons-api.ts` independently; do not edit either file by hand.

`createApiClient` accepts both generated path surfaces. Public `paths` and
`operations` compose the generated contracts without handwritten payload types.
The original `components` and `@ekim-hasat/api-client/generated` exports remain
the onboarding contract. Use `SeasonComponents`, `SeasonPaths`, and
`SeasonOperations`, or `@ekim-hasat/api-client/generated/seasons`, for the season
contract. Independent generation keeps shared component names in their original
contract and prevents a season schema from replacing an onboarding schema.

Regenerate and verify the checked-in output with:

```sh
pnpm --filter @ekim-hasat/api-client generate
pnpm --filter @ekim-hasat/api-client check:generated
pnpm --filter @ekim-hasat/api-client test:contract
```

`check:generated` regenerates both contracts in memory and compares every output
with the checked-in source. It fails for missing or changed generated output.
`test:contract` also builds the package and type-checks consumers of both surfaces,
including required idempotency/concurrency headers and rejected out-of-scope
request fields. Adding transport types to mobile or web by hand is not part of
this workflow; consumers import the generated schemas instead.

T048 verification: regeneration produced no content change. The generated
contract includes `FirstFieldSummary.createdAt` and the `5XX` response range.
`test:contract` passed, and the workspace `pnpm typecheck` passed for the API,
mobile app, domain package, and API client consumers.
