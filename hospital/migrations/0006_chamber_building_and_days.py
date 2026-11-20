from django.db import migrations, models


def migrate_chambers_to_mirpur(apps, schema_editor):
    Chamber = apps.get_model('hospital', 'Chamber')
    DoctorProfile = apps.get_model('hospital', 'DoctorProfile')
    Department = apps.get_model('hospital', 'Department')

    gynae_dept = Department.objects.filter(name__icontains='Gynae').first()
    cardio_dept = Department.objects.filter(name__icontains='Cardio').first()
    ortho_dept = Department.objects.filter(name__icontains='Ortho').first()

    # 1. Building 1, Chamber 302 (Cardiology & Medicine)
    c1, _ = Chamber.objects.get_or_create(
        room_number='Chamber 302',
        defaults={
            'building': 'Building 1',
            'name': 'Mirpur Central Outpatient Wing',
            'floor': '3rd Floor',
            'description': 'Building 1, chamber 302',
            'address': 'Plot 1, Section 10, Mirpur, Dhaka-1216',
            'contact_number': '+88096100016211, +16211',
            'department': cardio_dept,
            'is_active': True,
        }
    )
    c1.building = 'Building 1'
    c1.description = 'Building 1, chamber 302'
    c1.floor = '3rd Floor'
    c1.address = 'Plot 1, Section 10, Mirpur, Dhaka-1216'
    c1.contact_number = '+88096100016211, +16211'
    c1.save()

    # 2. Building 3, Chamber 202 (Specialized Consultation)
    c2, _ = Chamber.objects.get_or_create(
        room_number='Chamber 202',
        defaults={
            'building': 'Building 3',
            'name': 'Green Hospital Specialized Wing',
            'floor': '2nd Floor',
            'description': 'Building 3, chamber 202',
            'address': 'Plot 1, Section 10, Mirpur, Dhaka-1216',
            'contact_number': '+88096100016211, +16211',
            'department': ortho_dept,
            'is_active': True,
        }
    )
    c2.building = 'Building 3'
    c2.description = 'Building 3, chamber 202'
    c2.floor = '2nd Floor'
    c2.address = 'Plot 1, Section 10, Mirpur, Dhaka-1216'
    c2.contact_number = '+88096100016211, +16211'
    c2.save()

    # 3. Building 1, Room 707 (Prof. Dr. Chowdhury Shamima Sultana)
    c3, _ = Chamber.objects.get_or_create(
        room_number='Room 707',
        defaults={
            'building': 'Building 1',
            'name': 'Mirpur Cancer Diagnostic & Oncology Center',
            'floor': '7th Floor',
            'description': 'Building 1, room 707',
            'address': 'Plot 1, Section 10, Mirpur, Dhaka-1216',
            'contact_number': '+88096100016211, +16211',
            'department': gynae_dept,
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

    # 4. Building 2, Chamber 105 (Empty / Available Chamber)
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

    # Update all other chambers to Mirpur address and new contact
    Chamber.objects.exclude(pk__in=[c1.pk, c2.pk, c3.pk, c4.pk]).update(
        address='Plot 1, Section 10, Mirpur, Dhaka-1216',
        contact_number='+88096100016211, +16211'
    )

    # Sync doctors with chambers and assigned days
    for doc in DoctorProfile.objects.all():
        if 'shamima' in doc.user.username.lower():
            doc.chamber = c3
            doc.chamber_days = '0,2'  # Mon, Wed
        elif 'karim' in doc.user.username.lower():
            doc.chamber = c1
            doc.chamber_days = '0,2,4'  # Mon, Wed, Fri
        else:
            doc.chamber = c2
            doc.chamber_days = '1,3,5'  # Tue, Thu, Sat
        doc.room_number = doc.chamber.room_number
        doc.chamber_address = doc.chamber.address
        doc.contact_number = doc.chamber.contact_number
        doc.save()


class Migration(migrations.Migration):

    dependencies = [
        ('hospital', '0005_chamber_management'),
    ]

    operations = [
        migrations.AddField(
            model_name='chamber',
            name='building',
            field=models.CharField(blank=True, default='Building 1', help_text='e.g. Building 1, Building 2, Building 3', max_length=80),
        ),
        migrations.AddField(
            model_name='chamber',
            name='description',
            field=models.CharField(blank=True, default='Building 1, chamber 302', help_text='e.g. Building 1, chamber 302', max_length=255),
        ),
        migrations.AlterField(
            model_name='chamber',
            name='room_number',
            field=models.CharField(default='Chamber 302', max_length=50),
        ),
        migrations.AlterField(
            model_name='chamber',
            name='floor',
            field=models.CharField(blank=True, default='3rd Floor', max_length=50),
        ),
        migrations.AlterField(
            model_name='chamber',
            name='address',
            field=models.CharField(default='Plot 1, Section 10, Mirpur, Dhaka-1216', max_length=255),
        ),
        migrations.AlterField(
            model_name='chamber',
            name='contact_number',
            field=models.CharField(default='+88096100016211, +16211', max_length=120),
        ),
        migrations.AddField(
            model_name='doctorprofile',
            name='chamber_days',
            field=models.CharField(blank=True, default='0,2', help_text='Comma-separated weekday numbers (0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun)', max_length=50),
        ),
        migrations.AlterField(
            model_name='doctorprofile',
            name='room_number',
            field=models.CharField(blank=True, default='Chamber 302', max_length=50),
        ),
        migrations.AlterField(
            model_name='doctorprofile',
            name='chamber_address',
            field=models.CharField(blank=True, default='Plot 1, Section 10, Mirpur, Dhaka-1216', max_length=255),
        ),
        migrations.AlterField(
            model_name='doctorprofile',
            name='contact_number',
            field=models.CharField(blank=True, default='+88096100016211, +16211', max_length=100),
        ),
        migrations.RunPython(migrate_chambers_to_mirpur, migrations.RunPython.noop),
    ]
