import { Link } from 'react-router-dom';
import type { Doctor } from '../types/index.ts';

export function ProfessionalDetails({ doctor }: { doctor: Doctor }) {
  const experience = doctor.professional_experience.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return <>
    {doctor.qualifications_list.length > 0 && <div><strong>Qualifications</strong><ul>{doctor.qualifications_list.map((line, i) => <li key={i}>{line}</li>)}</ul></div>}
    {experience.length > 0 && <div><strong>Professional experience</strong><ul>{experience.map((line, i) => <li key={i}>{line}</li>)}</ul></div>}
  </>;
}

export default function DoctorCard({ doctor, onBook, actionLabel = 'Register Booking' }: { doctor: Doctor; onBook?: () => void; actionLabel?: string }) {
  const url = `/doctors/${doctor.profile_slug}`;
  return (
    <article className="doctor-card panel directory-clinician">
      <div className="doctor-card-top">
        <div className="doctor-avatar-wrapper">
          {doctor.avatar ? <img src={doctor.avatar} alt="" className="doctor-avatar-img" /> : (
            <span className="doctor-avatar-circle" aria-hidden="true">{doctor.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="doctor-primary-meta">
          <h2 className="doctor-name-heading">{doctor.full_doctor_title}</h2>
          {doctor.department && <span className="dept-tag">{doctor.department.name}</span>}
          <p className="doctor-designation-text">{doctor.designation}</p>
        </div>
      </div>
      <div className="doctor-card-middle">
        {doctor.chamber && <p>Room {doctor.chamber.room_number}</p>}
        <ProfessionalDetails doctor={doctor} />
        <div className="clinician-contact">
          <strong>{doctor.assigned_receptionist_name}</strong>
          <span>Receptionist</span>
          {doctor.assigned_receptionist_phone && <a href={`tel:${doctor.assigned_receptionist_phone}`}>{doctor.assigned_receptionist_phone}</a>}
        </div>
      </div>
      <div className="doctor-card-bottom consultation-times">
        <Link to={`${url}#weekly-schedule`} className="button button-outline">See Consultation Time</Link>
        {onBook ? <button type="button" className="button button-primary" onClick={onBook}>{actionLabel}</button>
          : <Link to={`${url}#booking`} className="button button-primary">Book Appointment</Link>}
      </div>
    </article>
  );
}
