from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import (User,Department,DoctorProfile,WeeklyAvailability,AppointmentSlot,
                     Appointment,PaymentTransaction,RefundRequest,Complaint,HospitalPolicy,AuditEvent)

@admin.register(User)
class HospitalUserAdmin(UserAdmin):
    list_display=('username','first_name','last_name','role','phone','email','is_active')
    list_filter=('role','is_active','is_staff')
    search_fields=('username','email','phone','first_name','last_name')
    fieldsets=UserAdmin.fieldsets + (('Hospital profile',{'fields':('role','phone','dob','nid','address','avatar')}),)
    add_fieldsets=UserAdmin.add_fieldsets + (('Hospital profile',{'fields':('role','phone','email')}),)

@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display=('name','is_active');prepopulated_fields={'slug':('name',)}

@admin.register(DoctorProfile)
class DoctorAdmin(admin.ModelAdmin):
    list_display=('user','department','initial_fee','followup_fee','report_fee','is_available')
    list_filter=('department','is_available');filter_horizontal=('receptionists',)

@admin.register(WeeklyAvailability)
class WeeklyAdmin(admin.ModelAdmin):
    list_display=('doctor','weekday','start_time','end_time','duration_minutes','capacity','active')
    list_filter=('weekday','active')

@admin.register(AppointmentSlot)
class SlotAdmin(admin.ModelAdmin):
    list_display=('doctor','date','start_time','end_time','capacity','is_open')
    list_filter=('date','is_open')

@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display=('reference','guest_name','slot','status','payment_status','fee','source')
    list_filter=('status','payment_status','source','visit_type');search_fields=('reference','guest_name','guest_phone')
    readonly_fields=('reference','fee','hospital_cut','doctor_cut','created_at','updated_at')

@admin.register(PaymentTransaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display=('appointment','kind','method','status','amount','external_id','created_at')
    readonly_fields=('created_at',)

@admin.register(RefundRequest)
class RefundAdmin(admin.ModelAdmin):
    list_display=('appointment','amount','mode','status','created_at')

@admin.register(Complaint)
class ComplaintAdmin(admin.ModelAdmin):
    list_display=('subject','patient','status','created_at')
    list_filter=('status','category')

admin.site.register(HospitalPolicy)

@admin.register(AuditEvent)
class AuditAdmin(admin.ModelAdmin):
    list_display=('created_at','actor','action','target')
    readonly_fields=('actor','action','target','detail','created_at')
    def has_add_permission(self,request): return False
    def has_delete_permission(self,request,obj=None): return False
    def has_change_permission(self,request,obj=None): return False
