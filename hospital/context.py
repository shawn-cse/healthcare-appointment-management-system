from django.conf import settings

def hospital_context(request):
    return {'hospital_name': settings.HOSPITAL_NAME, 'hospital_phone': settings.HOSPITAL_PHONE,
            'hospital_address': settings.HOSPITAL_ADDRESS}
