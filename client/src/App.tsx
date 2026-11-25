import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingScreen } from './components/UI.tsx';
import { useAuth } from './context/AuthContext.tsx';
import type { UserRole } from './types/index.ts';

import AppointmentDetailPage from './pages/AppointmentDetailPage.tsx';
import AppointmentsPage from './pages/AppointmentsPage.tsx';
import AuditLogPage from './pages/AuditLogPage.tsx';
import BookPage from './pages/BookPage.tsx';
import ComplaintNewPage from './pages/ComplaintNewPage.tsx';
import ComplaintQueuePage from './pages/ComplaintQueuePage.tsx';
import ComplaintsPage from './pages/ComplaintsPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import DepartmentsPage from './pages/DepartmentsPage.tsx';
import DoctorDetailPage from './pages/DoctorDetailPage.tsx';
import DoctorRulesPage from './pages/DoctorRulesPage.tsx';
import DoctorsPage from './pages/DoctorsPage.tsx';
import HomePage from './pages/HomePage.tsx';
import LoginChoicePage from './pages/LoginChoicePage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import NotFoundPage from './pages/NotFoundPage.tsx';
import PasswordChangePage from './pages/PasswordChangePage.tsx';
import ProfilePage from './pages/ProfilePage.tsx';
import RefundsPage from './pages/RefundsPage.tsx';
import RegisterPage from './pages/RegisterPage.tsx';
import ReportsPage from './pages/ReportsPage.tsx';
import RoomsPage from './pages/RoomsPage.tsx';
import { SlotFormPage, WeeklyFormPage } from './pages/ScheduleFormsPage.tsx';
import SchedulePage from './pages/SchedulePage.tsx';
import StaffBookPage from './pages/StaffBookPage.tsx';
import StaffListPage from './pages/StaffListPage.tsx';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Public Portal */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginChoicePage />} />
      <Route path="/login/:kind" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/doctors" element={<DoctorsPage />} />
      <Route path="/doctors/:identifier" element={<DoctorDetailPage />} />

      {/* Authenticated Patient & Clinical Portal */}
      <Route
        path="/book/:slotId"
        element={
          <RequireAuth>
            <BookPage />
          </RequireAuth>
        }
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/appointments"
        element={
          <RequireAuth>
            <AppointmentsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/appointments/:id"
        element={
          <RequireAuth>
            <AppointmentDetailPage />
          </RequireAuth>
        }
      />
      <Route
        path="/reception/book"
        element={
          <RequireRole roles={['admin', 'receptionist', 'doctor']}>
            <StaffBookPage />
          </RequireRole>
        }
      />
      <Route
        path="/schedules"
        element={
          <RequireRole roles={['admin', 'receptionist', 'doctor']}>
            <SchedulePage />
          </RequireRole>
        }
      />
      <Route
        path="/schedules/weekly/:doctorPk"
        element={
          <RequireRole roles={['admin', 'doctor']}>
            <WeeklyFormPage />
          </RequireRole>
        }
      />
      <Route
        path="/schedules/weekly/:doctorPk/:id"
        element={
          <RequireRole roles={['admin', 'doctor']}>
            <WeeklyFormPage />
          </RequireRole>
        }
      />
      <Route
        path="/schedules/slot"
        element={
          <RequireRole roles={['admin', 'doctor']}>
            <SlotFormPage />
          </RequireRole>
        }
      />
      <Route
        path="/schedules/slot/:id"
        element={
          <RequireRole roles={['admin', 'doctor']}>
            <SlotFormPage />
          </RequireRole>
        }
      />
      <Route
        path="/doctors/:id/rules"
        element={
          <RequireRole roles={['admin', 'doctor']}>
            <DoctorRulesPage />
          </RequireRole>
        }
      />

      {/* Staff, Rooms, Departments, Finance, Support & Governance */}
      <Route
        path="/staff"
        element={
          <RequireRole roles={['admin', 'doctor', 'receptionist']}>
            <StaffListPage />
          </RequireRole>
        }
      />
      <Route
        path="/staff/new"
        element={
          <RequireRole roles={['admin']}>
            <StaffListPage initialCreate />
          </RequireRole>
        }
      />
      <Route
        path="/staff/:id"
        element={
          <RequireRole roles={['admin']}>
            <StaffListPage />
          </RequireRole>
        }
      />
      <Route
        path="/rooms"
        element={
          <RequireRole roles={['admin']}>
            <RoomsPage />
          </RequireRole>
        }
      />
      <Route
        path="/departments"
        element={
          <RequireRole roles={['admin']}>
            <DepartmentsPage />
          </RequireRole>
        }
      />
      <Route
        path="/finance/refunds"
        element={
          <RequireRole roles={['admin', 'receptionist']}>
            <RefundsPage />
          </RequireRole>
        }
      />
      <Route
        path="/complaints"
        element={
          <RequireAuth>
            <ComplaintsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/complaints/new"
        element={
          <RequireAuth>
            <ComplaintNewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/service/complaints"
        element={
          <RequireRole roles={['admin', 'doctor', 'receptionist']}>
            <ComplaintQueuePage />
          </RequireRole>
        }
      />
      <Route
        path="/reports"
        element={
          <RequireRole roles={['admin', 'doctor']}>
            <ReportsPage />
          </RequireRole>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireRole roles={['admin']}>
            <AuditLogPage />
          </RequireRole>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile/password"
        element={
          <RequireAuth>
            <PasswordChangePage />
          </RequireAuth>
        }
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
