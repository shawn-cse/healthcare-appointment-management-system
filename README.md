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
- Digital invoicing and printable receipts
- Dual Payment Methods:
  - **Online Payment**: SSLCOMMERZ gateway integration (V4 API) with sandbox/live switching and local Mock gateway for development.
  - **Pay at Chamber**: Receptionist and Hospital Admin cash and POS collection with role assignment enforcement.
- Financial Integrity:
  - Decimal-safe BDT currency handling (`Decimal('0.00')`).
  - Server-side amount and signature verification.
  - 15-minute checkout session TTL with automatic capacity release on abandonment.
  - Zero raw bank card or CVV storage.
- Strict Cancellation & Refund Engine:
  - Timezone-authoritative policy (`Asia/Dhaka`):
    - $\ge 24$ hours before appointment: 100% refund.
    - $< 24$ hours before appointment: 80% refund (20% cancellation fee deducted).
    - At or after appointment start: 0% automatic refund.
    - Doctor / Hospital cancellation: 100% refund eligibility.
    - Unpaid bookings: 0 BDT refundable with no monetary refund records.
  - 8-stage refund lifecycle (`REQUESTED` → `UNDER_REVIEW` → `APPROVED`/`REJECTED` → `PROCESSING` → `SUCCEEDED`/`FAILED`).
  - Hospital Administrator review and forwarding; **Super Admin mandatory approval enforcement**.
  - Online gateway refund API integration and documented chamber manual repayment workflows with voucher tracking.
  - Doctor consultation session cancellation with multi-patient refund automation.
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

4. Configure Environment Variables
Copy `.env.example` to `.env` and configure your payment gateway and application settings:
```bash
cp .env.example .env
```
For local development and testing, use the mock payment gateway:
```ini
PAYMENT_GATEWAY_PROVIDER=mock
```
For SSLCOMMERZ Sandbox or Live integration:
```ini
PAYMENT_GATEWAY_PROVIDER=sslcommerz
SSLCOMMERZ_STORE_ID=your_store_id
SSLCOMMERZ_STORE_PASSWORD=your_store_password
SSLCOMMERZ_IS_SANDBOX=True # Set False in production
SSLCOMMERZ_BASE_URL=https://sandbox.sslcommerz.com
```

5. Set up the database
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
