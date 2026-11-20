from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static
from hospital import views
admin.site.site_header = 'Green Hospital | Administration'
admin.site.site_title = 'Green Hospital'
admin.site.index_title = 'Operations Console'
urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('hospital.urls')),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
