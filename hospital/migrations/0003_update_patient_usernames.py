from django.db import migrations


def update_patient_usernames(apps, schema_editor):
    User = apps.get_model('hospital', 'User')
    patients = User.objects.filter(role='patient').order_by('id')
    taken = set(User.objects.values_list('username', flat=True))
    counter = 1

    for patient in patients:
        if patient.username.startswith('patient_') or not patient.username or patient.username.startswith('+'):
            while f'patient{counter}' in taken:
                counter += 1
            new_username = f'patient{counter}'
            taken.discard(patient.username)
            patient.username = new_username
            patient.save(update_fields=['username'])
            taken.add(new_username)
            counter += 1


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('hospital', '0002_remove_forced_password_change'),
    ]

    operations = [
        migrations.RunPython(update_patient_usernames, noop),
    ]
