"""SSLCOMMERZ hosted checkout; never trust a browser callback without server validation."""
import uuid
from decimal import Decimal
import requests
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from .models import Appointment, PaymentTransaction, RefundRequest


def enabled():
    return bool(settings.SSLCOMMERZ_STORE_ID and settings.SSLCOMMERZ_STORE_PASSWORD)


def base():
    return 'https://securepay.sslcommerz.com' if settings.SSLCOMMERZ_LIVE else 'https://sandbox.sslcommerz.com'


def keys():
    if not enabled():
        raise ValidationError('Online payment is not configured. Please pay at reception.')
    return {'store_id': settings.SSLCOMMERZ_STORE_ID, 'store_passwd': settings.SSLCOMMERZ_STORE_PASSWORD}


def initialize(appointment):
    # This view is used only by a patient who owns the appointment.
    appointment.refresh_from_db()
    if appointment.payment_status != 'unpaid' or appointment.status not in ('pending','confirmed'):
        raise ValidationError('This appointment is no longer awaiting payment.')
    if appointment.status == 'pending' and appointment.payment_due_at and appointment.payment_due_at <= timezone.now():
        raise ValidationError('The payment deadline has passed. Please arrange a new booking.')
    if not settings.PUBLIC_BASE_URL.startswith('https://'):
        raise ValidationError('Online payments require a public HTTPS callback URL in PUBLIC_BASE_URL.')
    if not Decimal('10.00') <= appointment.fee <= Decimal('500000.00'):
        raise ValidationError('Online checkout only supports fees between ৳10 and ৳500,000.')
    txn_id = 'GH' + uuid.uuid4().hex[:25].upper()
    txn = PaymentTransaction.objects.create(appointment=appointment, kind='charge', method='online',
                                            status='initiated', amount=appointment.fee, external_id=txn_id)
    payload = {
        **keys(), 'total_amount': str(appointment.fee), 'currency': 'BDT', 'tran_id': txn_id,
        'success_url': settings.PUBLIC_BASE_URL + '/payments/callback/success/',
        'fail_url': settings.PUBLIC_BASE_URL + '/payments/callback/fail/',
        'cancel_url': settings.PUBLIC_BASE_URL + '/payments/callback/cancel/',
        'ipn_url': settings.PUBLIC_BASE_URL + '/payments/callback/ipn/',
        'shipping_method': 'NO', 'product_name': 'Medical consultation',
        'product_category': 'healthcare', 'product_profile': 'non-physical-goods',
        'cus_name': appointment.patient_name, 'cus_email': appointment.patient.email if appointment.patient_id and appointment.patient.email else 'billing@greenhospital.local',
        'cus_add1': 'Dhaka', 'cus_city': 'Dhaka', 'cus_country': 'Bangladesh',
        'cus_phone': appointment.guest_phone,
    }
    try:
        res = requests.post(base() + '/gwprocess/v4/api.php', data=payload, timeout=20)
        res.raise_for_status()
        data = res.json()
        url = data.get('GatewayPageURL')
        if not url or not url.startswith('https://'):
            raise ValueError(data.get('failedreason', 'Gateway did not return a checkout URL.'))
        return url
    except (requests.RequestException, ValueError) as exc:
        txn.status = 'failed'
        txn.note = str(exc)[:250]
        txn.save(update_fields=['status','note'])
        raise ValidationError('Online checkout is temporarily unavailable. Please try again later.') from exc


def validate_by_id(validation_id):
    if not validation_id:
        raise ValidationError('Missing payment validation identifier.')
    res = requests.get(base() + '/validator/api/validationserverAPI.php', params={
        **keys(), 'val_id': validation_id, 'v': '1', 'format': 'json'}, timeout=20)
    res.raise_for_status()
    return res.json()


def verify_callback(validation_id):
    """Use locked transaction and merchant-side validation of status, ID, currency, amount."""
    try:
        response = validate_by_id(validation_id)
    except (requests.RequestException, ValueError) as exc:
        raise ValidationError('Payment verification could not be completed.') from exc
    if response.get('status') not in ('VALID','VALIDATED') or response.get('currency') != 'BDT':
        raise ValidationError('The payment was not verified by the gateway.')
    txn_id = response.get('tran_id', '')
    with transaction.atomic():
        txn = PaymentTransaction.objects.select_for_update().select_related('appointment').filter(
            external_id=txn_id, kind='charge', method='online').first()
        if txn is None:
            raise ValidationError('Unknown transaction.')
        appt = Appointment.objects.select_for_update().get(pk=txn.appointment_id)
        if Decimal(str(response.get('amount', '0'))) != txn.amount or txn.amount != appt.fee:
            raise ValidationError('Payment amount differs from the appointment fee.')
        if txn.status == 'verified':
            return appt
        if appt.payment_status not in ('unpaid',):
            raise ValidationError('This appointment already has a recorded payment.')
        txn.status = 'verified'
        txn.validation_id = validation_id
        txn.bank_transaction_id = response.get('bank_tran_id', '')
        txn.processed_at = timezone.now()
        txn.save(update_fields=['status','validation_id','bank_transaction_id','processed_at'])
        appt.payment_method = 'online'
        payment_deadline_passed = (appt.status == 'pending' and appt.payment_due_at and
                                   appt.payment_due_at <= timezone.now())
        if appt.status in ('cancelled','expired') or payment_deadline_passed:
            # A late gateway settlement must not reclaim an expired slot.
            if payment_deadline_passed:
                appt.status = 'expired'
            appt.payment_status = 'refund_pending'
            RefundRequest.objects.get_or_create(appointment=appt, defaults={
                'amount': appt.fee, 'mode': 'online',
                'reason': 'Payment settled after cancellation or payment deadline'})
        else:
            appt.payment_status = 'paid'
            if appt.status == 'pending':
                appt.status = 'confirmed'
        appt.save(update_fields=['payment_method','payment_status','status','updated_at'])
        from .services import log
        log(None, 'payment.gateway_verified', appt.reference, txn_id)
        return appt


def gateway_refund(bank_transaction_id, amount, booking_ref):
    params = {**keys(), 'bank_tran_id': bank_transaction_id,
              'refund_trans_id': 'RF' + uuid.uuid4().hex[:26].upper(),
              'refund_amount': str(amount), 'refund_remarks': 'Cancelled appointment ' + booking_ref,
              'v': '1', 'format': 'json'}
    response = requests.get(base() + '/validator/api/merchantTransIDvalidationAPI.php',
                            params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    if str(data.get('status','')).lower() != 'success' or not data.get('refund_ref_id'):
        raise ValidationError('Gateway did not accept the refund request. Please investigate before retrying.')
    return data['refund_ref_id']


def refund_status(ref_id):
    r = requests.get(base() + '/validator/api/merchantTransIDvalidationAPI.php',
                     params={**keys(), 'refund_ref_id': ref_id, 'format': 'json'}, timeout=20)
    r.raise_for_status()
    return r.json()
