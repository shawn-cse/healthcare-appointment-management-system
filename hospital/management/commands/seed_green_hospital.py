"""Idempotent fictional starter directory for a new development installation."""
from datetime import date, time
from django.core.management.base import BaseCommand
from django.db import transaction
from hospital.models import User, Department, DoctorProfile, WeeklyAvailability, HospitalPolicy
from hospital.services import materialize_weekly

DEPARTMENTS = [
    ('Cardiology','Heart and cardiovascular care'),
    ('Neurology','Brain, spinal cord and nervous system care'),
    ('Orthopedics','Bone, joint and musculoskeletal care'),
    ('Gastroenterology','Digestive system and liver care'),
    ('Dermatology','Skin, hair and nail care'),
    ('Pediatrics','Healthcare for infants, children and adolescents'),
    ('Gynecology and Obstetrics','Women’s health, pregnancy and maternity care'),
    ('ENT','Ear, nose and throat care'),
    ('Endocrinology','Hormonal and metabolic health'),
    ('General Medicine','Internal medicine and primary consultation'),
]
# All identities are intentionally fictional and distinct.
MEN = [
    ('Karim','Hassan'),('Mahmud','Rahman'),('Tanvir','Ahmed'),
    ('Rafiq','Islam'),('Anis','Chowdhury'),('Nayeem','Khan'),
    ('Fahim','Kabir'),('Imran','Hossain'),('Sabbir','Mahmud'),
    ('Farhan','Siddique'),('Shafiqul','Alam'),('Arif','Miah'),
    ('Faisal','Haque'),('Rashed','Uddin'),('Iftikhar','Sarker'),
    ('Shahid','Iqbal'),('Raihan','Azad'),('Aminul','Bari'),
    ('Zahid','Hasan'),('Ashraf','Kamal'),('Nabil','Sultan'),
    ('Saif','Noman'),('Tariq','Rashid'),('Adnan','Faruq'),
    ('Moin','Akter'),('Jubayer','Hasib'),('Arafat','Haque'),
    ('Shihab','Nasir'),('Alif','Chowdhury'),('Shuvo','Ahmed'),
]
WOMEN = [
    ('Nusrat','Jahan'),('Samira','Rahman'),('Farzana','Islam'),('Nadia','Khan'),
    ('Tasnim','Akter'),('Maliha','Hasan'),('Rumana','Haque'),('Sadia','Anjum'),
    ('Nafisa','Chowdhury'),('Tanjina','Sultana'),('Ayesha','Nawrin'),('Ishrat','Ferdous'),
    ('Mehjabin','Alam'),('Rabeya','Khatun'),('Mariam','Begum'),('Sharmin','Sarker'),
    ('Jannatul','Fariha'),('Tahmina','Rahman'),('Rima','Hossain'),('Sabrina','Afroz'),
]
RECEPTIONISTS = [('Shirin','Akter'),('Masud','Rana'),('Lubna','Yasmin'),('Abir','Hossain'),('Sumaiya','Islam')]
PATIENTS = [('Amin','Hossain'),('Joya','Rahman'),('Rifat','Hasan'),('Mim','Akter'),('Arman','Kabir')]

class Command(BaseCommand):
    help = 'Create the Green Hospital initial directory and accounts without duplicating existing data.'

    def handle(self, *args, **options):
        policy = HospitalPolicy.current()
        admin, created = User.objects.get_or_create(username='admin', defaults={
            'first_name':'Hospital','last_name':'Administrator','role':'admin','is_staff':True,
            'is_superuser':True,'email':'admin@greenhospital.local','phone':'01900000000',
            })
        if created:
            admin.set_password('abc123');admin.save(update_fields=['password'])
        # Never reset credentials or existing information on a subsequent restart.
        departments=[]
        from django.utils.text import slugify
        for name,desc in DEPARTMENTS:
            d,_=Department.objects.get_or_create(slug=slugify(name),defaults={'name':name,'description':desc})
            departments.append(d)
        receps=[]
        for i,(first,last) in enumerate(RECEPTIONISTS):
            username = first.lower()
            u,new=User.objects.get_or_create(username=username,defaults={
                'first_name':first,'last_name':last,'role':'receptionist',
                'email':f'{username}.reception@gmail.com','phone':f'01700004{i+1:03d}',
                'dob':date(1996+i,4,15)})
            if new: u.set_password('abc123');u.save(update_fields=['password'])
            receps.append(u)
        for i,(first,last) in enumerate(PATIENTS):
            phone=f'01600005{i+1:03d}'
            username=f'patient{i+1}'
            email=f'patient.{first.lower()}{i+1}@gmail.com'
            u = User.objects.filter(role='patient', phone=phone).first()
            if u:
                if u.username != username or u.email != email:
                    u.username = username
                    u.email = email
                    u.save(update_fields=['username', 'email'])
            else:
                u, new = User.objects.get_or_create(username=username, defaults={
                    'first_name':first,'last_name':last,'role':'patient',
                    'phone':phone,'email':email,
                    'dob':date(1995+i,6,10)})
                if new:
                    u.set_password('abc123')
                    u.save(update_fields=['password'])
        created_doctors=0
        for group, dep in enumerate(departments):
            roster = [(MEN[group*3+j], 'male') for j in range(3)] + [(WOMEN[group*2+j], 'female') for j in range(2)]
            for j,((first,last),gender) in enumerate(roster):
                username=first.lower() if first=='Karim' else (first+'_'+last).lower().replace(' ','_')
                phone=f'018{group:02d}{j+1:06d}'
                u,new=User.objects.get_or_create(username=username,defaults={
                    'first_name':first,'last_name':last,'role':'doctor',
                    'email':f'{username}@gmail.com','phone':phone,'dob':date(1981+(group+j)%15,7,12),
                    })
                if new: u.set_password('abc123');u.save(update_fields=['password']);created_doctors+=1
                doc,profile_new=DoctorProfile.objects.get_or_create(user=u,defaults={
                    'department':dep,'gender':gender,'qualifications':'MBBS, FCPS',
                    'designation':'Consultant','experience_years':5+((group+j)%17),
                    'initial_fee':1000,'followup_fee':800,'followup_within_days':30,'report_fee':500,
                    'hospital_share_mode':policy.default_hospital_mode,'hospital_share_value':policy.default_hospital_value,
                    'booking_notice_hours':policy.default_notice_hours,'booking_advance_days':policy.default_advance_days,
                    'payment_deadline_hours':policy.default_payment_hours,
                    'cancel_fee_mode':policy.default_cancel_mode,'cancel_fee_value':policy.default_cancel_value})
                if profile_new:
                    doc.receptionists.add(receps[group//2])
                    for weekday in (0,2,4):
                        WeeklyAvailability.objects.get_or_create(doctor=doc,weekday=weekday,start_time=time(14,0),
                            defaults={'end_time':time(18,0),'duration_minutes':30,'capacity':2})
                materialize_weekly(doc, days=60)
        self.stdout.write(self.style.SUCCESS(f'Green Hospital directory ready: {len(departments)} departments, 50 doctors, 5 receptionists, 5 patients; {created_doctors} new doctors.'))
