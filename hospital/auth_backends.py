from django.contrib.auth.backends import ModelBackend
from django.db.models import Q
from .models import User

class RoleAwareBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or not password:
            return None
        name = str(username).strip()
        users = User.objects.filter(Q(username__iexact=name) | Q(phone=name) | Q(email__iexact=name)).distinct()
        # Never resolve an ambiguous identifier to an arbitrary account.
        if users.count() != 1:
            return None
        user = users.first()
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
