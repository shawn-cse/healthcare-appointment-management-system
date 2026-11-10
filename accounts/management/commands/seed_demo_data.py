from decimal import Decimal
from datetime import time
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import User, Profile, ReceptionistDoctorAssignment
from doctors.models import Specialty, DoctorWeeklySchedule


class Command(BaseCommand):
    help = "Seeds Green Hospital with 10 departments, 50 doctor profiles, 5 patients, 1 receptionist, and 1 admin."

    def handle(self, *args, **options):
        self.stdout.write("Starting Green Hospital demo data seeding...")

        with transaction.atomic():
            # ------------------------------------------------------------------
            # 1. Admin Account
            # ------------------------------------------------------------------
            admin_user, _ = User.objects.get_or_create(
                username="admin",
                defaults={
                    "email": "admin@gmail.com",
                    "first_name": "Super",
                    "last_name": "Admin",
                    "role": User.RoleChoices.SUPER_ADMIN,
                    "status": User.StatusChoices.ACTIVE,
                    "is_staff": True,
                    "is_superuser": True,
                },
            )
            admin_user.set_password("abc123")
            admin_user.email = "admin@gmail.com"
            admin_user.role = User.RoleChoices.SUPER_ADMIN
            admin_user.status = User.StatusChoices.ACTIVE
            admin_user.is_staff = True
            admin_user.is_superuser = True
            admin_user.save()
            self.stdout.write(self.style.SUCCESS("✓ Admin user created/updated: admin / abc123 (admin@gmail.com)"))

            # ------------------------------------------------------------------
            # 2. Receptionist Account
            # ------------------------------------------------------------------
            receptionist, _ = User.objects.get_or_create(
                username="nasrin",
                defaults={
                    "email": "nasrin@gmail.com",
                    "first_name": "Nasrin",
                    "last_name": "Akter",
                    "role": User.RoleChoices.RECEPTIONIST,
                    "status": User.StatusChoices.ACTIVE,
                    "is_staff": False,
                },
            )
            receptionist.set_password("abc123")
            receptionist.email = "nasrin@gmail.com"
            receptionist.role = User.RoleChoices.RECEPTIONIST
            receptionist.status = User.StatusChoices.ACTIVE
            receptionist.save()
            self.stdout.write(self.style.SUCCESS("✓ Receptionist created/updated: nasrin / abc123 (nasrin@gmail.com)"))

            # ------------------------------------------------------------------
            # 3. 5 Patient Profiles
            # ------------------------------------------------------------------
            patients_data = [
                ("rahim", "Rahim", "Uddin", "rahim@gmail.com", "+8801711000001"),
                ("karim", "Karim", "Chowdhury", "karim@gmail.com", "+8801711000002"),
                ("fatema", "Fatema", "Begum", "fatema@gmail.com", "+8801711000003"),
                ("tanvir", "Tanvir", "Ahmed", "tanvir@gmail.com", "+8801711000004"),
                ("salma", "Salma", "Khatun", "salma@gmail.com", "+8801711000005"),
            ]

            for uname, fname, lname, email, phone in patients_data:
                patient, _ = User.objects.get_or_create(
                    username=uname,
                    defaults={
                        "email": email,
                        "first_name": fname,
                        "last_name": lname,
                        "role": User.RoleChoices.PATIENT,
                        "status": User.StatusChoices.ACTIVE,
                    },
                )
                patient.set_password("abc123")
                patient.email = email
                patient.first_name = fname
                patient.last_name = lname
                patient.role = User.RoleChoices.PATIENT
                patient.status = User.StatusChoices.ACTIVE
                patient.save()

                if hasattr(patient, "profile"):
                    patient.profile.phone = phone
                    patient.profile.save()

            self.stdout.write(self.style.SUCCESS("✓ 5 Patients created/updated with password 'abc123'."))

            # ------------------------------------------------------------------
            # 4. 10 Departments / Specialties
            # ------------------------------------------------------------------
            departments = [
                ("Cardiology", "Heart, cardiovascular conditions, and hypertension care."),
                ("Neurology", "Brain, spinal cord, and nervous system disorders."),
                ("Orthopedics", "Bone, joint, spine, and musculoskeletal care."),
                ("Pediatrics", "Infant, child, and adolescent healthcare."),
                ("Dermatology", "Skin, hair, nail, and cosmetic clinical dermatology."),
                ("Gynecology & Obstetrics", "Women's health, maternity, and prenatal consultations."),
                ("Internal Medicine", "Adult illness diagnosis, chronic diseases, and preventive care."),
                ("Ophthalmology", "Vision care, eye surgeries, and cornea treatments."),
                ("ENT (Otolaryngology)", "Ear, nose, throat, head, and neck care."),
                ("Gastroenterology", "Digestive system, liver, stomach, and bowel health."),
            ]

            specialty_objs = {}
            for dept_name, dept_desc in departments:
                sp, _ = Specialty.objects.get_or_create(name=dept_name, defaults={"description": dept_desc})
                specialty_objs[dept_name] = sp
            self.stdout.write(self.style.SUCCESS("✓ 10 Clinical Departments verified in database."))

            # ------------------------------------------------------------------
            # 5. 50 Doctor Profiles (10 departments x 5 doctors)
            # ------------------------------------------------------------------
            # 50 unique Bangladeshi first names ensuring username uniqueness
            doctors_spec = [
                # Cardiology
                ("tariq", "Tariq", "Islam", "Cardiology", "101"),
                ("mahmud", "Mahmud", "Hasan", "Cardiology", "102"),
                ("kamal", "Kamal", "Hossain", "Cardiology", "103"),
                ("rafiq", "Rafiq", "Ahmed", "Cardiology", "104"),
                ("anisur", "Anisur", "Rahman", "Cardiology", "105"),
                # Neurology
                ("jahangir", "Jahangir", "Alam", "Neurology", "201"),
                ("shahidul", "Shahidul", "Islam", "Neurology", "202"),
                ("monirul", "Monirul", "Haque", "Neurology", "203"),
                ("habibur", "Habibur", "Rahman", "Neurology", "204"),
                ("saiful", "Saiful", "Chowdhury", "Neurology", "205"),
                # Orthopedics
                ("nazrul", "Nazrul", "Islam", "Orthopedics", "301"),
                ("ashraful", "Ashraful", "Huda", "Orthopedics", "302"),
                ("shafiqul", "Shafiqul", "Alam", "Orthopedics", "303"),
                ("aminul", "Aminul", "Ehsan", "Orthopedics", "304"),
                ("mizanur", "Mizanur", "Rahman", "Orthopedics", "305"),
                # Pediatrics
                ("faruk", "Faruk", "Ahmed", "Pediatrics", "401"),
                ("harun", "Harun", "Rashid", "Pediatrics", "402"),
                ("ziaur", "Ziaur", "Rahman", "Pediatrics", "403"),
                ("delwar", "Delwar", "Hossain", "Pediatrics", "404"),
                ("golam", "Golam", "Mostafa", "Pediatrics", "405"),
                # Dermatology
                ("sirajul", "Sirajul", "Islam", "Dermatology", "501"),
                ("khalid", "Khalid", "Hasan", "Dermatology", "502"),
                ("mortoza", "Mortoza", "Ali", "Dermatology", "503"),
                ("masud", "Masud", "Rana", "Dermatology", "504"),
                ("lutfor", "Lutfor", "Rahman", "Dermatology", "505"),
                # Gynecology & Obstetrics
                ("zahid", "Zahid", "Hasan", "Gynecology & Obstetrics", "601"),
                ("mostafa", "Mostafa", "Kamal", "Gynecology & Obstetrics", "602"),
                ("rezaul", "Rezaul", "Karim", "Gynecology & Obstetrics", "603"),
                ("asadur", "Asadur", "Zaman", "Gynecology & Obstetrics", "604"),
                ("badrul", "Badrul", "Huda", "Gynecology & Obstetrics", "605"),
                # Internal Medicine
                ("firoz", "Firoz", "Mahmood", "Internal Medicine", "701"),
                ("hassan", "Hassan", "Ali", "Internal Medicine", "702"),
                ("imran", "Imran", "Chowdhury", "Internal Medicine", "703"),
                ("jamil", "Jamil", "Ahmed", "Internal Medicine", "704"),
                ("kabir", "Kabir", "Hossain", "Internal Medicine", "705"),
                # Ophthalmology
                ("latif", "Latif", "Siddique", "Ophthalmology", "801"),
                ("mahbub", "Mahbub", "Alam", "Ophthalmology", "802"),
                ("noman", "Noman", "Habib", "Ophthalmology", "803"),
                ("parvez", "Parvez", "Akhtar", "Ophthalmology", "804"),
                ("quader", "Quader", "Miah", "Ophthalmology", "805"),
                # ENT (Otolaryngology)
                ("rashed", "Rashed", "Khan", "ENT (Otolaryngology)", "901"),
                ("selim", "Selim", "Reza", "ENT (Otolaryngology)", "902"),
                ("tawhid", "Tawhid", "Islam", "ENT (Otolaryngology)", "903"),
                ("usman", "Usman", "Goni", "ENT (Otolaryngology)", "904"),
                ("wadud", "Wadud", "Bhuiyan", "ENT (Otolaryngology)", "905"),
                # Gastroenterology
                ("yusuf", "Yusuf", "Abdullah", "Gastroenterology", "1001"),
                ("zakaria", "Zakaria", "Talukder", "Gastroenterology", "1002"),
                ("alif", "Alif", "Sarker", "Gastroenterology", "1003"),
                ("bashir", "Bashir", "Ahmed", "Gastroenterology", "1004"),
                ("chisty", "Chisty", "Molla", "Gastroenterology", "1005"),
            ]

            created_docs_count = 0
            for idx, (uname, fname, lname, dept, room) in enumerate(doctors_spec, 1):
                bmdc_code = f"BMDC-A{10000 + idx}"
                doc_email = f"{uname}@gmail.com"

                doc_user, _ = User.objects.get_or_create(
                    username=uname,
                    defaults={
                        "email": doc_email,
                        "first_name": fname,
                        "last_name": lname,
                        "role": User.RoleChoices.DOCTOR,
                        "status": User.StatusChoices.ACTIVE,
                        "bmdc_number": bmdc_code,
                        "bmdc_verified": True,
                    },
                )
                doc_user.set_password("abc123")
                doc_user.email = doc_email
                doc_user.first_name = fname
                doc_user.last_name = lname
                doc_user.role = User.RoleChoices.DOCTOR
                doc_user.status = User.StatusChoices.ACTIVE
                doc_user.bmdc_number = bmdc_code
                doc_user.bmdc_verified = True
                doc_user.save()

                # Update profile
                profile = doc_user.profile
                profile.department = dept
                profile.specialization = dept
                profile.chamber_number = f"Chamber {room}"
                profile.fee_first_visit = Decimal("1200.00")
                profile.fee_second_visit = Decimal("900.00")
                profile.fee_third_visit = Decimal("600.00")
                profile.fee_report_check = Decimal("300.00")
                profile.phone = f"+880172000{100 + idx}"
                profile.is_available = True
                profile.save()

                # Attach to Specialty
                sp_obj = specialty_objs.get(dept)
                if sp_obj:
                    sp_obj.doctors.add(doc_user)

                # Link receptionist assignment
                ReceptionistDoctorAssignment.objects.get_or_create(
                    receptionist=receptionist,
                    doctor=doc_user,
                )

                # Create recurring weekly schedules for Monday (0) to Friday (4)
                for day_code in range(5):  # Mon, Tue, Wed, Thu, Fri
                    DoctorWeeklySchedule.objects.get_or_create(
                        doctor=doc_user,
                        weekday=day_code,
                        session_name="Morning Consultation",
                        defaults={
                            "start_time": time(9, 0),
                            "end_time": time(13, 0),
                            "slot_duration": 20,
                            "max_capacity": 12,
                            "chamber_number": f"Chamber {room}",
                            "is_active": True,
                        },
                    )

                created_docs_count += 1

            self.stdout.write(
                self.style.SUCCESS(
                    f"✓ {created_docs_count} Doctor profiles created across 10 departments with schedules & receptionist assignments."
                )
            )

        self.stdout.write(self.style.SUCCESS("All Green Hospital demo data seeded successfully!"))
