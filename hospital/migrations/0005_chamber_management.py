from django.db import migrations, models
import django.db.models.deletion


def seed_initial_chambers(apps, schema_editor):
    Chamber = apps.get_model('hospital', 'Chamber')
    DoctorProfile = apps.get_model('hospital', 'DoctorProfile')
    Department = apps.get_model('hospital', 'Department')

    gynae_dept = Department.objects.filter(name__icontains='Gynae').first()
    cardio_dept = Department.objects.filter(name__icontains='Cardio').first()

    c1, _ = Chamber.objects.get_or_create(
        name='Ibn Sina Cancer Diagnostic Center',
        room_number='Room 707',
        defaults={
            'floor': '7th Floor',
            'address': 'House- 47, Road- 10/A, Dhanmondi, Dhaka',
            'contact_number': '09610009637, 10615',
            'department': gynae_dept,
            'is_active': True,
        }
    )

    c2, _ = Chamber.objects.get_or_create(
        name='Green Hospital Main Diagnostic Wing',
        room_number='Room 402',
        defaults={
            'floor': '4th Floor',
            'address': 'House- 47, Road- 10/A, Dhanmondi, Dhaka',
            'contact_number': '09610009637, 10615',
            'department': cardio_dept,
            'is_active': True,
        }
    )

    c3, _ = Chamber.objects.get_or_create(
        name='Green Hospital Outpatient Department',
        room_number='Room 305',
        defaults={
            'floor': '3rd Floor',
            'address': 'House- 47, Road- 10/A, Dhanmondi, Dhaka',
            'contact_number': '09610009637, 10615',
            'is_active': True,
        }
    )

    # Assign doctors
    for doc in DoctorProfile.objects.all():
        if 'shamima' in doc.user.username.lower() or (doc.qualifications and 'oncology' in doc.qualifications.lower()):
            doc.chamber = c1
            doc.room_number = c1.room_number
            doc.chamber_address = c1.address
            doc.contact_number = c1.contact_number
        elif 'karim' in doc.user.username.lower():
            doc.chamber = c2
            doc.room_number = c2.room_number
            doc.chamber_address = c2.address
            doc.contact_number = c2.contact_number
        else:
            doc.chamber = c3
            doc.room_number = c3.room_number
            doc.chamber_address = c3.address
            doc.contact_number = c3.contact_number
        doc.save()


class Migration(migrations.Migration):

    dependencies = [
        ('hospital', '0004_doctor_chamber_details'),
    ]

    operations = [
        migrations.CreateModel(
            name='Chamber',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(help_text='Chamber, Hospital or Diagnostic Center name', max_length=150)),
                ('room_number', models.CharField(default='Room 707', max_length=50)),
                ('floor', models.CharField(blank=True, default='7th Floor', max_length=50)),
                ('address', models.CharField(default='House- 47, Road- 10/A, Dhanmondi, Dhaka', max_length=255)),
                ('contact_number', models.CharField(default='09610009637, 10615', max_length=120)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('department', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='chambers', to='hospital.department')),
            ],
            options={
                'ordering': ['name', 'room_number'],
            },
        ),
        migrations.AddField(
            model_name='doctorprofile',
            name='chamber',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='doctors', to='hospital.chamber'),
        ),
        migrations.RunPython(seed_initial_chambers, migrations.RunPython.noop),
    ]
