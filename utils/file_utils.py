import os
import string
from random import choice
from django.core.exceptions import ValidationError

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


def validate_image_file(file_obj):
    """
    Validates uploaded image file extension and size to prevent unsafe script/executable uploads.
    """
    if not file_obj:
        return
    ext = os.path.splitext(file_obj.name)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValidationError(
            f"Unsupported file format '{ext}'. Allowed image formats are: JPG, JPEG, PNG, WEBP."
        )
    if hasattr(file_obj, "size") and file_obj.size > MAX_IMAGE_SIZE_BYTES:
        raise ValidationError("Image file size exceeds maximum permitted limit of 5 MB.")


def generate_file_name(length=30):
    letters = string.ascii_letters + string.digits
    return "".join(choice(letters) for _ in range(length))


def profile_photo_directory_path(instance, filename):
    """
    Sanitizes filename by assigning a random alphanumeric token and restricting extension.
    """
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        ext = ".png"
    return f"profiles/{generate_file_name()}{ext}"
