import { test, expect, QUEUE } from './fixtures/servicebus';
import { newCorrelationId, receiveMatching } from './fixtures/helpers';
import { ServiceBusReceivedMessage } from '@azure/service-bus';

test.describe('idempotency', () => {
  test('the broker drops a second send with the same messageId', async ({ sb }) => {
    const messageId = `isolate-DEV-77-${Date.now()}`;
    const correlationId = newCorrelationId();
    const sender = sb.createSender(QUEUE);

    const action = { actionId: messageId, action: 'isolate-device', deviceId: 'DEV-77', tenantId: 'contoso' };
    await sender.sendMessages({ body: action, messageId, correlationId });
    await sender.sendMessages({ body: action, messageId, correlationId });  // publisher retry
    await sender.close();

    const receiver = sb.createReceiver(QUEUE);
    try {
      const mine = await receiveMatching(receiver, (m) => m.correlationId === correlationId, 8_000);
      expect(mine, 'duplicate detection keeps only the first send').toHaveLength(1);
    } finally {
      await receiver.close();
    }
  });

  test('the handler isolates the device only once across a redelivery', async ({ sb }) => {
    // Stand-in for the real responder: a processed-actions store plus the side effect.
    const processed = new Set<string>();
    const isolatedDevices: string[] = [];

    const handle = (msg: ServiceBusReceivedMessage) => {
      const key = String(msg.messageId);
      if (processed.has(key)) return 'skipped';
      processed.add(key);
      isolatedDevices.push(msg.body.deviceId);
      return 'applied';
    };

    const messageId = `isolate-DEV-88-${Date.now()}`;
    const correlationId = newCorrelationId();
    const sender = sb.createSender(QUEUE);
    await sender.sendMessages({
      body: { actionId: messageId, action: 'isolate-device', deviceId: 'DEV-88', tenantId: 'contoso' },
      messageId,
      correlationId,
    });
    await sender.close();

    const receiver = sb.createReceiver(QUEUE);
    const outcomes: string[] = [];

    try {
      // First delivery: handled, then abandoned as if the responder crashed after isolating the device.
      const [first] = await receiver.receiveMessages(1, { maxWaitTimeInMs: 10_000 });
      expect(first?.messageId).toBe(messageId);
      outcomes.push(handle(first));
      await receiver.abandonMessage(first);

      // Redelivery: the same action arrives again.
      const [second] = await receiver.receiveMessages(1, { maxWaitTimeInMs: 10_000 });
      expect(second?.messageId).toBe(messageId);
      expect(second.deliveryCount).toBeGreaterThan(first.deliveryCount ?? 0);
      outcomes.push(handle(second));
      await receiver.completeMessage(second);
    } finally {
      await receiver.close();
    }

    expect(outcomes).toEqual(['applied', 'skipped']);
    expect(isolatedDevices, 'the device is isolated once, not twice').toEqual(['DEV-88']);
  });
});
