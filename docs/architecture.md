# How Slecta fits together

Slecta shows one aggregated score per title, combined from several external sources, alongside
where you can stream it. There is no database — TMDB is the catalog and Redis holds everything
derived, all of it with a TTL.

## Two things run

**The web service** answers page and API requests. It never fetches an external score on the
request path if it can avoid it: it reads a pre-computed score out of Redis, and only falls
back to scoring live on a cache miss.

**The nightly job** warms that cache, then checks its own work. It runs as a Cloud Run Job, so
it has no HTTP surface and nothing to authenticate.

## A page view

```
GET /movies/123
  └─ tmdbService.getMovieDetail        catalog data, cached 24h
  └─ scoreService.getScoreFromCache    the badge, written by the nightly job
  └─ reviewService.getQuotesFromCache  pull quotes, cached 7 days
```

If no cached score exists, the client asks `/api/v1/movies/123/score` and `scoreService` builds
one live — a few hundred milliseconds, because IMDb is a local Redis lookup and the rest are
single fetches.

## The nightly run

Cloud Scheduler triggers the job at 00:00 UTC. `server/job.js` starts Redis and TMDB, then:

```
jobs/cacheScores.js
  1. imdbService.refresh()      download IMDb's dataset, load ~428k ratings into Redis
  2. score 20 movies            TMDB discover, page 1 of the default sort
  3. score 20 TV shows
  4. jobs/verify.js             did that actually work?
```

Step 4 is two independent checks, and the reason for both is that either alone can be fooled:

- `checkReferenceTitles()` scores three long-settled titles and compares **every source** against
  a known value. Catches a source returning wrong or missing numbers.
- `checkRunCoverage()` looks at **all 40 titles** and asks how often each source resolved, how
  many were built from TMDB alone, how many failed, how many never persisted. Catches a source
  failing broadly while the three reference titles happen to still work.

Either failing logs at `ERROR` and makes the job exit non-zero. The alert policy matches **any
`ERROR` from the job**, not specific message text — an earlier version matched exact strings and
renaming a function silently disarmed it. Rename freely; just keep failures at `ERROR`.

The non-zero exit is what fails the post-deploy step in `cloudbuild.yaml`. That step runs after
the service is deployed, not before — verification also fails when a third-party source is down,
and gating the deploy on it would block the very change that fixes such an outage. It reports, it
does not prevent. Note that Cloud
Scheduler cannot see it: triggering a job through the Cloud Run Admin API returns as soon as the
execution starts, so the scheduler reports success regardless of outcome. Job failures are
caught by the log alert, not by the scheduler.

This exists because the previous scrapers broke silently and served plausible-looking wrong
numbers.

## Where a score comes from

`scoreService.getScore()` resolves five components and averages whatever it got:

| Source | How |
|---|---|
| IMDb | local Redis lookup, from the nightly dataset load — no network call |
| Rotten Tomatoes | `media-scorecard-json` embedded in the page, critic and audience |
| Metacritic | schema.org JSON-LD, series-level for TV |
| TMDB | already in the catalog response |

Rotten Tomatoes and Metacritic need a URL slug. Wikidata supplies both in one call (`P1258`,
`P1712`); when it has none, `slugify()` guesses and a HEAD request checks the guess.

Absent sources are **omitted** from the stored record rather than set to null, so the number of
keys is the number of sources that actually answered. Phase 3's user-weighting depends on that.

## Module map

```
server/
  server.js            starts redis + tmdb, serves static files and routes
  routes.js            every URL, page and API
  env.js               required vs optional env vars; throws on startup if one is missing
  controllers/         one per resource, page and API handlers side by side
  services/
    tmdbService        catalog: titles, detail, genres, watch providers
    scoreService       resolves and averages the five components
    imdbService        the bulk dataset: refresh() nightly, getRating() per title
    reviewService      pull quotes via Google Programmable Search
    redisService       get/set with TTL, and Map serialisation
  job.js               Cloud Run Job entrypoint, the batch counterpart to server.js
  jobs/
    cacheScores.js     the warm-up loop
    verify.js          the two checks described above
  utils/               logger (structured JSON for Cloud Logging), math, slug
  views/               tagged template literals, no template engine
```

## Deployment

Push to `main` → Cloud Build → build image → deploy the service → point the job at the same
image → run the job once, failing the build if verification fails.

Both the service and the job run the same image with different commands. Their env vars are set
on the Cloud Run resources, not in `cloudbuild.yaml`, so credentials stay out of the repo.

Redis is `volatile-lru`, so under memory pressure it evicts keys rather than rejecting writes.
Everything Slecta stores has a TTL, which makes that survivable but means the IMDb dataset
competes with cached scores for space — hence the minimum vote count filter in `imdbService`.

Redis is optional at runtime *for the web service*. If it is unreachable the service still
starts and every read falls through to the source uncached; the connection re-establishes itself
in the background and caching resumes. Only the transitions in and out of that state are logged,
since the underlying client retries about once a second.

The nightly job is the opposite: it exists to fill the cache, so it refuses to run without one
rather than spending the IMDb download and ~160 third-party requests on results it cannot store.
That check is at startup only. Losing Redis part-way through is left to run its course: a write
skipped during a brief stall looks identical to a dead cache from inside the loop, so any
mid-run abort risks throwing away a good night over a two-second blip. Coverage fails the run
either way; the cost of not bailing is the third-party requests already in flight.
Missing one run is safe by design — score TTLs are 48h and the IMDb dataset's is 78h, both
chosen to outlive a missed run.
