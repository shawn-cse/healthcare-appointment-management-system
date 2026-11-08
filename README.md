# Green Hospital - Healthcare Appointment Management System

Green Hospital is a modern healthcare appointment booking and hospital management system that connects patients with doctors. The platform streamlines finding doctors, scheduling appointments, and managing clinical consultations.

## Features

### For Patients
- Search doctors by specialization, location, or name
- View doctor profiles and availability
- Book appointments online
- Manage appointments (view, cancel, print)
- Digital appointment records/patient history
- Personal health profile management
- View booking history and invoices
- Submit reviews and ratings for doctors

### For Doctors
- Professional profile management
- Schedule management and working sessions
- Appointment handling (accept, cancel, complete)
- Patient records access
- View patient history
- Manage consultation fees
- Track appointments and bookings
- Write digital prescriptions
- View earnings and statistics

### For Hospital Administrators & Super Admins
- Comprehensive administrative dashboard
- Role-based user management (Super Admin, Hospital Admin, Doctor, Receptionist, Patient)
- Operational administration & receptionist assignments
- Doctor registration approvals
- Appointment oversight
- Revenue tracking and analysis
- Advanced reporting features:
  - Appointment analytics
  - Revenue statistics
  - Doctor performance metrics
  - Monthly trends visualization
  - Financial summaries
- Specialization management
- Review moderation
- Prescription monitoring
- Audit logging for sensitive administrative actions

### General Features
- Multi-role authentication and authorization (RBAC)
- Data isolation (patient-to-patient, doctor-to-doctor)
- Responsive design
- Secure data handling
- Digital invoicing
- Rating and review system
- Interactive charts and statistics
- Real-time data visualization

## Tech Stack

### Backend
- Python 3.11+
- Django 5 / 6
- Django REST Framework
- SQLite3 / PostgreSQL

### Frontend
- HTML5, CSS3, JavaScript
- Bootstrap 4
- jQuery
- Chart.js for analytics
- HTMX for dynamic content
- Font Awesome icons

### Additional Tools
- Pillow for image handling
- Django Crispy Forms
- CKEditor for rich text editing

## Installation

1. Clone or download the repository

2. Create a virtual environment
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
```

3. Install dependencies
```bash
pip install -r requirements.txt
```

4. Set up the database
```bash
python manage.py migrate
```

5. Create a superuser
```bash
python manage.py createsuperuser
```

6. Load sample data (optional)
```bash
python manage.py loaddata fixtures/initial_data.json
```

7. Run the development server
```bash
python manage.py runserver
```

8. Visit http://localhost:8000 in your browser

## Demo Users
After loading fixtures, sample demo accounts:

**Doctor Account:**
- Username: doctor1
- Password: Abcdefgh.1

**Patient Account:**
- Username: patient1
- Password: Abcdefgh.1

## Support
For support, email support@greenhospital.com.
"# healthcare-appointment-management-system" 
