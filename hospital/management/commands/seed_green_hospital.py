"""Idempotent fictional starter directory for a new development installation."""
from datetime import date, time
from django.core.management.base import BaseCommand
from django.db import transaction
from hospital.models import User, Department, DoctorProfile, WeeklyAvailability, HospitalPolicy, Chamber, AppointmentSlot
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
# Professional authentic credentials per department (5 doctors per department)
CREDENTIALS = {
    0: [  # Cardiology
        {'qual': "MBBS, FCPS (Medicine), MD (Cardiology), FACC (USA)\nSpecial Training in Interventional Cardiology & Angioplasty\nSenior Interventional Cardiologist", 'desig': "Professor & Head of Department, Cardiology", 'bmdc': "BMDC Reg: A-21940", 'exp': 22, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, D-Card (BSMMU), FCPS (Cardiology)\nSpecialist in Clinical & Preventive Cardiology, Echocardiography\nAdult Cardiovascular Specialist", 'desig': "Associate Professor, Cardiology", 'bmdc': "BMDC Reg: A-31852", 'exp': 16, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Cardiology), MRCP (UK)\nSpecial Training in Cardiac Arrhythmia & Heart Failure\nConsultant Clinical Cardiologist", 'desig': "Assistant Professor, Cardiology", 'bmdc': "BMDC Reg: A-42109", 'exp': 11, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Cardiology), Fellow Non-Invasive Cardiology (NHF)\nSpecialist in Hypertension, Heart Failure & 2D/3D Echo\nSenior Consultant Cardiologist", 'desig': "Associate Professor, Cardiology", 'bmdc': "BMDC Reg: A-28941", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Cardiology)\nSpecialist in Coronary Care & Clinical Cardiology\nCardiovascular Disease Consultant", 'desig': "Assistant Professor, Cardiology", 'bmdc': "BMDC Reg: A-49301", 'exp': 9, 'title': 'Dr.'},
    ],
    1: [  # Neurology
        {'qual': "MBBS, FCPS (Medicine), MD (Neurology), FINR (Switzerland)\nSpecial Training in Stroke Management & Interventional Neurology\nNeurology & Stroke Specialist", 'desig': "Professor & Head of Department, Neurology", 'bmdc': "BMDC Reg: A-20184", 'exp': 20, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, MS (Neurosurgery), Fellow Skull Base Surgery\nBrain, Spine & Micro-Neurosurgery Specialist\nSenior Neurosurgeon", 'desig': "Associate Professor, Neurosurgery", 'bmdc': "BMDC Reg: A-33451", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Neurology), Fellow Clinical Neurophysiology\nSpecialist in Epilepsy, Parkinson's & Neuropathy\nConsultant Neurologist", 'desig': "Associate Professor, Neurology", 'bmdc': "BMDC Reg: A-39820", 'exp': 12, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Neurology), Fellow Stroke Rehabilitation\nSpecialist in Headache, Neuromuscular & Neuro-Critical Care\nSenior Consultant Neurologist", 'desig': "Associate Professor, Neurology", 'bmdc': "BMDC Reg: A-35129", 'exp': 14, 'title': 'Dr.'},
        {'qual': "MBBS, MS (Neurosurgery), AO Spine Fellow\nMinimally Invasive Spine & Brain Surgeon\nConsultant Neurosurgeon", 'desig': "Assistant Professor, Neurosurgery", 'bmdc': "BMDC Reg: A-46781", 'exp': 8, 'title': 'Dr.'},
    ],
    2: [  # Orthopedics
        {'qual': "MBBS, MS (Orthopedics), D-Ortho (NITOR)\nSpecial Training in Arthroscopy & Total Knee/Hip Replacement\nSenior Joint Reconstruction Surgeon", 'desig': "Professor & Chief Orthopedic Surgeon", 'bmdc': "BMDC Reg: A-19842", 'exp': 24, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, FCPS (Orthopedic Surgery), AO Trauma Fellow (Germany)\nComplex Trauma, Pelvic Fracture & Deformity Correction Specialist\nTrauma & Orthopedic Surgeon", 'desig': "Associate Professor, Orthopedics", 'bmdc': "BMDC Reg: A-30219", 'exp': 16, 'title': 'Dr.'},
        {'qual': "MBBS, MS (Ortho), Fellow Pediatric Orthopedics\nSpine Surgery & Sports Medicine Specialist\nConsultant Orthopedic Surgeon", 'desig': "Associate Professor, Orthopedics", 'bmdc': "BMDC Reg: A-37650", 'exp': 13, 'title': 'Dr.'},
        {'qual': "MBBS, D-Ortho, FCPS (Ortho Surgery)\nArthroscopic Surgery & Musculoskeletal Trauma Specialist\nSenior Consultant Orthopedic Surgeon", 'desig': "Associate Professor, Orthopedic Surgery", 'bmdc': "BMDC Reg: A-32890", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, MS (Orthopedics)\nJoint Pain, Osteoarthritis & Fracture Care Specialist\nConsultant Orthopedic Surgeon", 'desig': "Assistant Professor, Orthopedics", 'bmdc': "BMDC Reg: A-44120", 'exp': 9, 'title': 'Dr.'},
    ],
    3: [  # Gastroenterology
        {'qual': "MBBS, FCPS (Medicine), MD (Gastroenterology), FACG (USA)\nSpecial Training in Therapeutic Endoscopy, Colonoscopy & ERCP\nSenior Gastroenterologist & Hepatologist", 'desig': "Professor & Head of Department, Gastroenterology", 'bmdc': "BMDC Reg: A-21094", 'exp': 21, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, MD (Hepatology), Fellow Liver Disease & Transplant\nSpecialist in Hepatitis, Fatty Liver & Liver Cirrhosis\nAssociate Professor of Hepatology", 'desig': "Associate Professor, Hepatology", 'bmdc': "BMDC Reg: A-32810", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Gastroenterology), MRCP (UK)\nSpecialist in IBD, Acid Peptic Disorders & GI Bleeding\nConsultant Gastroenterologist", 'desig': "Associate Professor, Gastroenterology", 'bmdc': "BMDC Reg: A-38491", 'exp': 12, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Gastroenterology), Fellow Interventional GI Endoscopy\nGI Stenting, Polypectomy & Capsule Endoscopy Specialist\nSenior Consultant Gastroenterologist", 'desig': "Associate Professor, Gastroenterology", 'bmdc': "BMDC Reg: A-33120", 'exp': 14, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Medicine), MD (Hepatology)\nClinical Hepatologist & Digestive Health Specialist\nAssistant Professor, Gastroenterology", 'desig': "Assistant Professor, Gastroenterology", 'bmdc': "BMDC Reg: A-47209", 'exp': 8, 'title': 'Dr.'},
    ],
    4: [  # Dermatology
        {'qual': "MBBS, DDV (BSMMU), FCPS (Dermatology & Venereology)\nSpecial Training in Dermatosurgery, Hair Transplant & Cutaneous Laser\nSenior Clinical Dermatologist", 'desig': "Professor & Head of Department, Dermatology", 'bmdc': "BMDC Reg: A-22419", 'exp': 20, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, DVD, MD (Dermatology), Fellow Aesthetic Medicine\nSpecialist in Psoriasis, Eczema & Laser Skin Procedures\nAssociate Professor, Dermatology", 'desig': "Associate Professor, Dermatology", 'bmdc': "BMDC Reg: A-31802", 'exp': 14, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Dermatology), Fellow Dermatopathology\nClinical Dermatologist, Allergy & Nail-Hair Disease Specialist\nConsultant Dermatologist", 'desig': "Associate Professor, Dermatology", 'bmdc': "BMDC Reg: A-37419", 'exp': 11, 'title': 'Dr.'},
        {'qual': "MBBS, DDV, Fellow Cosmetic Dermatology (Thailand)\nSpecialist in Acne, Melasma, Scar Treatment & Chemical Peel\nSenior Consultant Dermatologist", 'desig': "Associate Professor, Dermatology", 'bmdc': "BMDC Reg: A-33980", 'exp': 13, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Dermatology & Venereology)\nGeneral Dermatology, Skin Allergy & Infection Specialist\nAssistant Professor, Dermatology", 'desig': "Assistant Professor, Dermatology", 'bmdc': "BMDC Reg: A-48190", 'exp': 7, 'title': 'Dr.'},
    ],
    5: [  # Pediatrics
        {'qual': "MBBS, DCH, FCPS (Pediatrics), MD (Child Health)\nSpecial Training in Neonatal & Pediatric Intensive Care (NICU/PICU)\nSenior Child Specialist & Neonatologist", 'desig': "Professor & Head of Department, Pediatrics", 'bmdc': "BMDC Reg: A-23450", 'exp': 23, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, FCPS (Pediatrics), MRCPCH (UK)\nSpecialist in Pediatric Pulmonology, Childhood Asthma & Allergy\nAssociate Professor, Child Health", 'desig': "Associate Professor, Pediatrics", 'bmdc': "BMDC Reg: A-31209", 'exp': 16, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Pediatrics), Fellow Pediatric Cardiology\nChild Nutrition, Growth & Developmental Assessment Specialist\nConsultant Pediatrician", 'desig': "Associate Professor, Pediatrics", 'bmdc': "BMDC Reg: A-38910", 'exp': 12, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Pediatrics), Fellow Neonatology\nSpecialist in Newborn Care & Adolescent Medicine\nSenior Consultant Pediatrician", 'desig': "Associate Professor, Pediatrics", 'bmdc': "BMDC Reg: A-29401", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, DCH (BSMMU), FCPS (Pediatrics)\nGeneral Pediatrics, Immunization & Child Infection Specialist\nAssistant Professor, Pediatrics", 'desig': "Assistant Professor, Pediatrics", 'bmdc': "BMDC Reg: A-47890", 'exp': 8, 'title': 'Dr.'},
    ],
    6: [  # Gynecology and Obstetrics
        {'qual': "MBBS, FCPS(Gynaecological Oncology), FCPS(Gynae & Obs)\nSpecial Training in Colposcopy & Advanced Gynae Laparoscopy\nNational Institute of Cancer Research & Hospital(NICRH)\nGynaecological Oncology Specialist & Surgeon", 'desig': "Professor & Head of Department, Gynaecological Oncology", 'bmdc': "BMDC Reg: A-18492", 'exp': 25, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, MS (Gynae & Obs), Fellow Maternal Fetal Medicine\nHigh-Risk Pregnancy, Infertility & Laparoscopic Gynae Surgeon\nSenior Obstetrician & Gynaecologist", 'desig': "Professor, Obstetrics & Gynaecology", 'bmdc': "BMDC Reg: A-25109", 'exp': 19, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, FCPS (Gynae & Obs), Fellow Infertility & IVF\nReproductive Endocrinology, PCOS & Infertility Specialist\nAssociate Professor, Gynae & Obs", 'desig': "Associate Professor, Gynae & Obs", 'bmdc': "BMDC Reg: A-34821", 'exp': 14, 'title': 'Dr.'},
        {'qual': "MBBS, DGO, FCPS (Gynae & Obs)\nPelvic Reconstructive Surgery & Hysteroscopy Specialist\nSenior Consultant Obstetrician & Gynaecologist", 'desig': "Associate Professor, Gynae & Obs", 'bmdc': "BMDC Reg: A-29840", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, MS (Obstetrics & Gynaecology)\nNormal Delivery, Antenatal Care & Adolescent Gynaecology Specialist\nConsultant Obstetrician & Gynaecologist", 'desig': "Assistant Professor, Gynae & Obs", 'bmdc': "BMDC Reg: A-46109", 'exp': 9, 'title': 'Dr.'},
    ],
    7: [  # ENT
        {'qual': "MBBS, DLO (BSMMU), FCPS (ENT)\nSpecial Training in Microear Surgery & Head Neck Surgery\nENT Specialist & Head Neck Surgeon", 'desig': "Professor & Head of Department, ENT & Head Neck Surgery", 'bmdc': "BMDC Reg: A-20194", 'exp': 22, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, MS (ENT), Fellow Endoscopic Sinus Surgery (India)\nFunctional Endoscopic Sinus Surgery (FESS) & Rhinoplasty Specialist\nSenior ENT Surgeon", 'desig': "Associate Professor, ENT", 'bmdc': "BMDC Reg: A-32981", 'exp': 16, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Otolaryngology), FICS (USA)\nMicro-laryngeal Surgery, Snoring & Sleep Apnea Specialist\nConsultant Otolaryngologist", 'desig': "Associate Professor, ENT", 'bmdc': "BMDC Reg: A-39120", 'exp': 13, 'title': 'Dr.'},
        {'qual': "MBBS, DLO, FCPS (ENT), Fellow Otology\nEar Microsurgery, Tympanoplasty & Hearing Loss Specialist\nSenior Consultant, ENT", 'desig': "Associate Professor, ENT", 'bmdc': "BMDC Reg: A-34091", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, MS (Otolaryngology)\nHead & Neck Tumor, Thyroid & Salivary Gland Surgeon\nConsultant ENT Surgeon", 'desig': "Assistant Professor, ENT", 'bmdc': "BMDC Reg: A-45210", 'exp': 8, 'title': 'Dr.'},
    ],
    8: [  # Endocrinology
        {'qual': "MBBS, FCPS (Medicine), MD (Endocrinology), FACE (USA)\nSpecial Training in Diabetes, Thyroid Disorders & Hormone Metabolism\nSenior Diabetologist & Endocrinologist", 'desig': "Professor & Head of Department, Endocrinology", 'bmdc': "BMDC Reg: A-21450", 'exp': 21, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, MD (Endocrinology & Metabolism), Fellow Diabetes (UK)\nSpecialist in Gestational Diabetes, Obesity & Pituitary Disorders\nAssociate Professor, Endocrinology", 'desig': "Associate Professor, Endocrinology", 'bmdc': "BMDC Reg: A-32109", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Medicine), DEM (BSMMU)\nDiabetes, Thyroid & Metabolic Bone Disease Specialist\nConsultant Endocrinologist", 'desig': "Associate Professor, Endocrinology", 'bmdc': "BMDC Reg: A-38901", 'exp': 12, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Endocrinology), Fellow Pediatric Endocrinology\nGrowth Failure, Pubertal Disorders & Adrenal Specialist\nSenior Consultant Endocrinologist", 'desig': "Associate Professor, Endocrinology", 'bmdc': "BMDC Reg: A-33410", 'exp': 14, 'title': 'Dr.'},
        {'qual': "MBBS, DEM, FCPS (Medicine)\nClinical Diabetologist & Endocrine Specialist\nAssistant Professor, Endocrinology", 'desig': "Assistant Professor, Endocrinology", 'bmdc': "BMDC Reg: A-47120", 'exp': 8, 'title': 'Dr.'},
    ],
    9: [  # General Medicine
        {'qual': "MBBS, FCPS (Internal Medicine), FRCP (Glasgow), FACP (USA)\nSpecial Training in Complex Diagnostic Medicine, Multi-organ Diseases\nSenior Consultant Physician", 'desig': "Professor & Head of Department, Internal Medicine", 'bmdc': "BMDC Reg: A-19410", 'exp': 25, 'title': 'Prof. Dr.'},
        {'qual': "MBBS, MD (Internal Medicine), Fellow Infectious Diseases\nSpecialist in Adult Infectious Diseases, Fever & Tropical Medicine\nAssociate Professor, Internal Medicine", 'desig': "Associate Professor, Medicine", 'bmdc': "BMDC Reg: A-30891", 'exp': 16, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Medicine), MRCP (UK)\nSpecialist in Hypertension, Geriatric Care & Rheumatology\nConsultant Physician", 'desig': "Associate Professor, Internal Medicine", 'bmdc': "BMDC Reg: A-37420", 'exp': 13, 'title': 'Dr.'},
        {'qual': "MBBS, MD (Medicine), Fellow Critical Care Medicine\nAdult Acute Care, Respiratory & Sepsis Specialist\nSenior Consultant Physician", 'desig': "Associate Professor, Internal Medicine", 'bmdc': "BMDC Reg: A-32190", 'exp': 15, 'title': 'Dr.'},
        {'qual': "MBBS, FCPS (Internal Medicine)\nGeneral Medical Care, Diabetes & Lifestyle Disease Specialist\nAssistant Professor, Internal Medicine", 'desig': "Assistant Professor, Internal Medicine", 'bmdc': "BMDC Reg: A-45890", 'exp': 8, 'title': 'Dr.'},
    ],
}
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
                cred_list = CREDENTIALS.get(group, [])
                cred = cred_list[min(j, len(cred_list)-1)] if cred_list else {}
                qual = cred.get('qual', 'MBBS, FCPS')
                desig = cred.get('desig', 'Consultant')
                bmdc = cred.get('bmdc', f'BMDC Reg: A-{32000 + group*100 + j}')
                exp = cred.get('exp', 5+((group+j)%17))
                title = cred.get('title', 'Dr.')

                doc,profile_new=DoctorProfile.objects.get_or_create(user=u,defaults={
                    'department':dep,'gender':gender,'qualifications':qual,
                    'designation':desig,'experience_years':exp,
                    'title_prefix':title,'registration_number':bmdc,
                    'max_patients_per_session':30,
                    'institute':'Green Hospital Medical Center, Mirpur, Dhaka',
                    'room_number':f'Chamber {300 + (group*10 + j)%15}',
                    'chamber_address':'Plot 1, Section 10, Mirpur, Dhaka-1216',
                    'contact_number':'+88096100016211',
                    'initial_fee':1000,'followup_fee':800,'followup_within_days':30,'report_fee':500,
                    'hospital_share_mode':policy.default_hospital_mode,'hospital_share_value':policy.default_hospital_value,
                    'booking_notice_hours':policy.default_notice_hours,'booking_advance_days':policy.default_advance_days,
                    'payment_deadline_hours':policy.default_payment_hours,
                    'cancel_fee_mode':policy.default_cancel_mode,'cancel_fee_value':policy.default_cancel_value})
                if not profile_new:
                    doc.qualifications = qual
                    doc.designation = desig
                    doc.registration_number = bmdc
                    doc.experience_years = exp
                    doc.title_prefix = title
                    doc.gender = gender
                    doc.max_patients_per_session = 30
                    doc.contact_number = '+88096100016211'
                    doc.save()
                if profile_new:
                    doc.receptionists.add(*receps)
                    for weekday in (0,2,4):
                        WeeklyAvailability.objects.get_or_create(doctor=doc,weekday=weekday,start_time=time(14,0),
                            defaults={'end_time':time(18,0),'duration_minutes':240,'capacity':30})
                materialize_weekly(doc, days=60)

        # Ensure exact reference doctor requested: Prof. Dr. Chowdhury Shamima Sultana
        gynae_dep = next((d for d in departments if 'gynecology' in d.slug or 'gynae' in d.slug), departments[6])
        from decimal import Decimal
        doc_user, _ = User.objects.get_or_create(username='shamima_sultana', defaults={
            'first_name': 'Chowdhury Shamima', 'last_name': 'Sultana', 'role': 'doctor',
            'email': 'shamima.sultana@greenhospital.local', 'phone': '01899990707', 'dob': date(1975, 5, 20)
        })
        doc_user.first_name = 'Chowdhury Shamima'
        doc_user.last_name = 'Sultana'
        doc_user.save()
        doc_user.set_password('abc123')
        doc_user.save(update_fields=['password'])
        # Seed and link Chambers with Building, Floor, Description, and Mirpur Location
        c1, _ = Chamber.objects.get_or_create(
            room_number='Chamber 302',
            defaults={
                'building': 'Building 1',
                'name': 'Mirpur Central Outpatient Wing',
                'floor': '3rd Floor',
                'description': 'Building 1, chamber 302',
                'address': 'Plot 1, Section 10, Mirpur, Dhaka-1216',
                'contact_number': '+88096100016211, +16211',
                'department': departments[0] if departments else None,
                'is_active': True,
            }
        )
        c1.building = 'Building 1'
        c1.name = 'Mirpur Central Outpatient Wing'
        c1.description = 'Building 1, chamber 302'
        c1.floor = '3rd Floor'
        c1.address = 'Plot 1, Section 10, Mirpur, Dhaka-1216'
        c1.contact_number = '+88096100016211, +16211'
        c1.save()

        c2, _ = Chamber.objects.get_or_create(
            room_number='Chamber 202',
            defaults={
                'building': 'Building 3',
                'name': 'Green Hospital Specialized Wing',
                'floor': '2nd Floor',
                'description': 'Building 3, chamber 202',
                'address': 'Plot 1, Section 10, Mirpur, Dhaka-1216',
                'contact_number': '+88096100016211, +16211',
                'department': departments[1] if len(departments) > 1 else None,
                'is_active': True,
            }
        )
        c2.building = 'Building 3'
        c2.name = 'Green Hospital Specialized Wing'
        c2.description = 'Building 3, chamber 202'
        c2.floor = '2nd Floor'
        c2.address = 'Plot 1, Section 10, Mirpur, Dhaka-1216'
        c2.contact_number = '+88096100016211, +16211'
        c2.save()

        c3, _ = Chamber.objects.get_or_create(
            room_number='Room 707',
            defaults={
                'building': 'Building 1',
                'name': 'Mirpur Cancer Diagnostic & Oncology Center',
                'floor': '7th Floor',
                'description': 'Building 1, room 707',
                'address': 'Plot 1, Section 10, Mirpur, Dhaka-1216',
                'contact_number': '+88096100016211, +16211',
                'department': gynae_dep,
                'is_active': True,
            }
        )
        c3.building = 'Building 1'
        c3.name = 'Mirpur Cancer Diagnostic & Oncology Center'
        c3.description = 'Building 1, room 707'
        c3.floor = '7th Floor'
        c3.address = 'Plot 1, Section 10, Mirpur, Dhaka-1216'
        c3.contact_number = '+88096100016211, +16211'
        c3.save()

        c4, _ = Chamber.objects.get_or_create(
            room_number='Chamber 105',
            defaults={
                'building': 'Building 2',
                'name': 'Mirpur General Outpatient OPD',
                'floor': '1st Floor',
                'description': 'Building 2, chamber 105',
                'address': 'Plot 1, Section 10, Mirpur, Dhaka-1216',
                'contact_number': '+88096100016211, +16211',
                'is_active': True,
            }
        )
        c4.building = 'Building 2'
        c4.description = 'Building 2, chamber 105'
        c4.floor = '1st Floor'
        c4.address = 'Plot 1, Section 10, Mirpur, Dhaka-1216'
        c4.contact_number = '+88096100016211, +16211'
        c4.save()

        shamima_prof, _ = DoctorProfile.objects.get_or_create(user=doc_user, defaults={'department': gynae_dep})
        shamima_prof.chamber = c3
        shamima_prof.chamber_days = '0,2'  # Mon, Wed
        shamima_prof.title_prefix = 'Prof. Dr.'
        shamima_prof.qualifications = (
            "MBBS, FCPS(Gynaecological Oncology), FCPS(Gynae & Obs)\n"
            "National Institute of Cancer Research & Hospital(NICRH)\n"
            "Special Training in Gynecological Cancer Surgery & Laparoscopic Oncology"
        )
        shamima_prof.designation = 'Professor & Consultant'
        shamima_prof.institute = 'National Institute of Cancer Research & Hospital(NICRH)'
        shamima_prof.registration_number = 'A-22841'
        shamima_prof.gender = 'female'
        shamima_prof.max_patients_per_session = 30
        shamima_prof.room_number = 'Room 707'
        shamima_prof.chamber_address = 'Plot 1, Section 10, Mirpur, Dhaka-1216'
        shamima_prof.contact_number = '+88096100016211'
        shamima_prof.initial_fee = Decimal('1000.00')
        shamima_prof.followup_fee = Decimal('800.00')
        shamima_prof.report_fee = Decimal('500.00')
        shamima_prof.save()

        # Link doctors to chambers with multi-doctor sharing and distinct days
        # E.g. Building 1, Chamber 302 is shared by Dr. Karim (Mon, Wed, Fri) and Dr. Mahmud (Tue, Thu, Sat)
        karim_prof = DoctorProfile.objects.filter(user__username='karim').first()
        if karim_prof:
            karim_prof.chamber = c1
            karim_prof.chamber_days = '0,2,4'  # Mon, Wed, Fri
            karim_prof.room_number = c1.room_number
            karim_prof.chamber_address = c1.address
            karim_prof.contact_number = c1.contact_number
            karim_prof.save()
            karim_prof.weekly.all().delete()
            for w in (0, 2, 4):
                WeeklyAvailability.objects.create(doctor=karim_prof, weekday=w, start_time=time(16, 0),
                                                   end_time=time(18, 0), duration_minutes=120, capacity=30)
            materialize_weekly(karim_prof, days=60)

        mahmud_prof = DoctorProfile.objects.filter(user__username='mahmud_rahman').first()
        if mahmud_prof:
            mahmud_prof.chamber = c1
            mahmud_prof.chamber_days = '1,3,5'  # Tue, Thu, Sat (sharing Chamber 302!)
            mahmud_prof.room_number = c1.room_number
            mahmud_prof.chamber_address = c1.address
            mahmud_prof.contact_number = c1.contact_number
            mahmud_prof.save()
            mahmud_prof.weekly.all().delete()
            for w in (1, 3, 5):
                WeeklyAvailability.objects.create(doctor=mahmud_prof, weekday=w, start_time=time(16, 0),
                                                   end_time=time(18, 0), duration_minutes=120, capacity=30)
            materialize_weekly(mahmud_prof, days=60)

        # Other doctors in Chamber 202 (Building 3)
        for doc in DoctorProfile.objects.filter(chamber__isnull=True):
            doc.chamber = c2
            doc.chamber_days = '0,2,4'
            doc.room_number = c2.room_number
            doc.chamber_address = c2.address
            doc.contact_number = c2.contact_number
            doc.save()
        if receps:
            shamima_prof.receptionists.add(*receps)
        shamima_prof.weekly.all().delete()
        # Schedule: Mon (0) 18:00 - 20:00, Wed (2) 18:00 - 20:00
        WeeklyAvailability.objects.create(doctor=shamima_prof, weekday=0, start_time=time(18, 0),
            end_time=time(20, 0), duration_minutes=120, capacity=30)
        WeeklyAvailability.objects.create(doctor=shamima_prof, weekday=2, start_time=time(18, 0),
            end_time=time(20, 0), duration_minutes=120, capacity=30)
        materialize_weekly(shamima_prof, days=60)

        # Upgrade all legacy appointment slots with capacity < 30 to session capacity
        AppointmentSlot.objects.filter(capacity__lt=30).update(capacity=30)
        self.stdout.write(self.style.SUCCESS(f'Green Hospital directory ready: {len(departments)} departments, 50 doctors, 5 receptionists, 5 patients; {created_doctors} new doctors.'))
