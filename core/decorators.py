from django.core.exceptions import PermissionDenied


def user_is_doctor(function):
    def wrap(request, *args, **kwargs):
        user = request.user
        if user.is_authenticated and (user.role == "doctor" or user.is_doctor):
            return function(request, *args, **kwargs)
        else:
            raise PermissionDenied

    return wrap
