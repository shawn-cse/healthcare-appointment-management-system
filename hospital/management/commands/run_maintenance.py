import time
import logging
from decimal import Decimal
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from hospital.models import DoctorProfile, RefundRequest, PaymentTransaction
from hospital.services import materialize_weekly, reconcile_expired, log
from hospital import gateway

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Refresh future clinic slots, expire missed prepayment deadlines, reconcile gateway refunds.'

    def handle(self,*args,**options):
        while True:
            try:
                expired=reconcile_expired()
                for doctor in DoctorProfile.objects.filter(is_available=True,user__is_active=True):
                    materialize_weekly(doctor,days=min(180,doctor.booking_advance_days))
                if gateway.enabled():
                    qs=RefundRequest.objects.filter(mode='online',status='processing',
                        appointment__payments__kind='refund',appointment__payments__status='processing').distinct()[:80]
                    for refund in qs:
                        txn=refund.appointment.payments.filter(kind='refund',method='online',status='processing').first()
                        if not txn or not txn.refund_reference: continue
                        try:
                            result=gateway.refund_status(txn.refund_reference)
                            if str(result.get('status','')).lower()=='refunded':
                                with transaction.atomic():
                                    r=RefundRequest.objects.select_for_update().get(pk=refund.pk)
                                    if r.status != 'processing': continue
                                    r.status='completed';r.completed_at=timezone.now()
                                    r.save(update_fields=['status','completed_at'])
                                    txn.status='refunded';txn.processed_at=timezone.now()
                                    txn.save(update_fields=['status','processed_at'])
                                    appt=r.appointment
                                    appt.payment_status='refunded' if r.amount>=appt.fee else 'partially_refunded'
                                    appt.save(update_fields=['payment_status','updated_at'])
                                    log(None,'refund.gateway_confirmed',appt.reference,txn.refund_reference)
                        except Exception:
                            logger.exception('Refund reconciliation error for request %s',refund.pk)
                if expired: self.stdout.write(f'Expired {expired} unpaid reservations')
            except Exception:
                logger.exception('Maintenance cycle failed')
            time.sleep(60)
