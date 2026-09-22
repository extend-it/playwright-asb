import { ServiceBusClient, ServiceBusReceivedMessage, ServiceBusReceiver } from '@azure/service-bus';
import { randomUUID } from 'node:crypto';

export const newCorrelationId = () => `test-${randomUUID()}`;

/** Receive until `predicate` matches or the budget runs out. Non-matching messages are completed. */
export async function receiveMatching(
  receiver: ServiceBusReceiver,
  predicate: (m: ServiceBusReceivedMessage) => boolean,
  budgetMs = 10_000,
): Promise<ServiceBusReceivedMessage[]> {
  const found: ServiceBusReceivedMessage[] = [];
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    const batch = await receiver.receiveMessages(10, { maxWaitTimeInMs: 1_000 });
    for (const msg of batch) {
      if (predicate(msg)) {
        found.push(msg);
      }
      await receiver.completeMessage(msg);   // keep the entity clean for the next test
    }
    if (found.length > 0 && batch.length === 0) break;
  }
  return found;
}

/** Empty an entity so a test starts from a known state. */
export async function drain(sb: ServiceBusClient, topic: string, subscription: string) {
  const receiver = sb.createReceiver(topic, subscription);
  try {
    let batch = await receiver.receiveMessages(50, { maxWaitTimeInMs: 1_000 });
    while (batch.length > 0) {
      for (const m of batch) await receiver.completeMessage(m);
      batch = await receiver.receiveMessages(50, { maxWaitTimeInMs: 1_000 });
    }
  } finally {
    await receiver.close();
  }
}
