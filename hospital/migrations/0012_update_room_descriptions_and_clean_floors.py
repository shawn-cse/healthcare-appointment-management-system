from django.db import migrations

def update_descriptions(apps, schema_editor):
    Chamber = apps.get_model('hospital', 'Chamber')
    updates = {
        'Chamber 101': 'Ground Floor, General Outpatient Wing',
        'Chamber 102': 'Ground Floor, Diagnostic Outpatient Wing',
        'Chamber 105': '1st Floor, Internal Medicine OPD',
        'Chamber 201': '2nd Floor, Cardiovascular & Chest Suite',
        'Chamber 202': '2nd Floor, Pediatric & Child Health Center',
        'Chamber 302': '3rd Floor, Specialist Outpatient Clinic',
        'Chamber 303': '3rd Floor, Neurology & Brain Suite',
        'Chamber 305': '3rd Floor, ENT & Head-Neck Outpatient Suite',
        'Room 305': '3rd Floor, Nephrology & Urology Clinic',
        'Chamber 401': '4th Floor, Endocrine & Diabetes Wing',
        'Chamber 402': '4th Floor, Dermatology & Skin Care Wing',
        'Room 402': '4th Floor, Pediatric Consultation Suite',
        'Chamber 405': '4th Floor, Surgical Consultation Suite',
        'Chamber 501': '5th Floor, Executive Consultant Lounge',
        'Room 707': '7th Floor, Oncology & Executive Care Center',
    }
    for ch in Chamber.objects.all():
        if ch.room_number in updates:
            ch.description = updates[ch.room_number]
            ch.save()

class Migration(migrations.Migration):

    dependencies = [
        ('hospital', '0011_complaint_admin_attachment_complaint_attachment_and_more'),
    ]

    operations = [
        migrations.RunPython(update_descriptions, migrations.RunPython.noop),
    ]
