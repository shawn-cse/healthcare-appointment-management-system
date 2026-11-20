"""Business, permission and reporting tests. Run with: docker compose exec Green_Hospital python manage.py test hospital"""
from datetime import timedelta, time
from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.utils import timezone
from django.core.exceptions import ValidationError, PermissionDenied
from .models import (User,Department,DoctorProfile,AppointmentSlot,Appointment,RefundRequest,
                     PaymentTransaction)
from .services import (create_appointment, record_cash_payment, cancel_appointment,
                       fee_for, approve_refund, finalize_cash_refund, collected_revenue_shares)
from .forms import RegisterForm, StaffForm


class AppointmentSystemTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.department=Department.objects.create(name='Cardiology',slug='cardiology')
        cls.admin=User.objects.create_user(username='admin',password='secureAdmin123!',
            first_name='Hospital',role='admin',phone='01911111111',is_staff=True,is_superuser=True)
        cls.doctor=User.objects.create_user(username='doctor_one',password='secureDoctor123!',
            role='doctor',phone='01811111111',first_name='Karim')
        cls.doc=DoctorProfile.objects.create(user=cls.doctor,department=cls.department,
            initial_fee=1000,followup_fee=800,followup_within_days=30,report_fee=500,
            cancel_fee_mode='percent',cancel_fee_value=Decimal('15'))
        cls.other_doctor=User.objects.create_user(username='doctor_two',password='secureDoctor123!',
            role='doctor',phone='01822222222')
        cls.other_doc=DoctorProfile.objects.create(user=cls.other_doctor,department=cls.department)
        cls.reception=User.objects.create_user(username='reception_one',password='secureReception123!',
            role='receptionist',phone='01711111111')
        cls.doc.receptionists.add(cls.reception)
        cls.patient=User.objects.create_user(username='patient1',email='patient1@greenhospital.local',
            password='securePatient123!',role='patient',phone='01611111111',first_name='Amin',
            last_name='Ahmed',dob='1990-01-01')
        cls.other_patient=User.objects.create_user(username='patient2',password='securePatient123!',
            role='patient',phone='01622222222')
        cls.future=timezone.localdate()+timedelta(days=5)
        cls.slot=AppointmentSlot.objects.create(doctor=cls.doc,date=cls.future,
            start_time=time(15,0),end_time=time(15,30),capacity=1)
        cls.slot_two=AppointmentSlot.objects.create(doctor=cls.other_doc,date=cls.future,
            start_time=time(15,0),end_time=time(15,30),capacity=2)

    def book(self, *, actor=None, slot=None, patient=None, visit_type='first', phone=None):
        actor=actor or self.patient
        return create_appointment(actor=actor,slot_id=(slot or self.slot).pk,
            patient=self.patient if patient is None else patient,
            name='Amin Ahmed',phone=phone or self.patient.phone,
            visit_type=visit_type,source='web' if actor.role=='patient' else 'desk')

    def test_patient_booking_and_capacity(self):
        app=self.book()
        self.assertEqual(app.fee,Decimal('1000'))
        self.assertEqual(app.status,'confirmed')
        self.assertEqual(self.slot.remaining,0)
        with self.assertRaises(ValidationError): self.book()

    def test_staff_cannot_book_unassigned_doctor(self):
        with self.assertRaises(PermissionDenied):
            create_appointment(actor=self.reception,slot_id=self.slot_two.pk,patient=None,
                name='Telephone caller',phone='01733333333',source='phone')

    def test_patient_cannot_book_another_account(self):
        with self.assertRaises(PermissionDenied):
            create_appointment(actor=self.patient,slot_id=self.slot.pk,patient=self.other_patient,
                name='Other',phone=self.other_patient.phone,source='web')

    def test_followup_rule_requires_previous_completed_visit(self):
        with self.assertRaises(ValidationError):
            fee_for(self.doc,'followup',patient=self.patient,appointment_date=self.future)
        earlier=AppointmentSlot.objects.create(doctor=self.doc,date=self.future-timedelta(days=10),
            start_time=time(10,0),end_time=time(10,30),capacity=1)
        Appointment.objects.create(slot=earlier,patient=self.patient,guest_name=self.patient.display_name,
            guest_phone=self.patient.phone,visit_type='first',status='completed',payment_status='paid',fee=Decimal('1000'))
        self.assertEqual(fee_for(self.doc,'followup',patient=self.patient,appointment_date=self.future),Decimal('800'))
        self.assertEqual(self.book(visit_type='followup').fee,Decimal('800'))

    def test_doctor_cancel_refunds_full_amount(self):
        app=self.book()
        record_cash_payment(app,self.reception)
        result=cancel_appointment(app,self.doctor,by_doctor=True,reason='Doctor unavailable')
        self.assertEqual(result.status,'cancelled')
        r=RefundRequest.objects.get(appointment=app)
        self.assertEqual(r.amount,Decimal('1000'))
        approve_refund(r.pk,self.reception)
        finalize_cash_refund(r.pk,self.reception)
        app.refresh_from_db()
        self.assertEqual(app.payment_status,'refunded')
        self.assertEqual(PaymentTransaction.objects.filter(appointment=app,kind='refund',status='refunded').count(),1)

    def test_patient_cancellation_uses_fee_at_booking_time(self):
        app=self.book()
        record_cash_payment(app,self.reception)
        self.doc.cancel_fee_value=Decimal('90')
        self.doc.save(update_fields=['cancel_fee_value'])
        cancel_appointment(app,self.patient,reason='Changed plans')
        r=RefundRequest.objects.get(appointment=app)
        self.assertEqual(r.amount,Decimal('850.00'))  # 15% penalty as initially booked

    def test_cross_role_login_guard(self):
        response=self.client.post(reverse('login_screen',args=['staff']),{'identifier':self.patient.phone,'password':'securePatient123!'})
        self.assertEqual(response.status_code,200)
        self.assertContains(response,'patient account')
        response=self.client.post(reverse('login_screen',args=['patient']),{'identifier':self.doctor.username,'password':'secureDoctor123!'})
        self.assertEqual(response.status_code,200)
        self.assertContains(response,'staff account')

    def test_staff_can_log_in_by_email_or_phone(self):
        self.doctor.email='karim@example.org';self.doctor.save(update_fields=['email'])
        self.assertTrue(self.client.login(username='karim@example.org',password='secureDoctor123!'))
        self.client.logout()
        self.assertTrue(self.client.login(username=self.doctor.phone,password='secureDoctor123!'))

    def test_patient_cannot_view_someone_elses_appointment(self):
        app=self.book()
        self.client.force_login(self.other_patient)
        self.assertEqual(self.client.get(reverse('appointment_detail',args=[app.pk])).status_code,404)
        self.client.force_login(self.other_doctor)
        self.assertEqual(self.client.get(reverse('appointment_detail',args=[app.pk])).status_code,404)

    def test_guest_history_not_exposed_by_registration(self):
        app=create_appointment(actor=self.reception,slot_id=self.slot.pk,patient=None,
            name='New phone caller',phone='01755555555',source='phone')
        form=RegisterForm(data={'first_name':'New','last_name':'Caller','phone':'01755555555',
            'dob':'1995-03-04','email':'','nid':'','address':'',
            'password1':'StrongAppointment123!','password2':'StrongAppointment123!'})
        self.assertTrue(form.is_valid(),form.errors)
        user=form.save()
        app.refresh_from_db()
        self.assertIsNone(app.patient_id)
        self.client.force_login(user)
        self.assertEqual(self.client.get(reverse('appointment_detail',args=[app.pk])).status_code,404)

    def test_excel_export_requires_reporting_permission(self):
        self.client.force_login(self.reception)
        response=self.client.get(reverse('export_excel'))
        self.assertEqual(response.status_code,302)
        self.client.force_login(self.admin)
        response=self.client.get(reverse('export_excel'))
        self.assertEqual(response.status_code,200)
        self.assertEqual(response['Content-Type'],'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.assertTrue(response.content.startswith(b'PK'))

    def test_admin_can_log_in_without_mandatory_password_change(self):
        response=self.client.post(reverse('login_screen',args=['staff']),
                                  {'identifier':'admin','password':'secureAdmin123!'})
        self.assertRedirects(response,reverse('dashboard'))
        self.assertEqual(self.client.get('/admin/').status_code,200)

    def test_patient_login_supports_username_phone_and_email(self):
        # 1. Login with username
        response=self.client.post(reverse('login_screen',args=['patient']),
                {'identifier':self.patient.username,'password':'securePatient123!'})
        self.assertRedirects(response,reverse('dashboard'))
        self.client.logout()

        # 2. Login with phone
        response=self.client.post(reverse('login_screen',args=['patient']),
                {'identifier':self.patient.phone,'password':'securePatient123!'})
        self.assertRedirects(response,reverse('dashboard'))
        self.client.logout()

        # 3. Login with email
        response=self.client.post(reverse('login_screen',args=['patient']),
                {'identifier':self.patient.email,'password':'securePatient123!'})
        self.assertRedirects(response,reverse('dashboard'))
        self.client.logout()

    def test_patient_registration_auto_assigns_username_when_blank(self):
        from hospital.forms import RegisterForm
        data = {
            'first_name': 'Test',
            'last_name': 'User',
            'username': '',
            'phone': '01633333333',
            'dob': '1992-05-10',
            'email': 'testuser@example.com',
            'password1': 'SecureTest123!',
            'password2': 'SecureTest123!',
        }
        form = RegisterForm(data=data)
        self.assertTrue(form.is_valid(), form.errors)
        user = form.save()
        self.assertTrue(user.username.startswith('patient'))

    def test_new_doctor_requires_department_and_receptionist(self):
        values={'role':'doctor','first_name':'New','last_name':'Doctor',
                'username':'new_doctor','email':'new.doctor@example.org',
                'phone':'01855555555','is_active':True,'new_password':'AnUniquePassword123!'}
        form=StaffForm(data=values)
        self.assertFalse(form.is_valid())
        self.assertIn('department',form.errors)
        self.assertIn('assigned_receptionist',form.errors)
        values.update({'department':str(self.department.pk),'assigned_receptionist':str(self.reception.pk)})
        form=StaffForm(data=values)
        self.assertTrue(form.is_valid(),form.errors)

    def test_cash_payment_rejected_after_deadline(self):
        self.doc.payment_policy='within'
        self.doc.save(update_fields=['payment_policy'])
        booking=self.book()
        booking.payment_due_at=timezone.now()-timedelta(minutes=1)
        booking.save(update_fields=['payment_due_at'])
        with self.assertRaises(ValidationError):
            record_cash_payment(booking,self.reception)
        booking.refresh_from_db()
        self.assertEqual(booking.payment_status,'unpaid')

    def test_new_doctor_onboarding_saves_assignment(self):
        self.client.force_login(self.admin)
        response=self.client.post(reverse('staff_new'),{
            'role':'doctor','first_name':'New','last_name':'Doctor','username':'new_doctor',
            'email':'new.doctor@example.org','phone':'01855555555','is_active':'on',
            'new_password':'AnUniquePassword123!', 'department':str(self.department.pk),
            'assigned_receptionist':str(self.reception.pk)})
        self.assertRedirects(response,reverse('staff_list'))
        doctor=DoctorProfile.objects.get(user__username='new_doctor')
        self.assertTrue(doctor.receptionists.filter(pk=self.reception.pk).exists())

    def test_new_admin_has_full_administrator_permissions(self):
        self.client.force_login(self.admin)
        response=self.client.post(reverse('staff_new'),{
            'role':'admin','first_name':'Hospital','last_name':'Manager',
            'username':'hospital_manager','email':'manager@example.org',
            'phone':'01955555555','new_password':'AnUniquePassword123!',
            'is_active':'on'})
        self.assertRedirects(response,reverse('staff_list'))
        member=User.objects.get(username='hospital_manager')
        self.assertTrue(member.is_staff)
        self.assertTrue(member.is_superuser)
        self.client.force_login(member)
        self.assertEqual(self.client.get('/admin/').status_code,200)

    def test_financial_shares_account_for_partial_refund(self):
        app=self.book()
        record_cash_payment(app,self.reception)
        cancel_appointment(app,self.patient)
        request=RefundRequest.objects.get(appointment=app)
        approve_refund(request.pk,self.reception)
        finalize_cash_refund(request.pk,self.reception)
        house,doctor=collected_revenue_shares(Appointment.objects.filter(pk=app.pk))
        self.assertEqual(house+doctor, Decimal('150.00'))
        self.assertEqual(house,Decimal('15.00'))
        self.assertEqual(doctor,Decimal('135.00'))

    def test_excel_escapes_untrusted_patient_values(self):
        create_appointment(actor=self.reception,slot_id=self.slot.pk,patient=None,
            name='=2+2',phone='01744444444',source='phone')
        self.client.force_login(self.admin)
        response=self.client.get(reverse('export_excel'))
        from openpyxl import load_workbook
        from io import BytesIO
        wb=load_workbook(BytesIO(response.content))
        sheet=wb['Appointments']
        self.assertEqual(sheet.cell(2,6).data_type,'s')
        self.assertEqual(sheet.cell(2,6).value,"'=2+2")
