from django.db import migrations

def shorten_room_descriptions_and_rename_chambers(apps, schema_editor):
    Chamber = apps.get_model('hospital', 'Chamber')
    DoctorProfile = apps.get_model('hospital', 'DoctorProfile')

    short_map = {
        '101': ('Room 101', 'Ground Floor, General OPD'),
        '102': ('Room 102', 'Ground Floor, Diagnostic OPD'),
        '105': ('Room 105', '1st Floor, Internal Medicine'),
        '201': ('Room 201', '2nd Floor, Cardiology & Chest'),
        '202': ('Room 202', '2nd Floor, Pediatrics & Child Care'),
        '302': ('Room 302', '3rd Floor, Specialist Clinic'),
        '303': ('Room 303', '3rd Floor, Neurology & Brain Care'),
        '305': ('Room 305', '3rd Floor, ENT & Head-Neck'),
        '401': ('Room 401', '4th Floor, Diabetes & Endocrine'),
        '402': ('Room 402', '4th Floor, Dermatology Care'),
        '405': ('Room 405', '4th Floor, Surgery Suite'),
        '501': ('Room 501', '5th Floor, Executive Lounge'),
        '707': ('Room 707', '7th Floor, Oncology & Women Care'),
    }

    for ch in Chamber.objects.all():
        num_part = ''.join(filter(str.isdigit, ch.room_number))
        if num_part in short_map:
            new_room, new_desc = short_map[num_part]
            ch.room_number = new_room
            # Preserve distinguishing specialty if already set on duplicates (e.g. Nephrology / Pediatrics)
            if 'Nephrology' in ch.description or ch.id == 3:
                ch.description = '3rd Floor, Nephrology & Urology'
            elif 'Pediatric Consultation' in ch.description or ch.id == 2:
                ch.description = '4th Floor, Pediatric Suite'
            elif ch.id == 5:
                ch.description = '2nd Floor, Special Consultation'
            else:
                ch.description = new_desc
        elif ch.room_number.startswith('Chamber '):
            ch.room_number = ch.room_number.replace('Chamber ', 'Room ')
        ch.save()

    # Sync doctors with updated room names
    for doc in DoctorProfile.objects.all():
        if doc.chamber:
            doc.room_number = doc.chamber.room_number
            doc.save(update_fields=['room_number'])
        elif doc.room_number and doc.room_number.startswith('Chamber '):
            doc.room_number = doc.room_number.replace('Chamber ', 'Room ')
            doc.save(update_fields=['room_number'])

class Migration(migrations.Migration):

    dependencies = [
        ('hospital', '0012_update_room_descriptions_and_clean_floors'),
    ]

    operations = [
        migrations.RunPython(shorten_room_descriptions_and_rename_chambers, migrations.RunPython.noop),
    ]
