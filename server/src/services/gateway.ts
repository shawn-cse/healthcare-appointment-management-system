import crypto from 'node:crypto';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { logAudit } from './audit.js';
import { userDisplayName } from './serialize.js';

export function gatewayEnabled(): boolean {
  return Boolean(env.sslcommerzStoreId && env.sslcommerzStorePassword);
}

export function gatewayHttpsReady(): boolean {
  return gatewayEnabled() && env.publicBaseUrl.startsWith('https://');
}

function gatewayBaseUrl(): string {
  return env.sslcommerzLive
    ? 'https://securepay.sslcommerz.com'
    : 'https://sandbox.sslcommerz.com';
}

function gatewayKeys() {
  if (!gatewayEnabled()) {
    throw new HttpError(400, 'Online payment is not configured. Please pay at reception.');
  }
  return {
    store_id: env.sslcommerzStoreId,
    store_passwd: env.sslcommerzStorePassword,
  };
}

export async function initializeGatewayPayment(appointmentId: bigint): Promise<string> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true },
  });
  if (!appt) throw new HttpError(404, 'Appointment not found.');

  if (appt.paymentStatus !== 'unpaid' || !['pending', 'confirmed'].includes(appt.status)) {
    throw new HttpError(400, 'This appointment is no longer awaiting payment.');
  }
  if (appt.status === 'pending' && appt.paymentDueAt && appt.paymentDueAt <= new Date()) {
    throw new HttpError(400, 'The payment deadline has passed. Please arrange a new booking.');
  }
  if (!env.publicBaseUrl.startsWith('https://')) {
    throw new HttpError(400, 'Online payments require a public HTTPS callback URL in PUBLIC_BASE_URL.');
  }
  const fee = Number(appt.fee);
  if (fee < 10 || fee > 500000) {
    throw new HttpError(400, 'Online checkout only supports fees between ৳10 and ৳500,000.');
  }

  const txnId = 'GH' + crypto.randomUUID().replace(/-/g, '').slice(0, 25).toUpperCase();
  const txn = await prisma.paymentTransaction.create({
    data: {
      appointmentId: appt.id,
      kind: 'charge',
      method: 'online',
      status: 'initiated',
      amount: appt.fee,
      externalId: txnId,
    },
  });

  const patientName = appt.patient ? userDisplayName(appt.patient) : appt.guestName;
  const patientEmail = appt.patient?.email || 'billing@greenhospital.local';
  const body = new URLSearchParams({
    ...gatewayKeys(),
    total_amount: fee.toFixed(2),
    currency: 'BDT',
    tran_id: txnId,
    success_url: `${env.publicBaseUrl}/payments/callback/success/`,
    fail_url: `${env.publicBaseUrl}/payments/callback/fail/`,
    cancel_url: `${env.publicBaseUrl}/payments/callback/cancel/`,
    ipn_url: `${env.publicBaseUrl}/payments/callback/ipn/`,
    shipping_method: 'NO',
    product_name: 'Medical consultation',
    product_category: 'healthcare',
    product_profile: 'non-physical-goods',
    cus_name: patientName,
    cus_email: patientEmail,
    cus_add1: 'Dhaka',
    cus_city: 'Dhaka',
    cus_country: 'Bangladesh',
    cus_phone: appt.guestPhone,
  });

  try {
    const res = await fetch(`${gatewayBaseUrl()}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { GatewayPageURL?: string; failedreason?: string };
    const url = data.GatewayPageURL;
    if (!url || !url.startsWith('https://')) {
      throw new Error(data.failedreason || 'Gateway did not return a checkout URL.');
    }
    return url;
  } catch (err) {
    await prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: {
        status: 'failed',
        note: String(err instanceof Error ? err.message : err).slice(0, 250),
      },
    });
    throw new HttpError(400, 'Online checkout is temporarily unavailable. Please try again later.');
  }
}

export async function validateById(validationId: string) {
  if (!validationId) {
    throw new HttpError(400, 'Missing payment validation identifier.');
  }
  const params = new URLSearchParams({
    ...gatewayKeys(),
    val_id: validationId,
    v: '1',
    format: 'json',
  });
  const res = await fetch(
    `${gatewayBaseUrl()}/validator/api/validationserverAPI.php?${params.toString()}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, string>;
}

export async function verifyGatewayCallback(validationId: string) {
  let response: Record<string, string>;
  try {
    response = await validateById(validationId);
  } catch {
    throw new HttpError(400, 'Payment verification could not be completed.');
  }

  if (!['VALID', 'VALIDATED'].includes(response.status) || response.currency !== 'BDT') {
    throw new HttpError(400, 'The payment was not verified by the gateway.');
  }

  const txnId = response.tran_id || '';
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM hospital_paymenttransaction
      WHERE external_id = ${txnId} AND kind = 'charge' AND method = 'online'
      FOR UPDATE
    `;
    if (!locked.length) {
      throw new HttpError(400, 'Unknown transaction.');
    }

    const txn = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: locked[0].id } });
    await tx.$queryRaw`
      SELECT id FROM hospital_appointment WHERE id = ${txn.appointmentId} FOR UPDATE
    `;
    const appt = await tx.appointment.findUniqueOrThrow({ where: { id: txn.appointmentId } });

    if (Number(response.amount || 0) !== Number(txn.amount) || Number(txn.amount) !== Number(appt.fee)) {
      throw new HttpError(400, 'Payment amount differs from the appointment fee.');
    }
    if (txn.status === 'verified') {
      return appt;
    }
    if (appt.paymentStatus !== 'unpaid') {
      throw new HttpError(400, 'This appointment already has a recorded payment.');
    }

    await tx.paymentTransaction.update({
      where: { id: txn.id },
      data: {
        status: 'verified',
        validationId,
        bankTransactionId: response.bank_tran_id || '',
        processedAt: new Date(),
      },
    });

    const deadlinePassed =
      appt.status === 'pending' && Boolean(appt.paymentDueAt && appt.paymentDueAt <= new Date());

    let nextStatus = appt.status;
    let nextPaymentStatus = appt.paymentStatus;
    if (appt.status === 'cancelled' || appt.status === 'expired' || deadlinePassed) {
      if (deadlinePassed) nextStatus = 'expired';
      nextPaymentStatus = 'refund_pending';
      const existing = await tx.refundRequest.findUnique({ where: { appointmentId: appt.id } });
      if (!existing) {
        await tx.refundRequest.create({
          data: {
            appointmentId: appt.id,
            amount: appt.fee,
            mode: 'online',
            status: 'pending',
            reason: 'Payment settled after cancellation or payment deadline',
          },
        });
      }
    } else {
      nextPaymentStatus = 'paid';
      if (appt.status === 'pending') nextStatus = 'confirmed';
    }

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: {
        paymentMethod: 'online',
        paymentStatus: nextPaymentStatus,
        status: nextStatus,
      },
    });

    await logAudit(null, 'payment.gateway_verified', appt.reference, txnId, tx);
    return updated;
  });
}

export async function gatewayRefund(
  bankTransactionId: string,
  amount: number,
  bookingRef: string
): Promise<string> {
  const params = new URLSearchParams({
    ...gatewayKeys(),
    bank_tran_id: bankTransactionId,
    refund_trans_id: 'RF' + crypto.randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase(),
    refund_amount: amount.toFixed(2),
    refund_remarks: `Cancelled appointment ${bookingRef}`,
    v: '1',
    format: 'json',
  });
  const res = await fetch(
    `${gatewayBaseUrl()}/validator/api/merchantTransIDvalidationAPI.php?${params.toString()}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { status?: string; refund_ref_id?: string };
  if (String(data.status || '').toLowerCase() !== 'success' || !data.refund_ref_id) {
    throw new HttpError(
      400,
      'Gateway did not accept the refund request. Please investigate before retrying.'
    );
  }
  return data.refund_ref_id;
}

export async function gatewayRefundStatus(refId: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    ...gatewayKeys(),
    refund_ref_id: refId,
    format: 'json',
  });
  const res = await fetch(
    `${gatewayBaseUrl()}/validator/api/merchantTransIDvalidationAPI.php?${params.toString()}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}
