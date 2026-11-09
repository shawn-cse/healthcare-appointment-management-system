import re
from django.core.exceptions import ValidationError

# Accepts +88013XXXXXXXX to +88019XXXXXXXX, or 013XXXXXXXX to 019XXXXXXXX (with optional hyphens or spaces)
BD_PHONE_REGEX = re.compile(r"^(\+?8801|01)[3-9]\d{8}$")


def validate_bangladesh_phone(value: str):
    """
    Validates standard Bangladesh mobile numbers.
    Accepted formats:
    - 01712345678 (11 digits)
    - +8801712345678 or 8801712345678 (13-14 digits with country code)
    Valid operator prefixes: 013, 014, 015, 016, 017, 018, 019.
    """
    if not value:
        return value
    clean_val = re.sub(r"[\s\-]", "", str(value).strip())
    if not BD_PHONE_REGEX.match(clean_val):
        raise ValidationError(
            "Please enter a valid Bangladesh mobile number (e.g. 01712345678 or +8801712345678)."
        )
    return clean_val
