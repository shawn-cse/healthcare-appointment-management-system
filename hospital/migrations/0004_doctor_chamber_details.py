from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hospital', '0003_update_patient_usernames'),
    ]

    operations = [
        migrations.AddField(
            model_name='doctorprofile',
            name='title_prefix',
            field=models.CharField(blank=True, default='Dr.', max_length=40),
        ),
        migrations.AddField(
            model_name='doctorprofile',
            name='institute',
            field=models.CharField(blank=True, default='National Institute of Cancer Research & Hospital(NICRH)', max_length=200),
        ),
        migrations.AddField(
            model_name='doctorprofile',
            name='room_number',
            field=models.CharField(blank=True, default='Room 707', max_length=50),
        ),
        migrations.AddField(
            model_name='doctorprofile',
            name='chamber_address',
            field=models.CharField(blank=True, default='House- 47, Road- 10/A, Dhanmondi, Dhaka', max_length=255),
        ),
        migrations.AddField(
            model_name='doctorprofile',
            name='contact_number',
            field=models.CharField(blank=True, default='09610009637, 10615', max_length=100),
        ),
    ]
