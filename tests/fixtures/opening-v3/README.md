# Frozen opening-repair v3 regression fixture

These two reducer modules preserve the previous repair strategy, before the small-region CPU guard and candidate-occluder constraints. The single-level test hook only skips independent LOD 0/2 work. All measurements use the same current generator, canonical source, meshoptimizer version, cameras and unchanged GPU acceptance policy.

`npm run test:fracture-cases` reproduces the two old failures, compares the corrected reducer, and fails if the corrected fixtures regress. This is test-only code, never imported by the production application.
