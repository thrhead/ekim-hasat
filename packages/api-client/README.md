# Generated onboarding API client

The transport source of truth is
`specs/001-farmer-onboarding-first-field/contracts/onboarding.openapi.yaml`.
`src/generated/onboarding-api.ts` is generated from that contract with
`openapi-typescript`; do not edit the generated file by hand.

Regenerate and verify the checked-in output with:

```sh
pnpm --filter @ekim-hasat/api-client generate
pnpm --filter @ekim-hasat/api-client check:generated
pnpm --filter @ekim-hasat/api-client test:contract
```

T048 verification: regeneration produced no content change. The generated
contract includes `FirstFieldSummary.createdAt` and the `5XX` response range.
`test:contract` passed, and the workspace `pnpm typecheck` passed for the API,
mobile app, domain package, and API client consumers.
