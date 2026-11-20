import csv
from datetime import timedelta, datetime
from decimal import Decimal
from functools import wraps
from io import BytesIO
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordChangeForm
from django.core.exceptions import ValidationError, PermissionDenied
from django.db import transaction
from django.db.models import Count, Q, Sum, F
from django.core.paginator import Paginator
from django.http import HttpResponse, JsonResponse, Http404
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from .models import (User, DoctorProfile, Department, Appointment, AppointmentSlot,
                     WeeklyAvailability, PaymentTransaction, RefundRequest, Complaint, HospitalPolicy, AuditEvent, Chamber)
from .forms import (RegisterForm, ProfileForm, StaffForm, DoctorSettingsForm, WeeklyForm, SlotForm,
                    PatientBookingForm, ReceptionBookingForm, ComplaintForm, PolicyForm,
                    StaffAssistedBookingForm, ChamberForm)
from .services import (create_appointment, materialize_weekly, record_cash_payment, cancel_appointment,
                       change_visit_status, approve_refund, finalize_cash_refund,
                       managed_doctors, doctor_allowed, appointment_allowed, log, local_start, valid_slot,
                       collected_revenue_shares)
from . import gateway


def role_required(*roles):
    def outer(fn):
        @wraps(fn)
        @login_required
        def inner(request, *args, **kwargs):
            if request.user.role not in roles:
                messages.error(request, 'You do not have access to this section.')
                return redirect('dashboard')
            return fn(request, *args, **kwargs)
        return inner
    return outer


def try_action(request, callback, success_url, success_text):
    try:
        callback()
        messages.success(request, success_text)
    except (ValidationError, PermissionDenied) as exc:
        messages.error(request, '; '.join(exc.messages) if hasattr(exc, 'messages') else str(exc))
    return redirect(success_url)


def home(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    return render(request, 'shared/home.html', {
        'departments': Department.objects.filter(is_active=True)[:10],
        'doctors': DoctorProfile.objects.filter(is_available=True, user__is_active=True).select_related('user','department')[:6],
        'doctor_count': DoctorProfile.objects.filter(user__is_active=True).count(),
    })


def login_choice(request):
    return render(request, 'auth/choose.html')


def login_screen(request, kind):
    if kind not in ('patient','staff'):
        raise Http404()
    if request.user.is_authenticated:
        return redirect('dashboard')
    next_url = request.GET.get('next') or request.POST.get('next')
    if request.method == 'POST':
        identifier = request.POST.get('identifier', '').strip()
        password = request.POST.get('password', '')
        user = authenticate(request, username=identifier, password=password)
        if user is None:
            messages.error(request, 'Incorrect login details. Please verify your credentials and try again.')
        elif kind == 'patient' and user.role != 'patient':
            messages.error(request, 'This is a staff account. Please sign in through the staff portal.')
        elif kind == 'staff' and user.role == 'patient':
            messages.error(request, 'This is a patient account. Please sign in through the patient portal.')
        else:
            login(request, user)
            messages.success(request, f'Welcome back, {user.first_name or user.username}.')
            if next_url and next_url.startswith('/'):
                return redirect(next_url)
            return redirect('dashboard')
    return render(request, 'auth/login.html', {'kind': kind, 'next': next_url})


def register(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    next_url = request.GET.get('next') or request.POST.get('next')
    form = RegisterForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user, backend='hospital.auth_backends.RoleAwareBackend')
        log(user, 'patient.registered', user.pk)
        messages.success(request, 'Your account has been created. Welcome to Green Hospital.')
        if next_url and next_url.startswith('/'):
            return redirect(next_url)
        return redirect('dashboard')
    return render(request, 'auth/register.html', {'form': form, 'next': next_url})


@require_POST
@login_required
def log_out(request):
    logout(request)
    messages.success(request, 'You have been signed out.')
    return redirect('home')


@login_required
def password_change(request):
    form = PasswordChangeForm(request.user, request.POST or None)
    for f in form.fields.values(): f.widget.attrs['class'] = 'field-control'
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        update_session_auth_hash(request, user)
        messages.success(request, 'Your password has been updated.')
        return redirect('dashboard')
    return render(request, 'shared/form.html', {'form':form, 'page_title':'Change password',
                    'page_desc':'Use a strong password unique to your account.', 'submit_label':'Update password'})


@login_required
def dashboard(request):
    u = request.user
    today = timezone.localdate()
    if u.role == 'patient':
        qs = Appointment.objects.filter(patient=u).select_related('slot__doctor__user', 'slot__doctor__department')
        upcoming = qs.filter(slot__date__gte=today, status__in=['pending','confirmed']).order_by('slot__date','slot__start_time')[:6]
        counts = {'upcoming':qs.filter(slot__date__gte=today,status__in=['pending','confirmed']).count(),
                  'completed':qs.filter(status='completed').count(), 'complaints':Complaint.objects.filter(patient=u).exclude(status='resolved').count()}
        return render(request, 'patient/dashboard.html', {'upcoming':upcoming,'counts':counts,
            'history':qs.filter(status='completed')[:4]})
    docs = managed_doctors(u)
    apps = Appointment.objects.filter(slot__doctor__in=docs).select_related('slot__doctor__user','patient')
    active_today = apps.filter(slot__date=today).exclude(status__in=['cancelled','expired'])
    paid = apps.filter(payment_status='paid', slot__date__gte=today-timedelta(days=30)).aggregate(v=Sum('fee'))['v'] or Decimal('0')
    counts = {'today':active_today.count(), 'upcoming':apps.filter(slot__date__gte=today,status__in=['pending','confirmed']).count(),
              'pending':apps.filter(status='pending').count(), 'unpaid':apps.filter(payment_status='unpaid',status__in=['pending','confirmed']).count(),
              'refunds':RefundRequest.objects.filter(appointment__slot__doctor__in=docs,status='pending').count(),
              'collections':paid}
    available = AppointmentSlot.objects.filter(doctor__in=docs, date=today, is_open=True)
    counts['spaces'] = sum(s.remaining for s in available)
    if u.role == 'admin':
        counts.update({'doctors':DoctorProfile.objects.filter(user__is_active=True).count(),
                       'patients':User.objects.filter(role='patient',is_active=True).count(),
                       'receptionists':User.objects.filter(role='receptionist',is_active=True).count()})
    return render(request, 'staff/dashboard.html', {'counts':counts,
        'today_appointments':active_today.order_by('slot__start_time')[:12],
        'recent_appointments':apps.order_by('-created_at')[:6], 'today':today})


@login_required
def profile(request):
    form = ProfileForm(request.POST or None, request.FILES or None, instance=request.user)
    if request.method == 'POST' and form.is_valid():
        form.save()
        log(request.user, 'profile.updated', request.user.pk)
        messages.success(request, 'Profile updated successfully.')
        return redirect('profile')
    return render(request,'shared/form.html', {'form':form, 'page_title':'My profile',
                  'page_desc':'Keep your contact information accurate and up to date.', 'submit_label':'Save changes'})


def doctor_directory(request):
    department = request.GET.get('department', '')
    q = request.GET.get('q', '').strip()
    sort = request.GET.get('sort', 'name')
    doctors = DoctorProfile.objects.filter(is_available=True, user__is_active=True).select_related('user', 'department')
    if department.isdigit():
        doctors = doctors.filter(department_id=int(department))
    if q:
        doctors = doctors.filter(
            Q(user__first_name__icontains=q) |
            Q(user__last_name__icontains=q) |
            Q(department__name__icontains=q) |
            Q(qualifications__icontains=q) |
            Q(designation__icontains=q) |
            Q(institute__icontains=q) |
            Q(room_number__icontains=q)
        )
    if sort == 'fee_asc':
        doctors = doctors.order_by('initial_fee')
    elif sort == 'fee_desc':
        doctors = doctors.order_by('-initial_fee')
    elif sort == 'experience':
        doctors = doctors.order_by('-experience_years')
    elif sort == 'department':
        doctors = doctors.order_by('department__name', 'user__first_name')
    else:
        doctors = doctors.order_by('user__first_name', 'user__last_name')

    return render(request, 'patient/doctors.html', {
        'doctors': doctors,
        'departments': Department.objects.filter(is_active=True),
        'selected_department': department,
        'query': q,
        'selected_sort': sort,
    })


def public_departments(request):
    deps = Department.objects.filter(is_active=True).annotate(
        total_doctors=Count('doctors', filter=Q(doctors__user__is_active=True, doctors__is_available=True))
    ).order_by('name')
    return render(request, 'public/departments.html', {'departments': deps})


def doctor_detail(request, pk):
    doc = get_object_or_404(DoctorProfile.objects.select_related('user', 'department', 'chamber'), pk=pk, user__is_active=True)
    raw_date = request.GET.get('date')
    try:
        chosen = datetime.strptime(raw_date, '%Y-%m-%d').date() if raw_date else None
    except ValueError:
        chosen = None
    today = timezone.localdate()
    next_dates = [today + timedelta(days=i) for i in range(1, 15)]
    if not chosen:
        chosen = today + timedelta(days=1)
    slots = list(AppointmentSlot.objects.filter(doctor=doc, date=chosen, is_open=True).order_by('start_time'))
    now = timezone.now()
    is_staff = request.user.is_authenticated and request.user.role in ('doctor', 'receptionist', 'admin')
    for s in slots:
        if is_staff:
            s.booking_open = s.remaining > 0 and local_start(s) > now
        else:
            s.booking_open = s.remaining > 0 and local_start(s) >= now + timedelta(hours=doc.booking_notice_hours) and local_start(s) <= now + timedelta(days=doc.booking_advance_days)
    weekly_schedules = doc.weekly.filter(active=True).order_by('weekday', 'start_time')
    practice_weekdays = list(weekly_schedules.values_list('weekday', flat=True))
    return render(request, 'patient/doctor_detail.html', {
        'doctor': doc,
        'slots': slots,
        'chosen_date': chosen,
        'next_dates': next_dates,
        'weekly_schedules': weekly_schedules,
        'practice_weekdays': practice_weekdays,
        'is_staff': is_staff,
        'gateway_enabled': gateway.enabled() and settings.PUBLIC_BASE_URL.startswith('https://')
    })


@role_required('patient', 'doctor', 'receptionist', 'admin')
def patient_book(request, slot_id):
    slot = get_object_or_404(
        AppointmentSlot.objects.select_for_update(nowait=False).select_related(
            'doctor__user', 'doctor__department', 'doctor__chamber'
        ),
        pk=slot_id
    )
    is_staff_booking = request.user.role in ('doctor', 'receptionist', 'admin')
    try:
        valid_slot(slot, is_staff_booking=is_staff_booking)
    except ValidationError as exc:
        messages.error(request, '; '.join(exc.messages))
        return redirect('doctor_detail', pk=slot.doctor_id)

    if is_staff_booking:
        form = StaffAssistedBookingForm(request.POST or None)
    else:
        form = PatientBookingForm(request.POST or None)
        if slot.doctor.payment_policy == 'within':
            form.fields['payment_method'].choices = [('online', 'Pay online (before deadline)')]
        elif not gateway.enabled() or not settings.PUBLIC_BASE_URL.startswith('https://'):
            form.fields['payment_method'].choices = [('cash', 'Pay at hospital')]

    if request.method == 'POST' and form.is_valid():
        if is_staff_booking:
            v = form.cleaned_data
            try:
                with transaction.atomic():
                    appt = create_appointment(
                        actor=request.user,
                        slot_id=slot.pk,
                        patient=v.get('patient'),
                        name=v['name'].strip(),
                        phone=v['phone'].strip(),
                        dob=v.get('dob'),
                        visit_type=v['visit_type'],
                        source=v['source'],
                        payment_method='cash',
                        notes=v.get('notes', '')
                    )
                    if v['payment_choice'] == 'cash':
                        record_cash_payment(appt, request.user, note=f'Collected at reception desk by {request.user.display_name}')
                messages.success(request, f'Appointment {appt.reference} booked successfully for {v["name"]}.')
                return redirect('appointment_detail', pk=appt.pk)
            except (ValidationError, PermissionDenied) as exc:
                messages.error(request, '; '.join(exc.messages) if hasattr(exc, 'messages') else str(exc))
        else:
            method = form.cleaned_data['payment_method']
            if method == 'online' and (not gateway.enabled() or not settings.PUBLIC_BASE_URL.startswith('https://')):
                messages.error(request, 'Online checkout is not configured. Contact reception for booking assistance.')
            else:
                try:
                    appt = create_appointment(
                        actor=request.user,
                        slot_id=slot.pk,
                        patient=request.user,
                        name=request.user.display_name,
                        phone=request.user.phone,
                        dob=request.user.dob,
                        visit_type=form.cleaned_data['visit_type'],
                        payment_method=method,
                        notes=form.cleaned_data['notes']
                    )
                    messages.success(request, f'Appointment {appt.reference} has been reserved.')
                    return redirect('appointment_detail', pk=appt.pk)
                except (ValidationError, PermissionDenied) as exc:
                    messages.error(request, '; '.join(exc.messages) if hasattr(exc, 'messages') else str(exc))

    return render(request, 'patient/book.html', {
        'slot': slot,
        'doctor': slot.doctor,
        'form': form,
        'is_staff_booking': is_staff_booking,
    })


def visible_appointments(user):
    qs = Appointment.objects.select_related('patient', 'slot__doctor__user', 'slot__doctor__department', 'slot__doctor__chamber', 'created_by')
    if user.role == 'patient':
        return qs.filter(patient=user)
    if user.role == 'admin':
        return qs
    if user.role == 'receptionist':
        return qs.filter(Q(slot__doctor__in=managed_doctors(user)) | Q(created_by=user)).distinct()
    return qs.filter(slot__doctor__in=managed_doctors(user))


@login_required
def appointments(request):
    qs = visible_appointments(request.user)
    status = request.GET.get('status', '')
    payment = request.GET.get('payment', '')
    q = request.GET.get('q','').strip()
    date_filter = request.GET.get('date','')
    doc = request.GET.get('doctor','')
    if status in dict(Appointment.Status.choices): qs = qs.filter(status=status)
    if payment in ('paid','unpaid','refund_pending','refunded','partially_refunded'): qs = qs.filter(payment_status=payment)
    if date_filter:
        try: qs = qs.filter(slot__date=datetime.strptime(date_filter,'%Y-%m-%d').date())
        except ValueError: pass
    if doc.isdigit(): qs = qs.filter(slot__doctor_id=int(doc))
    if q:
        qs = qs.filter(Q(reference__icontains=q)|Q(guest_name__icontains=q)|Q(guest_phone__icontains=q)|
                       Q(slot__doctor__user__first_name__icontains=q)|Q(slot__doctor__user__last_name__icontains=q))
    sorting = {'newest':'-created_at','oldest':'created_at','date_asc':'slot__date',
               'date_desc':'-slot__date','patient':'guest_name','fee_asc':'fee',
               'fee_desc':'-fee','status':'status'}
    sort=request.GET.get('sort','newest')
    qs=qs.order_by(sorting.get(sort,'-created_at'),'pk')
    page = Paginator(qs, 25).get_page(request.GET.get('page'))
    query = request.GET.copy()
    query.pop('page', None)
    return render(request, 'shared/appointments.html', {'appointments':page, 'page_obj':page,
                  'page_query':query.urlencode(),
                  'doctor_options':managed_doctors(request.user) if request.user.role!='patient' else None,
                  'filters':request.GET})


@login_required
def appointment_detail(request,pk):
    appt = get_object_or_404(visible_appointments(request.user), pk=pk)
    linked_candidate=User.objects.filter(role='patient',phone=appt.guest_phone).first() if request.user.role in ('admin','receptionist') and not appt.patient_id else None
    return render(request, 'shared/appointment_detail.html', {'appointment':appt,
                  'linked_candidate':linked_candidate,
                  'transactions':appt.payments.all(), 'refund_request':RefundRequest.objects.filter(appointment=appt).first()})


@require_POST
@login_required
def appointment_cancel(request,pk):
    appt = get_object_or_404(visible_appointments(request.user), pk=pk)
    by_doctor = request.POST.get('actor_type') == 'doctor' and request.user.role in ('doctor','admin')
    return try_action(request, lambda: cancel_appointment(appt, request.user, by_doctor=by_doctor,
                      reason=request.POST.get('reason','')[:500]), reverse('appointment_detail',args=[pk]),
                      'Appointment cancelled. Any eligible refund has been queued for review.')


@require_POST
@role_required('doctor','receptionist','admin')
def appointment_collect(request,pk):
    appt = get_object_or_404(visible_appointments(request.user), pk=pk)
    return try_action(request, lambda: record_cash_payment(appt,request.user),
                      reverse('appointment_detail',args=[pk]), 'Cash payment recorded and appointment confirmed.')


@require_POST
@role_required('doctor','receptionist','admin')
def appointment_status(request,pk):
    appt = get_object_or_404(visible_appointments(request.user), pk=pk)
    return try_action(request, lambda: change_visit_status(appt,request.user,request.POST.get('status','')),
                      reverse('appointment_detail',args=[pk]), 'Appointment status updated.')


@require_POST
@role_required('doctor','receptionist','admin')
def appointment_bulk(request):
    ids = [int(x) for x in request.POST.getlist('selected') if x.isdigit()][:200]
    qs = visible_appointments(request.user).filter(pk__in=ids)
    action = request.POST.get('action','')
    count = 0
    errors = 0
    for appt in qs:
        try:
            if action == 'cash': record_cash_payment(appt,request.user)
            elif action in ('completed','no_show'): change_visit_status(appt,request.user,action)
            elif action == 'doctor_cancel': cancel_appointment(appt,request.user,by_doctor=True,reason='Doctor cancelled clinic')
            else: raise ValidationError('Unsupported bulk action.')
            count += 1
        except (ValidationError,PermissionDenied): errors += 1
    if count: messages.success(request,f'{count} appointments updated.')
    if errors: messages.warning(request,f'{errors} records could not be changed because of their current status or permissions.')
    return redirect('appointments')


@role_required('receptionist','doctor','admin')
def staff_book(request):
    docs = managed_doctors(request.user)
    form = ReceptionBookingForm(request.POST or None, doctors=docs)
    selected_slot=None
    if request.method=='POST' and str(request.POST.get('slot','')).isdigit():
        selected_slot=AppointmentSlot.objects.filter(pk=int(request.POST['slot']),doctor__in=docs).first()
    if request.method == 'POST' and form.is_valid():
        v = form.cleaned_data
        try:
            # Cash collection and booking must succeed or roll back together.
            with transaction.atomic():
                appt = create_appointment(actor=request.user, slot_id=v['slot'].pk,
                    patient=v['patient'],name=v['name'],phone=v['phone'],dob=v['dob'],
                    visit_type=v['visit_type'],source=v['source'],payment_method='cash',notes=v['notes'])
                if v['payment_choice'] == 'cash':
                    record_cash_payment(appt,request.user)
            messages.success(request,'Appointment recorded successfully.')
            return redirect('appointment_detail', pk=appt.pk)
        except (ValidationError, PermissionDenied) as exc:
            messages.error(request, '; '.join(exc.messages) if hasattr(exc,'messages') else str(exc))
    return render(request,'staff/book.html',{'form':form,'doctors':docs,'selected_slot':selected_slot})


@role_required('receptionist','doctor','admin')
def patient_lookup(request):
    phone=request.GET.get('phone','').strip()
    if not (phone.lstrip('+').isdigit() and 10 <= len(phone.lstrip('+')) <= 15):
        return JsonResponse({'patient':None})
    account=User.objects.filter(role='patient',phone=phone,is_active=True).first()
    if not account:
        return JsonResponse({'patient':None})
    return JsonResponse({'patient':{'id':account.pk,'name':account.display_name}})


@role_required('receptionist','doctor','admin')
def slots_api(request):
    doctor_id = request.GET.get('doctor','')
    date_value = request.GET.get('date','')
    if not doctor_id.isdigit(): return JsonResponse({'slots':[]})
    doctor = get_object_or_404(managed_doctors(request.user), pk=int(doctor_id))
    try:
        day = datetime.strptime(date_value, '%Y-%m-%d').date()
    except (TypeError,ValueError): return JsonResponse({'slots':[]})
    slots = AppointmentSlot.objects.filter(doctor=doctor, date=day, is_open=True).order_by('start_time')
    return JsonResponse({'slots':[{'id':s.pk,'label':f'{s.start_time:%I:%M %p} – {s.end_time:%I:%M %p}',
                                    'remaining':s.remaining,'capacity':s.capacity} for s in slots if s.remaining > 0 and local_start(s) > timezone.now()]})


@require_POST
@role_required('receptionist','admin')
def appointment_link(request,pk):
    appt = get_object_or_404(visible_appointments(request.user),pk=pk)
    user_id = request.POST.get('patient_id','')
    if not user_id.isdigit() or request.POST.get('verified') != 'yes':
        messages.error(request,'Confirm identity and select a registered patient account.')
        return redirect('appointment_detail',pk=pk)
    user = get_object_or_404(User,pk=int(user_id),role='patient')
    if appt.guest_phone != user.phone:
        messages.error(request,'Account phone does not match the appointment phone.')
        return redirect('appointment_detail',pk=pk)
    if appt.patient_id and appt.patient_id != user.pk:
        messages.error(request,'This appointment is already associated with another account.')
        return redirect('appointment_detail',pk=pk)
    appt.patient = user
    appt.save(update_fields=['patient','updated_at'])
    log(request.user,'appointment.patient_linked',appt.reference,user.pk)
    messages.success(request,'Patient account linked after identity confirmation.')
    return redirect('appointment_detail',pk=pk)


@role_required('doctor','admin','receptionist')
def schedule(request):
    docs = managed_doctors(request.user)
    doc_id = request.GET.get('doctor')
    if request.user.role == 'doctor':
        doc = docs.first()
    else:
        doc = docs.filter(pk=doc_id).first() if doc_id else docs.first()
    patterns = WeeklyAvailability.objects.filter(doctor=doc) if doc else []
    day = request.GET.get('date') or timezone.localdate().isoformat()
    slots = AppointmentSlot.objects.filter(doctor=doc, date=day).order_by('start_time') if doc else []
    return render(request,'staff/schedule.html',{'doctor':doc,'doctors':docs,'patterns':patterns,
                  'slots':slots,'date_value':day,'can_edit':request.user.role in ('doctor','admin')})


@role_required('doctor','admin')
def weekly_edit(request, doctor_pk, pk=None):
    doc = get_object_or_404(managed_doctors(request.user),pk=doctor_pk)
    pattern = get_object_or_404(WeeklyAvailability,pk=pk,doctor=doc) if pk else None
    form = WeeklyForm(request.POST or None, instance=pattern)
    if request.method == 'POST' and form.is_valid():
        with transaction.atomic():
            obj = form.save(commit=False)
            obj.doctor = doc
            obj.save()
            # Preserve any booked slots when a recurring plan changes.
            if pattern:
                for s in list(AppointmentSlot.objects.filter(template=obj,date__gte=timezone.localdate())):
                    if s.is_open and not s.appointments.exclude(status__in=['cancelled','expired']).exists():
                        s.delete()
            published = materialize_weekly(doc)
            log(request.user,'schedule.updated',doc.pk,f'{obj.pk}; published={published}')
        messages.success(request,f'Weekly schedule saved. {published} upcoming time slots published.')
        return redirect('schedule')
    return render(request,'shared/form.html',{'form':form,'page_title':'Weekly availability',
                  'page_desc':f'{doc}. Reuse this schedule every week; booked appointments are preserved.',
                  'submit_label':'Save and publish'})


@require_POST
@role_required('doctor','admin')
def weekly_delete(request,pk):
    obj = get_object_or_404(WeeklyAvailability,pk=pk)
    if not doctor_allowed(request.user,obj.doctor): raise PermissionDenied()
    for s in list(obj.slots.filter(date__gte=timezone.localdate())):
        if s.appointments.exclude(status__in=['cancelled','expired']).exists():
            s.is_open = False; s.save(update_fields=['is_open'])
        else: s.delete()
    obj.delete()
    log(request.user,'schedule.weekly_removed',pk)
    messages.success(request,'Recurring schedule removed. Existing bookings were retained and their slots closed.')
    return redirect('schedule')


@role_required('doctor','admin')
def slot_edit(request,pk=None):
    slot = get_object_or_404(AppointmentSlot,pk=pk) if pk else None
    if slot and not doctor_allowed(request.user,slot.doctor): raise PermissionDenied()
    original = (slot.doctor_id, slot.date, slot.start_time, slot.reserved) if slot else None
    form = SlotForm(request.POST or None, instance=slot, doctors=managed_doctors(request.user))
    if request.method == 'POST' and form.is_valid():
        obj = form.save(commit=False)
        if slot and obj.capacity < original[3]:
            form.add_error('capacity','Capacity cannot be smaller than existing appointments.')
        elif slot and (obj.doctor_id, obj.date, obj.start_time) != original[:3] and original[3]:
            form.add_error('date','A booked slot cannot be moved. Cancel affected appointments first.')
        else:
            try:
                obj.save()
                log(request.user,'slot.saved',obj.pk)
                messages.success(request,'Appointment time slot saved.')
                return redirect('schedule')
            except Exception as exc:
                from django.db import IntegrityError
                if isinstance(exc,IntegrityError): form.add_error(None,'This doctor already has a slot at that time.')
                else: raise
    return render(request,'shared/form.html',{'form':form,'page_title':'Appointment time slot',
                  'page_desc':'Create or adjust a single consultation time without changing the weekly plan.',
                  'submit_label':'Save time slot'})


@require_POST
@role_required('doctor','admin')
def slot_toggle(request,pk):
    slot = get_object_or_404(AppointmentSlot,pk=pk)
    if not doctor_allowed(request.user,slot.doctor): raise PermissionDenied()
    slot.is_open = not slot.is_open
    slot.save(update_fields=['is_open'])
    log(request.user,'slot.open_changed',pk,slot.is_open)
    messages.success(request,'Slot availability updated. Existing bookings remain unchanged.')
    return redirect('schedule')


@require_POST
@role_required('doctor','admin')
def slot_copy(request):
    docs = managed_doctors(request.user)
    doc = get_object_or_404(docs,pk=request.POST.get('doctor'))
    try:
        from_date = datetime.strptime(request.POST.get('from_date',''),'%Y-%m-%d').date()
        to_date = datetime.strptime(request.POST.get('to_date',''),'%Y-%m-%d').date()
        if to_date < timezone.localdate() or to_date > timezone.localdate()+timedelta(days=180):
            raise ValueError
    except ValueError:
        messages.error(request,'Select a valid source date and a future destination date.')
        return redirect('schedule')
    made = 0
    for s in AppointmentSlot.objects.filter(doctor=doc,date=from_date):
        _, created = AppointmentSlot.objects.get_or_create(doctor=doc,date=to_date,start_time=s.start_time,
              defaults={'end_time':s.end_time,'capacity':s.capacity,'is_open':s.is_open})
        made += int(created)
    log(request.user,'schedule.copied',doc.pk,f'{from_date} → {to_date}; {made} new slots')
    messages.success(request,f'{made} new time slots copied. Existing appointments were not changed.')
    return redirect(f"{reverse('schedule')}?doctor={doc.pk}&date={to_date.isoformat()}")


@role_required('doctor','admin')
def doctor_rules(request,pk):
    doc = get_object_or_404(managed_doctors(request.user),pk=pk)
    form = DoctorSettingsForm(request.POST or None,instance=doc,is_admin=request.user.role=='admin')
    if request.method=='POST' and form.is_valid():
        form.save()
        log(request.user,'doctor.rules_updated',doc.pk)
        messages.success(request,'Doctor profile, fees and appointment rules saved.')
        return redirect('doctor_rules',pk=pk)
    return render(request,'shared/form.html',{'form':form,'page_title':'Consultation fees & rules',
            'page_desc':f'{doc} · Fees in BDT. These changes apply to new bookings; confirmed booking prices stay unchanged.',
            'submit_label':'Save doctor settings'})


@role_required('admin')
def policy(request):
    obj = HospitalPolicy.current()
    form = PolicyForm(request.POST or None,instance=obj)
    if request.method == 'POST' and form.is_valid():
        form.save()
        log(request.user,'hospital.policy_defaults',obj.pk)
        messages.success(request,'Hospital defaults updated. Existing doctor overrides are unchanged.')
        return redirect('policy')
    return render(request,'shared/form.html',{'form':form,'page_title':'Hospital policy defaults',
        'page_desc':'Default rules for newly added doctors. Existing doctor settings are intentionally preserved.',
        'submit_label':'Save policy'})


@role_required('admin')
def staff_list(request):
    users = User.objects.exclude(role='patient').order_by('role','first_name')
    q = request.GET.get('q','').strip()
    role = request.GET.get('role','')
    if q: users=users.filter(Q(username__icontains=q)|Q(email__icontains=q)|Q(phone__icontains=q)|
                              Q(first_name__icontains=q)|Q(last_name__icontains=q))
    if role in ('admin','doctor','receptionist'): users=users.filter(role=role)
    ordering={'name':('first_name','last_name','pk'), 'username':('username','pk'),
              'role':('role','first_name','pk'), 'recent':('-date_joined','pk')}
    sort=request.GET.get('sort','name')
    users=users.order_by(*ordering.get(sort,ordering['name']))
    page=Paginator(users,30).get_page(request.GET.get('page'))
    query=request.GET.copy()
    query.pop('page',None)
    return render(request,'staff/staff_list.html',{'staff':page,'page_obj':page,
                  'page_query':query.urlencode(),'query':q,'role_filter':role,'sort':sort})


@role_required('admin')
def staff_edit(request,pk=None):
    member = get_object_or_404(User,pk=pk) if pk else None
    if member and member.role == 'patient': raise Http404()
    form = StaffForm(request.POST or None,instance=member)
    if request.method=='POST' and form.is_valid():
        if member and member.pk == request.user.pk and (form.cleaned_data['role'] != 'admin' or not form.cleaned_data['is_active']):
            messages.error(request,'You cannot deactivate your own administrator account or remove its role.')
        else:
            with transaction.atomic():
                user = form.save()
                if user.role == 'doctor' and not DoctorProfile.objects.filter(user=user).exists():
                    pol = HospitalPolicy.current()
                    chamber = form.cleaned_data.get('chamber')
                    consultation_days = form.cleaned_data.get('consultation_days') or ['0', '2', '4']
                    start_t = form.cleaned_data.get('consultation_start_time') or datetime.strptime('18:00', '%H:%M').time()
                    end_t = form.cleaned_data.get('consultation_end_time') or datetime.strptime('20:00', '%H:%M').time()
                    days_str = ','.join(str(d) for d in consultation_days)

                    doctor_profile = DoctorProfile.objects.create(
                        user=user,
                        department=form.cleaned_data['department'],
                        chamber=chamber,
                        chamber_days=days_str,
                        room_number=chamber.room_number if chamber else 'Chamber 302',
                        chamber_address=chamber.address if chamber else 'Plot 1, Section 10, Mirpur, Dhaka-1216',
                        contact_number=chamber.contact_number if chamber else '+88096100016211, +16211',
                        booking_notice_hours=pol.default_notice_hours,
                        booking_advance_days=pol.default_advance_days,
                        payment_deadline_hours=pol.default_payment_hours,
                        cancel_fee_mode=pol.default_cancel_mode,
                        cancel_fee_value=pol.default_cancel_value,
                        hospital_share_mode=pol.default_hospital_mode,
                        hospital_share_value=pol.default_hospital_value
                    )
                    if form.cleaned_data.get('assigned_receptionist'):
                        doctor_profile.receptionists.add(form.cleaned_data['assigned_receptionist'])

                    # Create weekly availability for the selected days
                    for day_int in [int(d) for d in consultation_days]:
                        WeeklyAvailability.objects.create(
                            doctor=doctor_profile,
                            weekday=day_int,
                            start_time=start_t,
                            end_time=end_t,
                            duration_minutes=30,
                            capacity=2,
                            active=True
                        )
                    materialize_weekly(doctor_profile, days=60)
                log(request.user,'staff.saved',user.pk,user.role)
            messages.success(request,'Staff account saved successfully.')
            return redirect('staff_list')
    chambers_info = Chamber.objects.filter(is_active=True).prefetch_related('doctors__user')
    return render(request,'staff/staff_edit.html',{
        'form':form,
        'member':member,
        'departments':Department.objects.filter(is_active=True),
        'chambers':chambers_info
    })


@role_required('admin')
def chamber_list(request):
    q = request.GET.get('q', '').strip()
    building_filter = request.GET.get('building', '').strip()
    floor_filter = request.GET.get('floor', '').strip()
    occupancy_filter = request.GET.get('occupancy', 'all')
    sort = request.GET.get('sort', 'building')

    chambers = Chamber.objects.annotate(
        total_doctors=Count('doctors', filter=Q(doctors__user__is_active=True))
    ).prefetch_related('doctors__user', 'doctors__weekly', 'department')

    if q:
        chambers = chambers.filter(
            Q(name__icontains=q) |
            Q(room_number__icontains=q) |
            Q(building__icontains=q) |
            Q(floor__icontains=q) |
            Q(description__icontains=q) |
            Q(address__icontains=q) |
            Q(doctors__user__first_name__icontains=q) |
            Q(doctors__user__last_name__icontains=q)
        ).distinct()

    if building_filter:
        chambers = chambers.filter(building__iexact=building_filter)

    if floor_filter:
        chambers = chambers.filter(floor__iexact=floor_filter)

    if occupancy_filter == 'empty':
        chambers = chambers.filter(total_doctors=0)
    elif occupancy_filter == 'occupied':
        chambers = chambers.filter(total_doctors__gt=0)

    if sort == 'empty_first':
        chambers = chambers.order_by('total_doctors', 'building', 'room_number')
    elif sort == 'doctors_desc':
        chambers = chambers.order_by('-total_doctors', 'building', 'room_number')
    elif sort == 'room':
        chambers = chambers.order_by('room_number', 'building')
    elif sort == 'floor':
        chambers = chambers.order_by('floor', 'room_number')
    else:
        chambers = chambers.order_by('building', 'room_number')

    all_chambers = Chamber.objects.all()
    buildings = list(all_chambers.exclude(building='').values_list('building', flat=True).distinct().order_by('building'))
    floors = list(all_chambers.exclude(floor='').values_list('floor', flat=True).distinct().order_by('floor'))

    total_count = all_chambers.count()
    empty_count = all_chambers.annotate(total=Count('doctors', filter=Q(doctors__user__is_active=True))).filter(total=0).count()
    occupied_count = total_count - empty_count

    return render(request, 'staff/chambers.html', {
        'chambers': chambers,
        'buildings': buildings,
        'floors': floors,
        'selected_building': building_filter,
        'selected_floor': floor_filter,
        'selected_occupancy': occupancy_filter,
        'selected_sort': sort,
        'query': q,
        'total_count': total_count,
        'empty_count': empty_count,
        'occupied_count': occupied_count,
    })


@role_required('admin')
def chamber_edit(request, pk=None):
    chamber = get_object_or_404(Chamber, pk=pk) if pk else None
    form = ChamberForm(request.POST or None, instance=chamber)
    all_doctors = DoctorProfile.objects.filter(user__is_active=True).select_related('user', 'department').prefetch_related('weekly')

    if request.method == 'POST' and form.is_valid():
        with transaction.atomic():
            chamber = form.save()
            assigned_docs = list(form.cleaned_data.get('doctors') or [])

            # Process day allocation for assigned doctors
            from datetime import time
            for doc in assigned_docs:
                days = request.POST.getlist(f'doctor_days_{doc.pk}')
                if days:
                    doc.chamber_days = ','.join(str(d) for d in days)
                    # Sync weekly availability
                    doc.weekly.all().delete()
                    for d_str in days:
                        WeeklyAvailability.objects.create(
                            doctor=doc,
                            weekday=int(d_str),
                            start_time=time(18, 0),
                            end_time=time(20, 0),
                            duration_minutes=30,
                            capacity=2,
                            active=True
                        )
                    materialize_weekly(doc, days=60)
                doc.save()

            log(request.user, 'chamber.saved', chamber.pk, f'{chamber.building} {chamber.room_number}')
            messages.success(request, f'Chamber "{chamber.display_code}" saved successfully with doctor schedules.')
            return redirect('chamber_list')

    return render(request, 'staff/chamber_form.html', {
        'form': form,
        'chamber': chamber,
        'all_doctors': all_doctors,
        'page_title': f'Edit {chamber.display_code}' if chamber else 'Add new chamber & consultation room',
    })


@require_POST
@role_required('admin')
def chamber_delete(request, pk):
    chamber = get_object_or_404(Chamber, pk=pk)
    name = chamber.name
    room = chamber.room_number
    DoctorProfile.objects.filter(chamber=chamber).update(chamber=None)
    chamber.delete()
    log(request.user, 'chamber.deleted', pk, f'{name} {room}')
    messages.success(request, f'Chamber "{name} ({room})" deleted successfully.')
    return redirect('chamber_list')


@role_required('admin')
def departments(request):
    if request.method=='POST':
        name=request.POST.get('name','').strip()
        from django.utils.text import slugify
        if not name: messages.error(request,'Department name is required.')
        elif Department.objects.filter(name__iexact=name).exists(): messages.error(request,'Department already exists.')
        else:
            dep=Department.objects.create(name=name,slug=slugify(name),description=request.POST.get('description','')[:255])
            log(request.user,'department.created',dep.pk)
            messages.success(request,'Department created.')
        return redirect('departments')
    return render(request,'staff/departments.html',{'departments':Department.objects.annotate(total=Count('doctors')).order_by('name')})


@role_required('patient')
def complaints(request):
    return render(request,'patient/complaints.html',{'complaints':Complaint.objects.filter(patient=request.user)})


@role_required('patient')
def complaint_new(request):
    form=ComplaintForm(request.POST or None,patient=request.user)
    if request.method=='POST' and form.is_valid():
        obj=form.save(commit=False);obj.patient=request.user;obj.save()
        log(request.user,'complaint.submitted',obj.pk)
        messages.success(request,'Your complaint has been submitted. Updates will appear in your portal.')
        return redirect('complaints')
    return render(request,'shared/form.html',{'form':form,'page_title':'Submit a concern',
         'page_desc':'Tell us what happened so the hospital team can review it.', 'submit_label':'Submit complaint'})


@role_required('admin','receptionist','doctor')
def complaint_queue(request):
    qs=Complaint.objects.select_related('patient','appointment__slot__doctor__user')
    if request.user.role=='doctor':
        qs=qs.filter(appointment__slot__doctor__in=managed_doctors(request.user))
    elif request.user.role=='receptionist':
        qs=qs.filter(appointment__slot__doctor__in=managed_doctors(request.user))
    status=request.GET.get('status','')
    if status in ('submitted','reviewing','in_progress','resolved'): qs=qs.filter(status=status)
    return render(request,'staff/complaints.html',{'complaints':qs[:250]})


@require_POST
@role_required('admin','receptionist')
def complaint_update(request,pk):
    qs=Complaint.objects.all()
    if request.user.role=='receptionist':
        qs=qs.filter(appointment__slot__doctor__in=managed_doctors(request.user))
    obj=get_object_or_404(qs,pk=pk)
    if request.POST.get('status') not in ('submitted','reviewing','in_progress','resolved'):
        messages.error(request,'Invalid complaint status.')
    else:
        obj.status=request.POST['status'];obj.response=request.POST.get('response','')[:3000]
        obj.updated_by=request.user;obj.save()
        log(request.user,'complaint.updated',obj.pk,obj.status)
        messages.success(request,'Complaint progress updated.')
    return redirect('complaint_queue')


@role_required('admin','receptionist')
def refunds(request):
    qs=RefundRequest.objects.select_related('appointment__slot__doctor__user','appointment__patient')
    qs=qs.filter(appointment__slot__doctor__in=managed_doctors(request.user))
    status=request.GET.get('status','')
    if status in ('pending','approved','processing','completed','rejected'): qs=qs.filter(status=status)
    keyword=request.GET.get('q','').strip()
    if keyword:
        qs=qs.filter(Q(appointment__reference__icontains=keyword)|
                     Q(appointment__guest_name__icontains=keyword)|
                     Q(appointment__guest_phone__icontains=keyword)|
                     Q(appointment__slot__doctor__user__first_name__icontains=keyword)|
                     Q(appointment__slot__doctor__user__last_name__icontains=keyword))
    order=request.GET.get('sort','newest')
    choices={'newest':'-created_at','oldest':'created_at','amount_high':'-amount','amount_low':'amount'}
    qs=qs.order_by(choices.get(order,'-created_at'),'pk')
    page=Paginator(qs,25).get_page(request.GET.get('page'))
    query=request.GET.copy()
    query.pop('page',None)
    return render(request,'staff/refunds.html',{'refunds':page,'page_obj':page,
                  'page_query':query.urlencode(),'status':status,'keyword':keyword,'sort':order})


@require_POST
@role_required('admin','receptionist')
def refund_bulk(request):
    pks=[int(pk) for pk in request.POST.getlist('selected') if pk.isdigit()][:200]
    allowed=RefundRequest.objects.filter(pk__in=pks,appointment__slot__doctor__in=managed_doctors(request.user)).values_list('pk',flat=True)
    count=0;fail=0
    for pk in allowed:
        try: approve_refund(pk,request.user);count+=1
        except (ValidationError,PermissionDenied): fail+=1
    if count: messages.success(request,f'{count} refunds approved. Complete cash payouts or submit online refunds separately.')
    if fail: messages.warning(request,f'{fail} requests could not be approved.')
    return redirect('refunds')


@require_POST
@role_required('admin','receptionist')
def refund_approve(request,pk):
    return try_action(request,lambda:approve_refund(pk,request.user),reverse('refunds'),
                      'Refund approved. Complete the corresponding payout next.')


@require_POST
@role_required('admin','receptionist')
def refund_cash(request,pk):
    return try_action(request,lambda:finalize_cash_refund(pk,request.user),reverse('refunds'),
                      'Cash refund recorded as paid to the patient.')


@require_POST
@role_required('admin','receptionist')
def refund_online(request,pk):
    from .services import issue_gateway_refund
    try:
        with transaction.atomic():
            refund=get_object_or_404(RefundRequest.objects.select_for_update().select_related('appointment__slot__doctor'),pk=pk)
            if not doctor_allowed(request.user,refund.appointment.slot.doctor): raise PermissionDenied()
            if refund.status!='approved' or refund.mode!='online': raise ValidationError('Only approved online refunds can be submitted.')
            refund.status='processing';refund.save(update_fields=['status'])
        try:
            external_id=issue_gateway_refund(refund)
        except Exception:
            with transaction.atomic():
                RefundRequest.objects.filter(pk=pk,status='processing').update(status='approved')
            raise
        with transaction.atomic():
            refund=RefundRequest.objects.select_for_update().get(pk=pk)
            PaymentTransaction.objects.create(appointment=refund.appointment,kind='refund',method='online',
                                               status='processing',amount=refund.amount,refund_reference=external_id,
                                               handled_by=request.user)
            log(request.user,'refund.gateway_submitted',refund.appointment.reference,external_id)
        messages.success(request,'Gateway accepted the refund request. Final payout is awaiting gateway confirmation.')
    except (ValidationError,PermissionDenied) as exc:
        messages.error(request,'; '.join(exc.messages) if hasattr(exc,'messages') else str(exc))
    except Exception:
        messages.error(request,'Gateway refund could not be initiated. Please verify the transaction before retrying.')
    return redirect('refunds')


@require_POST
@role_required('patient')
def start_payment(request,pk):
    appt=get_object_or_404(visible_appointments(request.user),pk=pk)
    try:
        url=gateway.initialize(appt)
        log(request.user,'payment.gateway_started',appt.reference)
        return redirect(url)
    except ValidationError as exc:
        messages.error(request,'; '.join(exc.messages))
    return redirect('appointment_detail',pk=pk)


@csrf_exempt
def payment_callback(request, result):
    if request.method != 'POST' or result not in ('success','fail','cancel','ipn'):
        return HttpResponse(status=405)
    if result in ('fail','cancel'):
        # Never change a verified payment because a browser sent a failure callback.
        return HttpResponse('Payment was not confirmed. Please return to your appointment page.',status=200)
    try:
        appt=gateway.verify_callback(request.POST.get('val_id',''))
        if result == 'ipn': return HttpResponse('OK')
        messages.success(request,'Payment validated and recorded.' if appt.payment_status=='paid' else 'Payment received; refund review required.')
        return redirect('appointment_detail',pk=appt.pk) if request.user.is_authenticated else redirect('home')
    except (ValidationError,Exception) as exc:
        if result=='ipn': return HttpResponse('Gateway verification unavailable.',status=503)
        messages.error(request,'Payment could not be verified. Please contact reception with your bank receipt.')
        return redirect('dashboard') if request.user.is_authenticated else redirect('home')


@role_required('admin','doctor')
def reports(request):
    docs=managed_doctors(request.user)
    doc=request.GET.get('doctor','')
    if doc.isdigit():docs=docs.filter(pk=int(doc))
    today=timezone.localdate()
    try: start=datetime.strptime(request.GET.get('from',''),'%Y-%m-%d').date()
    except ValueError: start=today-timedelta(days=30)
    try: end=datetime.strptime(request.GET.get('to',''),'%Y-%m-%d').date()
    except ValueError: end=today
    if start>end: start,end=end,start
    apps=Appointment.objects.filter(slot__doctor__in=docs,slot__date__range=(start,end)).select_related('slot__doctor__user','patient')
    verified=PaymentTransaction.objects.filter(appointment__in=apps,kind='charge',status='verified').aggregate(s=Sum('amount'))['s'] or Decimal('0')
    refunded=PaymentTransaction.objects.filter(appointment__in=apps,kind='refund',status='refunded').aggregate(s=Sum('amount'))['s'] or Decimal('0')
    total=apps.count()
    house_net, doctor_net=collected_revenue_shares(apps)
    report={'total':total,'completed':apps.filter(status='completed').count(),
            'confirmed':apps.filter(status='confirmed').count(), 'cancelled':apps.filter(status='cancelled').count(),
            'unpaid':apps.filter(payment_status='unpaid').count(),
            'collected':verified,'refunded':refunded,'net':verified-refunded,
            'hospital_cut':house_net, 'doctor_cut':doctor_net}
    return render(request,'staff/reports.html',{'report':report,'appointments':apps[:50],
          'doctors':managed_doctors(request.user),'from_date':start,'to_date':end,'selected_doctor':doc})


@role_required('admin','doctor')
def export_excel(request):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    docs=managed_doctors(request.user)
    selected=request.GET.get('doctor','')
    if selected.isdigit():docs=docs.filter(pk=int(selected))
    apps=Appointment.objects.filter(slot__doctor__in=docs).select_related('slot__doctor__user','patient')
    try:
        since=datetime.strptime(request.GET.get('from',''),'%Y-%m-%d').date()
        until=datetime.strptime(request.GET.get('to',''),'%Y-%m-%d').date()
        apps=apps.filter(slot__date__range=(since,until))
    except (ValueError,TypeError):
        since=timezone.localdate()-timedelta(days=30);until=timezone.localdate()
        apps=apps.filter(slot__date__range=(since,until))
    def safe_excel(value):
        # Never allow patient/staff-entered data to be interpreted as a spreadsheet formula.
        if isinstance(value,str) and value.lstrip().startswith(('=', '+', '-', '@')):
            return "'" + value
        return value

    book=Workbook();a=book.active;a.title='Appointments'
    a.append(['Reference','Date','Time','Doctor','Department','Patient','Phone','Visit','Status','Payment','Source','Fee BDT','Hospital Share','Doctor Share','Created'])
    for ap in apps.iterator():
        a.append([safe_excel(value) for value in [
                 ap.reference,str(ap.slot.date),str(ap.slot.start_time),ap.doctor.user.display_name,
                 ap.doctor.department.name,ap.patient_name,ap.guest_phone,ap.get_visit_type_display(),
                 ap.get_status_display(),ap.get_payment_status_display(),ap.get_source_display(),
                 float(ap.fee),float(ap.hospital_cut),float(ap.doctor_cut),ap.created_at.strftime('%Y-%m-%d %H:%M')]])
    tx=book.create_sheet('Transactions')
    tx.append(['Booking reference','Type','Method','Status','Amount BDT','Processed','Bank transaction','Refund reference'])
    for t in PaymentTransaction.objects.filter(appointment__in=apps).select_related('appointment').iterator():
        tx.append([safe_excel(value) for value in [
                   t.appointment.reference,t.kind,t.method,t.status,float(t.amount),
                   t.processed_at.strftime('%Y-%m-%d %H:%M') if t.processed_at else '',
                   t.bank_transaction_id,t.refund_reference]])
    ws=book.create_sheet('Summary',0)
    ws.append(['GREEN HOSPITAL · OPERATIONS REPORT'])
    ws.append(['Period',f'{since} – {until}'])
    ws.append(['Appointments',apps.count()])
    ws.append(['Completed',apps.filter(status='completed').count()])
    ws.append(['Cancelled',apps.filter(status='cancelled').count()])
    txbase=PaymentTransaction.objects.filter(appointment__in=apps)
    charged=txbase.filter(kind='charge',status='verified').aggregate(s=Sum('amount'))['s'] or Decimal(0)
    refunds_paid=txbase.filter(kind='refund',status='refunded').aggregate(s=Sum('amount'))['s'] or Decimal(0)
    ws.append(['Verified collections (BDT)',float(charged)])
    ws.append(['Paid refunds (BDT)',float(refunds_paid)])
    ws.append(['Net collected (BDT)',float(charged-refunds_paid)])
    house_net, doctor_net=collected_revenue_shares(apps)
    ws.append(['Hospital net share (BDT)',float(house_net)])
    ws.append(['Doctor net share (BDT)',float(doctor_net)])
    for page in book.worksheets:
        page.freeze_panes='B2'
        page.auto_filter.ref=page.dimensions if page!=ws else 'A1:B1'
        for c in page[1]:
            c.fill=PatternFill('solid',fgColor='145B4B')
            c.font=Font(name='Calibri',bold=True,color='FFFFFF',size=11)
        for col in page.columns:
            letter=get_column_letter(col[0].column)
            page.column_dimensions[letter].width=min(38,max(15,max(len(str(c.value or '')) for c in list(col)[:100])+2))
    content=BytesIO();book.save(content);content.seek(0)
    response=HttpResponse(content.read(),content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition']=f'attachment; filename="green-hospital-report-{timezone.localdate()}.xlsx"'
    log(request.user,'report.exported','appointments',f'{since}–{until}')
    return response


@role_required('admin')
def audit_log(request):
    return render(request,'staff/audit.html',{'events':AuditEvent.objects.select_related('actor')[:250]})


def health(request):
    from django.db import connection
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
        return JsonResponse({'status':'ok'})
    except Exception:
        return JsonResponse({'status':'unavailable'},status=503)
