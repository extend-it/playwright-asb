import { test, expect, TOPIC } from './fixtures/servicebus';
import { newCorrelationId, receiveMatching, drain } from './fixtures/helpers';

test.describe('dead-lettering', () => {
  test.beforeEach(async ({ sb }) => {
    await drain(sb, TOPIC, 'alerts-audit');
  });

  test('an alert that fails validation lands in the DLQ with a readable reason', async ({ sb }) => {
    const correlationId = newCorrelationId();
    const sender = sb.createSender(TOPIC);
    await sender.sendMessages({
      body: { alertId: 'ALR-BAD-1', tenantId: 'contoso', detection: 'Malformed' },  // no deviceId
      correlationId,
      applicationProperties: { severity: 'unknown' },
    });
    await sender.close();

    const receiver = sb.createReceiver(TOPIC, 'alerts-audit');
    const [msg] = await receiver.receiveMessages(1, { maxWaitTimeInMs: 10_000 });
    expect(msg, 'alert was delivered before rejecting it').toBeDefined();

    await receiver.deadLetterMessage(msg, {
      deadLetterReason: 'SchemaValidationFailed',
      deadLetterErrorDescription: 'deviceId is required on a device alert',
    });
    await receiver.close();

    const dlq = sb.createReceiver(TOPIC, 'alerts-audit', { subQueueType: 'deadLetter' });
    try {
      const dead = await receiveMatching(dlq, (m) => m.correlationId === correlationId, 15_000);
      expect(dead).toHaveLength(1);
      expect(dead[0].deadLetterReason).toBe('SchemaValidationFailed');
      expect(dead[0].deadLetterErrorDescription).toContain('deviceId');
      expect(dead[0].body).toMatchObject({ alertId: 'ALR-BAD-1' });
    } finally {
      await dlq.close();
    }
  });

  test('a poison alert abandoned MaxDeliveryCount times is dead-lettered by the broker', async ({ sb }) => {
    const correlationId = newCorrelationId();
    const sender = sb.createSender(TOPIC);
    await sender.sendMessages({
      body: { alertId: 'ALR-POISON-1', tenantId: 'contoso', deviceId: 'DEV-99' },
      correlationId,
    });
    await sender.close();

    const receiver = sb.createReceiver(TOPIC, 'alerts-audit');
    let deliveries = 0;

    // MaxDeliveryCount is 2 on this subscription: two abandons are enough.
    for (let attempt = 0; attempt < 4; attempt++) {
      const batch = await receiver.receiveMessages(1, { maxWaitTimeInMs: 5_000 });
      const found = batch.find((m) => m.correlationId === correlationId);
      if (!found) break;
      deliveries++;
      await receiver.abandonMessage(found);   // simulates an enrichment step that keeps crashing
    }
    await receiver.close();

    expect(deliveries, 'broker stopped redelivering at MaxDeliveryCount').toBe(2);

    const dlq = sb.createReceiver(TOPIC, 'alerts-audit', { subQueueType: 'deadLetter' });
    try {
      const dead = await receiveMatching(dlq, (m) => m.correlationId === correlationId, 15_000);
      expect(dead).toHaveLength(1);
      expect(dead[0].deadLetterReason).toBe('MaxDeliveryCountExceeded');
    } finally {
      await dlq.close();
    }
  });
});
