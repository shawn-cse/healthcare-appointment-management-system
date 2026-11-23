"""Business, permission and reporting tests. Run with: docker compose exec Green_Hospital python manage.py test hospital"""
from datetime import timedelta, time
from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.utils import timezone
from django.core.exceptions import ValidationError, PermissionDenied
from .models import (User,Department,DoctorProfile,AppointmentSlot,Appointment,RefundRequest,
                     PaymentTransaction, Chamber, WeeklyAvailability, Complaint, ComplaintMessage)
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
        cls.weekly=WeeklyAvailability.objects.create(doctor=cls.doc,weekday=cls.future.weekday(),
            start_time=time(15,0),end_time=time(15,30),capacity=1)
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

    def test_role_based_logout_redirection(self):
        # Patient logout redirects to patient login screen
        self.client.force_login(self.patient)
        resp_patient = self.client.post(reverse('logout'))
        self.assertRedirects(resp_patient, reverse('login_screen', args=['patient']))

        # Staff logout redirects to staff login screen
        self.client.force_login(self.admin)
        resp_staff = self.client.post(reverse('logout'))
        self.assertRedirects(resp_staff, reverse('login_screen', args=['staff']))

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
        chamber = Chamber.objects.create(building='Building 1', room_number='Chamber 302', floor='3rd Floor')
        values = {'role':'doctor','first_name':'New','last_name':'Doctor',
                  'username':'new_doctor','email':'new.doctor@example.org',
                  'phone':'01855555555','is_active':True,'new_password':'AnUniquePassword123!'}
        form = StaffForm(data=values)
        self.assertFalse(form.is_valid())
        self.assertIn('department', form.errors)
        self.assertIn('assigned_receptionist', form.errors)
        self.assertIn('chamber', form.errors)
        self.assertIn('consultation_days', form.errors)
        values.update({
            'department': str(self.department.pk),
            'assigned_receptionist': str(self.reception.pk),
            'chamber': str(chamber.pk),
            'consultation_days': ['0', '2', '4'],
            'consultation_start_time': '18:00',
            'consultation_end_time': '20:00'
        })
        form = StaffForm(data=values)
        self.assertTrue(form.is_valid(), form.errors)

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
        chamber = Chamber.objects.create(building='Building 1', room_number='Chamber 302', floor='3rd Floor')
        self.client.force_login(self.admin)
        response = self.client.post(reverse('staff_new'), {
            'role': 'doctor', 'first_name': 'New', 'last_name': 'Doctor', 'username': 'new_doctor',
            'email': 'new.doctor@example.org', 'phone': '01855555555', 'is_active': 'on',
            'new_password': 'AnUniquePassword123!', 'department': str(self.department.pk),
            'assigned_receptionist': str(self.reception.pk),
            'chamber': str(chamber.pk),
            'consultation_days': ['0', '2', '4'],
            'consultation_start_time': '18:00',
            'consultation_end_time': '20:00'
        })
        self.assertRedirects(response, reverse('staff_list'))
        doctor = DoctorProfile.objects.get(user__username='new_doctor')
        self.assertTrue(doctor.receptionists.filter(pk=self.reception.pk).exists())
        self.assertEqual(doctor.chamber_id, chamber.pk)

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
        create_appointment(actor=self.reception, slot_id=self.slot.pk, patient=None,
            name='=2+2', phone='01744444444', source='phone')
        self.client.force_login(self.admin)
        response = self.client.get(reverse('export_excel') + f'?from={timezone.localdate()}&to={self.future}')
        from openpyxl import load_workbook
        from io import BytesIO
        wb = load_workbook(BytesIO(response.content))
        sheet = wb['Appointments']
        self.assertEqual(sheet.cell(2, 6).data_type, 's')
        self.assertEqual(sheet.cell(2, 6).value, "'=2+2")

    def test_public_can_browse_doctors_and_departments_without_login(self):
        # 1. Doctor Directory is accessible without authentication
        response = self.client.get(reverse('doctor_directory'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Consult Our Specialist Doctors')

        # 2. Search, department multi-select, gender and sort work
        response = self.client.get(reverse('doctor_directory') + '?q=doctor&sort=fee_asc&gender=male')
        self.assertEqual(response.status_code, 200)

        # 3. Favicon is accessible and redirects to SVG
        fav_response = self.client.get('/favicon.ico')
        self.assertEqual(fav_response.status_code, 301)
        self.assertEqual(fav_response.url, '/static/favicon.svg')

        # 4. Public Departments directory is accessible
        response = self.client.get(reverse('public_departments'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Specialized Medical Departments')

    def test_doctor_profile_displays_chamber_details_and_schedules(self):
        # Doctor Profile is accessible via semantic slug without authentication
        response = self.client.get(reverse('doctor_detail', args=[self.doc.profile_slug]))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Book Appointment')
        self.assertContains(response, 'Room')
        self.assertContains(response, 'SCHEDULE')
        self.assertNotContains(response, 'Address')

        # Backward compatibility with PK also works
        response_pk = self.client.get(reverse('doctor_detail', args=[self.doc.pk]))
        self.assertEqual(response_pk.status_code, 200)

    def test_unauthenticated_user_booking_redirects_to_login(self):
        # Trying to book directly without authentication redirects to login with next param
        response = self.client.get(reverse('patient_book', args=[self.slot.pk]))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/login/', response.url)

    def test_complaints_and_support_three_step_lifecycle_and_qa_flow(self):
        # 1. Step 1: Patient generates a Support / Complaint ticket
        self.client.force_login(self.patient)
        resp = self.client.post(reverse('complaint_new'), {
            'category': 'support',
            'subject': 'Inquiry about report collection',
            'message': 'When can I collect my cardiology ECG report from room 201?'
        })
        self.assertEqual(resp.status_code, 302)
        complaint = Complaint.objects.get(patient=self.patient, subject='Inquiry about report collection')
        self.assertEqual(complaint.status, 'submitted')
        self.assertEqual(complaint.status_step, 1)
        self.assertEqual(complaint.step_label, 'Support Help Generated')
        self.assertTrue(complaint.display_code.startswith('TK-'))
        self.assertEqual(len(complaint.display_code), 7)  # TK-XXXX (4-digit random combination)

        # Patient view shows ticket in Step 1
        resp_patient = self.client.get(reverse('complaints'))
        self.assertEqual(resp_patient.status_code, 200)
        self.assertContains(resp_patient, 'Support Generated')
        self.assertContains(resp_patient, complaint.display_code)
        self.assertContains(resp_patient, 'When can I collect my cardiology ECG report')

        # 2. Step 2: Admin checks ticket in Excel sheet queue and filters/sorts
        self.client.force_login(self.admin)
        resp_queue = self.client.get(reverse('complaint_queue') + '?sort=oldest')
        self.assertEqual(resp_queue.status_code, 200)
        self.assertContains(resp_queue, 'Inquiry about report collection')
        self.assertContains(resp_queue, complaint.display_code)

        # Admin updates status to Under Review & Inquiring
        resp_inquire = self.client.post(reverse('complaint_update', args=[complaint.pk]), {
            'status': 'reviewing',
            'response': 'Inquiry received. Checking records with diagnostic laboratory.'
        })
        self.assertEqual(resp_inquire.status_code, 302)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, 'reviewing')
        self.assertEqual(complaint.status_step, 2)
        self.assertEqual(complaint.step_label, 'Under Review & Inquiring')

        # Patient views Under Review status
        self.client.force_login(self.patient)
        resp_patient_view = self.client.get(reverse('complaints'))
        self.assertContains(resp_patient_view, 'Under Review & Inquiring')
        self.assertContains(resp_patient_view, 'Checking records with diagnostic laboratory')

        # 3. Step 3: Admin verifies and marks as Issue Solved
        self.client.force_login(self.admin)
        resp_solve = self.client.post(reverse('complaint_update', args=[complaint.pk]), {
            'status': 'resolved',
            'response': 'Report INV-88291 is ready at Chamber 201 reception desk. Thank you!'
        })
        self.assertEqual(resp_solve.status_code, 302)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, 'resolved')
        self.assertEqual(complaint.status_step, 3)
        self.assertEqual(complaint.step_label, 'Issue Solved')

        # 4. Patient view shows Issue Solved
        self.client.force_login(self.patient)
        resp_final = self.client.get(reverse('complaints'))
        self.assertContains(resp_final, 'Issue Solved')
        self.assertContains(resp_final, 'Report INV-88291 is ready at Chamber 201 reception desk')

        # 5. Admin bulk status update test
        self.client.force_login(self.admin)
        resp_bulk = self.client.post(reverse('complaint_bulk'), {
            'selected_complaints': [complaint.pk],
            'bulk_status': 'reviewing'
        })
        self.assertEqual(resp_bulk.status_code, 302)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, 'reviewing')

        # 6. Test file uploads (PDF, DOCX, Image) without InvalidStorageError
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.client.force_login(self.patient)
        pdf_file = SimpleUploadedFile("test_report.pdf", b"%PDF-1.4 test document", content_type="application/pdf")
        resp_upload = self.client.post(reverse('complaint_new'), {
            'category': 'support',
            'subject': 'ECG file upload test',
            'message': 'Please review my attached ECG report.',
            'attachment': pdf_file
        })
        self.assertEqual(resp_upload.status_code, 302)
        file_complaint = Complaint.objects.get(patient=self.patient, subject='ECG file upload test')
        self.assertTrue(bool(file_complaint.attachment))
        self.assertIn('test_report', file_complaint.attachment.name)

        # Admin attached resolution document
        self.client.force_login(self.admin)
        docx_file = SimpleUploadedFile("resolution_notes.docx", b"PK docx binary content", content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        resp_admin_file = self.client.post(reverse('complaint_update', args=[file_complaint.pk]), {
            'status': 'resolved',
            'response': 'Case solved and stamped.',
            'admin_attachment': docx_file
        })
        self.assertEqual(resp_admin_file.status_code, 302)
        file_complaint.refresh_from_db()
        self.assertEqual(file_complaint.status, 'resolved')
        self.assertTrue(bool(file_complaint.admin_attachment))
        self.assertIn('resolution_notes', file_complaint.admin_attachment.name)

    def test_doctor_panel_navigation_and_team_directory(self):
        # 1. Doctor navigates to dashboard: navigation shows 'Dashboard' and 'Staff & Doctors'
        self.client.force_login(self.doctor)
        resp_dash = self.client.get(reverse('dashboard'))
        self.assertEqual(resp_dash.status_code, 200)
        self.assertContains(resp_dash, 'Staff & Doctors')
        self.assertContains(resp_dash, 'Dashboard')
        self.assertNotContains(resp_dash, 'Overview')

        # 2. Receptionist navigates to dashboard and team directory
        self.client.force_login(self.reception)
        resp_rec_dash = self.client.get(reverse('dashboard'))
        self.assertEqual(resp_rec_dash.status_code, 200)
        self.assertContains(resp_rec_dash, 'Staff & Doctors')
        self.assertContains(resp_rec_dash, 'Dashboard')
        self.assertNotContains(resp_rec_dash, 'Overview')
        resp_rec_team = self.client.get(reverse('staff_list'))
        self.assertEqual(resp_rec_team.status_code, 200)

        # 3. Doctor accesses /team/ (Staff & Doctor directory)
        self.client.force_login(self.doctor)
        resp_team = self.client.get(reverse('staff_list'))
        self.assertEqual(resp_team.status_code, 200)
        self.assertContains(resp_team, 'Staff &amp; Doctors')
        self.assertContains(resp_team, 'Dr. Karim')
        self.assertContains(resp_team, 'reception_one')
        self.assertContains(resp_team, reverse('doctor_detail', args=[self.doc.profile_slug]))
        # Excel sheet live search and filter controls
        self.assertContains(resp_team, 'staff-search-input')
        self.assertContains(resp_team, 'btn-staff-search')
        self.assertContains(resp_team, 'filter-role-select')
        # Doctor cannot see admin actions
        self.assertNotContains(resp_team, reverse('staff_new'))
        self.assertNotContains(resp_team, reverse('staff_edit', args=[self.doctor.pk]))

        # 4. Admin accesses /team/ and can see management action buttons and Dashboard in nav
        self.client.force_login(self.admin)
        resp_admin_dash = self.client.get(reverse('dashboard'))
        self.assertContains(resp_admin_dash, 'Dashboard')
        self.assertNotContains(resp_admin_dash, 'Overview')
        resp_admin_team = self.client.get(reverse('staff_list'))
        self.assertEqual(resp_admin_team.status_code, 200)
        self.assertContains(resp_admin_team, 'Add Team Member')
        self.assertContains(resp_admin_team, reverse('staff_new'))
        self.assertContains(resp_admin_team, reverse('staff_edit', args=[self.doctor.pk]))

        # 5. Patient cannot access /team/ (permission denied / redirected)
        self.client.force_login(self.patient)
        resp_patient_team = self.client.get(reverse('staff_list'))
        self.assertIn(resp_patient_team.status_code, (302, 403))

    def test_complaint_support_desk_scoping_doctor_and_admin(self):
        # Create appointment for Doctor 1 (self.doctor) with self.patient
        appt1 = self.book(actor=self.patient, slot=self.slot)
        # Create appointment for Doctor 2 (self.other_doctor) with self.other_patient
        appt2 = self.book(actor=self.other_patient, patient=self.other_patient, slot=self.slot_two)

        # 1. Ticket linked to Doctor 1's appointment
        c_doc1 = Complaint.objects.create(
            patient=self.patient,
            appointment=appt1,
            category='doctor',
            subject='Consultation inquiry for Dr. Karim',
            message='Please clarify dosage instructed.'
        )

        # 2. Ticket linked to Doctor 2's appointment
        c_doc2 = Complaint.objects.create(
            patient=self.patient,
            appointment=appt2,
            category='doctor',
            subject='Inquiry for second doctor',
            message='Waiting time question.'
        )

        # 3. General support ticket not tied to any appointment
        c_general = Complaint.objects.create(
            patient=self.patient,
            appointment=None,
            category='support',
            subject='Parking and lift inquiry',
            message='Is elevator 2 working?'
        )

        # Doctor 1 accesses Complaint & Support Desk
        self.client.force_login(self.doctor)
        resp_doc = self.client.get(reverse('complaint_queue'))
        self.assertEqual(resp_doc.status_code, 200)
        # Verify navigation has Complaint & Support Desk
        self.assertContains(resp_doc, 'Complaint & Support Desk')
        self.assertNotContains(resp_doc, 'Patient Concerns')
        # Doctor 1 sees ONLY ticket linked to their own appointment
        self.assertContains(resp_doc, c_doc1.display_code)
        self.assertNotContains(resp_doc, c_doc2.display_code)
        self.assertNotContains(resp_doc, c_general.display_code)

        # Doctor 1 can update their own ticket
        resp_up = self.client.post(reverse('complaint_update', args=[c_doc1.pk]), {
            'status': 'resolved',
            'response': 'Prescription clarified with patient via telephone.'
        })
        self.assertEqual(resp_up.status_code, 302)
        c_doc1.refresh_from_db()
        self.assertEqual(c_doc1.status, 'resolved')

        # Admin accesses Complaint & Support Desk
        self.client.force_login(self.admin)
        resp_admin = self.client.get(reverse('complaint_queue'))
        self.assertEqual(resp_admin.status_code, 200)
        # Admin sees complete support desk (all 3 tickets)
        self.assertContains(resp_admin, c_doc1.display_code)
        self.assertContains(resp_admin, c_doc2.display_code)
        self.assertContains(resp_admin, c_general.display_code)

        # Admin filters by Doctor 1
        resp_admin_filtered = self.client.get(reverse('complaint_queue') + f'?doctor={self.doc.pk}')
        self.assertContains(resp_admin_filtered, c_doc1.display_code)
        self.assertNotContains(resp_admin_filtered, c_doc2.display_code)
        self.assertNotContains(resp_admin_filtered, c_general.display_code)

    def test_clinical_timepicker_formats_and_widget(self):
        from hospital.forms import TIME, SlotForm, WeeklyForm
        # 1. Verify TIME widget configuration
        self.assertEqual(TIME.attrs.get('data-timepicker'), 'true')
        self.assertIn('green-timepicker', TIME.attrs.get('class', ''))
        self.assertEqual(TIME.input_type, 'text')

        # 2. Verify SlotForm accepts both 24h and 12h AM/PM formats
        tomorrow = timezone.localdate() + timedelta(days=2)
        slot_data_24h = {
            'doctor': self.doc.pk,
            'date': tomorrow.isoformat(),
            'start_time': '16:00',
            'end_time': '16:30',
            'capacity': 10,
            'is_open': True
        }
        doc_qs = DoctorProfile.objects.filter(pk=self.doc.pk)
        form_24h = SlotForm(data=slot_data_24h, doctors=doc_qs)
        self.assertTrue(form_24h.is_valid(), f"SlotForm 24h errors: {form_24h.errors}")

        slot_data_12h = {
            'doctor': self.doc.pk,
            'date': tomorrow.isoformat(),
            'start_time': '04:00 PM',
            'end_time': '04:30 PM',
            'capacity': 10,
            'is_open': True
        }
        form_12h = SlotForm(data=slot_data_12h, doctors=doc_qs)
        self.assertTrue(form_12h.is_valid(), f"SlotForm 12h errors: {form_12h.errors}")

        # 3. Verify weekly availability form accepts 12h AM/PM format
        weekly_data = {
            'weekday': 0,
            'start_time': '09:30 AM',
            'end_time': '01:30 PM',
            'duration_minutes': 15,
            'capacity': 20,
            'active': True
        }
        form_weekly = WeeklyForm(data=weekly_data)
        self.assertTrue(form_weekly.is_valid(), f"WeeklyForm 12h errors: {form_weekly.errors}")



