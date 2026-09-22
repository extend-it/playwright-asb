import { test, expect, TOPIC } from './fixtures/servicebus';
import { newCorrelationId, receiveMatching, drain } from './fixtures/helpers';

test.describe('alert routing', () => {
  test.beforeEach(async ({ sb }) => {
    for (const s of ['alerts-critical', 'alerts-informational', 'alerts-audit']) {
      await drain(sb, TOPIC, s);
    }
  });

  test('a critical alert reaches alerts-critical and alerts-audit only', async ({ sb }) => {
    const correlationId = newCorrelationId();
    const sender = sb.createSender(TOPIC);

    await sender.sendMessages({
      body: {
        alertId: 'ALR-1001',
        tenantId: 'contoso',
        deviceId: 'DEV-77',
        detection: 'Suspicious PowerShell encoded command',
      },
      correlationId,
      applicationProperties: { severity: 'critical', tenantId: 'contoso' },
    });
    await sender.close();

    const mine = (m: { correlationId?: string | number | Buffer }) => m.correlationId === correlationId;

    const critical = sb.createReceiver(TOPIC, 'alerts-critical');
    const audit = sb.createReceiver(TOPIC, 'alerts-audit');
    const info = sb.createReceiver(TOPIC, 'alerts-informational');

    try {
      const onCritical = await receiveMatching(critical, mine);
      const onAudit = await receiveMatching(audit, mine);
      const onInfo = await receiveMatching(info, mine, 4_000);   // shorter budget: expected empty

      expect(onCritical, 'critical subscription receives it').toHaveLength(1);
      expect(onAudit, 'audit subscription receives everything').toHaveLength(1);
      expect(onInfo, 'informational subscription must not receive it').toHaveLength(0);

      expect(onCritical[0].body).toMatchObject({ alertId: 'ALR-1001', deviceId: 'DEV-77' });
      expect(onCritical[0].applicationProperties?.severity).toBe('critical');
    } finally {
      await Promise.all([critical.close(), audit.close(), info.close()]);
    }
  });

  test('an informational alert does not reach alerts-critical', async ({ sb }) => {
    const correlationId = newCorrelationId();
    const sender = sb.createSender(TOPIC);
    await sender.sendMessages({
      body: { alertId: 'ALR-1002', tenantId: 'contoso', detection: 'New device enrolled' },
      correlationId,
      applicationProperties: { severity: 'informational', tenantId: 'contoso' },
    });
    await sender.close();

    const mine = (m: { correlationId?: string | number | Buffer }) => m.correlationId === correlationId;
    const info = sb.createReceiver(TOPIC, 'alerts-informational');
    const critical = sb.createReceiver(TOPIC, 'alerts-critical');

    try {
      expect(await receiveMatching(info, mine)).toHaveLength(1);
      expect(await receiveMatching(critical, mine, 4_000)).toHaveLength(0);
    } finally {
      await Promise.all([info.close(), critical.close()]);
    }
  });
});
