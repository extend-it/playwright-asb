# playwright-asb

[![service-bus-tests](https://github.com/vldfilgm/playwright-asb/actions/workflows/servicebus-tests.yml/badge.svg)](https://github.com/vldfilgm/playwright-asb/actions/workflows/servicebus-tests.yml)

Playwright (TypeScript) tests for an event-driven Azure Service Bus flow, running entirely against the
local Service Bus emulator in Docker. No Azure subscription, no cost, no shared test environment.

The example domain is a security-alert pipeline: detections are published to a topic, routed to
subscriptions by severity, and automated response actions are dispatched through a queue.

## What it tests

| Spec | Question it answers |
| --- | --- |
| `tests/routing.spec.ts` | Does an alert published to the topic reach exactly the subscriptions whose filters match it — and no others? |
| `tests/deadletter.spec.ts` | Does an alert that fails validation, or one that is abandoned `MaxDeliveryCount` times, land in the dead-letter queue with a readable reason? |
| `tests/idempotency.spec.ts` | Is the same logical action applied only once, when the publisher retries and when the broker redelivers? |

Playwright is used here as the test runner, not as a browser tool: no page is opened. The point is that
UI, API and messaging tests can live in one runner, one report and one CI job.

## Quick start

```bash
cp .env.example .env
npm install
npm run emulator:up      # Service Bus emulator + SQL backend in Docker
curl http://localhost:5300/health
npm test
npm run report
```

Requires Docker Desktop (WSL 2 on Windows) and Node.js 20+.
`npm run emulator:down` stops the containers; the emulator keeps no data between restarts, which is
what makes each run reproducible.

## Layout

```text
docker/
  docker-compose.yaml        emulator + SQL backend
  Config.json                topic, subscriptions, SQL filters, queue with duplicate detection
tests/
  fixtures/servicebus.ts     ServiceBusClient fixture that closes itself
  fixtures/helpers.ts        bounded receive loop, drain, unique correlation ids
  routing.spec.ts
  deadletter.spec.ts
  idempotency.spec.ts
.github/workflows/           CI: start the emulator, run the suite, upload the HTML report
```

## Design notes

- **Both sides of every routing rule are asserted.** A filter that is too wide leaks one tenant's alerts
  to the wrong subscriber; one that is too narrow drops a critical detection. The negative case gets a
  shorter timeout, since proving absence means waiting out a budget.
- **Dead-lettering is tested twice** — explicit rejection and `MaxDeliveryCount` exhaustion. Only the
  first carries an application-supplied reason, so both paths matter operationally.
- **Two independent defences against duplicates.** The broker's duplicate detection covers a finite
  window; the consumer's own idempotency store does not expire. The tests cover each separately.
- **No `sleep`, no shared state.** Every test tags its messages with a unique `correlationId` and waits
  with a bounded receive loop. Entities are drained before each test, and the suite runs with
  `workers: 1` because the tests share one broker.

## Emulator limits worth knowing

One namespace, 50 entities, 50 subscriptions per topic, 256 KB per message, maximum message TTL of one
hour. Partitioned entities and AMQP over WebSockets are not supported, and data does not survive a
container restart. See the
[emulator overview](https://learn.microsoft.com/en-us/azure/service-bus-messaging/overview-emulator).

## Next steps

Session-enabled subscriptions to test per-tenant ordering, a schema contract test so a producer change
breaks the build, and reading `deliveryCount` and dead-letter depth as release-readiness signals.

## Scope

A focused demo of event-driven testing technique, not a production test suite. It is deliberately small
enough to read in ten minutes.
