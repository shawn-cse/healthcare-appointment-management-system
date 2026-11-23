from django.apps import AppConfig


class HospitalConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'hospital'
    verbose_name = 'Green Hospital'

    def ready(self):
        from django.forms.fields import TimeField
        TimeField.input_formats = [
            '%H:%M:%S', '%H:%M:%S.%f', '%H:%M',
            '%I:%M %p', '%I:%M%p', '%I:%M %P', '%I:%M%P'
        ]
