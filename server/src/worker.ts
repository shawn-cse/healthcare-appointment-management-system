import { ensureDatabaseSchema, prisma } from './config/db.js';
import { materializeWeekly, reconcileExpired } from './services/appointments.js';
import { logAudit } from './services/audit.js';
import { gatewayEnabled, gatewayRefundStatus } from './services/gateway.js';

export async function runMaintenanceCycle(): Promise<{ expired: number; materialized: number }> {
  const expired = await reconcileExpired();

  const doctors = await prisma.doctorProfile.findMany({
    where: { isAvailable: true, user: { isActive: true } },
    select: { id: true, maxPatientsPerSession: true, bookingAdvanceDays: true },
  });

  let materialized = 0;
  for (const doctor of doctors) {
    materialized += await materializeWeekly(doctor, Math.min(180, doctor.bookingAdvanceDays));
  }

  if (gatewayEnabled()) {
    const processingRefunds = await prisma.refundRequest.findMany({
      where: {
        mode: 'online',
        status: 'processing',
        appointment: {
          payments: { some: { kind: 'refund', status: 'processing' } },
        },
      },
      include: {
        appointment: {
          include: {
            payments: {
              where: { kind: 'refund', method: 'online', status: 'processing' },
              take: 1,
            },
          },
        },
      },
      take: 80,
    });

    for (const refund of processingRefunds) {
      const txn = refund.appointment.payments[0];
      if (!txn || !txn.refundReference) continue;
      try {
        const result = await gatewayRefundStatus(txn.refundReference);
        if (String(result.status || '').toLowerCase() === 'refunded') {
          await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM hospital_refundrequest WHERE id = ${refund.id} FOR UPDATE
            `;
            const current = await tx.refundRequest.findUnique({ where: { id: refund.id } });
            if (!current || current.status !== 'processing') return;
            const now = new Date();
            await tx.refundRequest.update({
              where: { id: current.id },
              data: { status: 'completed', completedAt: now },
            });
            await tx.paymentTransaction.update({
              where: { id: txn.id },
              data: { status: 'refunded', processedAt: now },
            });
            const appt = refund.appointment;
            await tx.appointment.update({
              where: { id: appt.id },
              data: {
                paymentStatus:
                  Number(current.amount) >= Number(appt.fee)
                    ? 'refunded'
                    : 'partially_refunded',
              },
            });
            await logAudit(null, 'refund.gateway_confirmed', appt.reference, txn.refundReference, tx);
          });
        }
      } catch (err) {
        console.error(`[worker] Refund reconciliation error for request ${refund.id}:`, err);
      }
    }
  }

  if (expired > 0) {
    console.log(`[worker] Expired ${expired} unpaid reservations`);
  }
  return { expired, materialized };
}

async function main(): Promise<void> {
  await ensureDatabaseSchema();
  console.log('[worker] Green Hospital maintenance scheduler started.');

  let running = true;
  const stop = async () => {
    running = false;
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    try {
      await runMaintenanceCycle();
    } catch (err) {
      console.error('[worker] Maintenance cycle failed:', err);
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[worker] Fatal error:', err);
    process.exit(1);
  });
}
