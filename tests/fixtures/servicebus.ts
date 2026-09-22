import { test as base } from '@playwright/test';
import { ServiceBusClient } from '@azure/service-bus';

type SbFixtures = { sb: ServiceBusClient };

export const test = base.extend<SbFixtures>({
  sb: async ({}, use) => {
    const cs = process.env.SERVICEBUS_CONNECTION_STRING!;
    const client = new ServiceBusClient(cs);
    await use(client);
    await client.close();
  },
});

export const expect = test.expect;
export const TOPIC = process.env.SB_TOPIC ?? 'security-alerts';
export const QUEUE = process.env.SB_QUEUE ?? 'incident-actions';
