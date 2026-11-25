import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api, { getApiErrorMessage } from '../api/api.ts';
import { AppLayout } from '../components/Layout.tsx';
import { LoadingScreen } from '../components/UI.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { Chamber, Department, Doctor, User } from '../types/index.ts';

interface RulesResponse {
  doctor: Doctor;
  is_admin: boolean;
  departments: Department[];
  chambers: Chamber[];
  receptionists: User[];
}

export default function DoctorRulesPage() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [meta, setMeta] = useState<RulesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [designation, setDesignation] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [experienceYears, setExperienceYears] = useState(0);
  const [biography, setBiography] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);

  const [initialFee, setInitialFee] = useState(1200);
  const [followupFee, setFollowupFee] = useState(700);
  const [followupWithinDays, setFollowupWithinDays] = useState(30);
  const [reportFee, setReportFee] = useState(400);

  const [noticeHours, setNoticeHours] = useState(2);
  const [advanceDays, setAdvanceDays] = useState(30);
  const [paymentPolicy, setPaymentPolicy] = useState<'on_day' | 'within'>('on_day');
  const [deadlineHours, setDeadlineHours] = useState(6);
  const [cancelMode, setCancelMode] = useState<'percent' | 'fixed'>('percent');
  const [cancelVal, setCancelVal] = useState(0);

  // Admin-only fields
  const [departmentId, setDepartmentId] = useState('');
  const [chamberId, setChamberId] = useState('');
  const [receptionistId, setReceptionistId] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');
  const [regNumber, setRegNumber] = useState('');
  const [hospMode, setHospMode] = useState<'percent' | 'fixed'>('percent');
  const [hospVal, setHospVal] = useState(20);

  useEffect(() => {
    api
      .get<RulesResponse>(`/staff/doctor/${id}/rules`)
      .then((res) => {
        setMeta(res.data);
        const d = res.data.doctor;
        setDesignation(d.designation);
        setQualifications(d.qualifications);
        setExperienceYears(d.experience_years);
        setBiography(d.biography);
        setIsAvailable(d.is_available);

        setInitialFee(d.initial_fee);
        setFollowupFee(d.followup_fee);
        setFollowupWithinDays(d.followup_within_days);
        setReportFee(d.report_fee);

        setNoticeHours(d.booking_notice_hours);
        setAdvanceDays(d.booking_advance_days);
        setPaymentPolicy(d.payment_policy);
        setDeadlineHours(d.payment_deadline_hours);
        setCancelMode(d.cancel_fee_mode);
        setCancelVal(d.cancel_fee_value);

        setDepartmentId(d.department_id ? String(d.department_id) : '');
        setChamberId(d.chamber_id ? String(d.chamber_id) : '');
        setReceptionistId(d.assigned_receptionist_id ? String(d.assigned_receptionist_id) : '');
        setGender(d.gender);
        setRegNumber(d.registration_number);
        setHospMode(d.hospital_share_mode);
        setHospVal(d.hospital_share_value);
      })
      .catch((err) => {
        showToast(getApiErrorMessage(err, 'Could not load doctor rules.'), 'error');
        navigate('/dashboard');
      })
      .finally(() => setLoading(false));
  }, [id, navigate, showToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        designation,
        qualifications,
        experience_years: experienceYears,
        biography,
        is_available: isAvailable,
        initial_fee: initialFee,
        followup_fee: followupFee,
        followup_within_days: followupWithinDays,
        report_fee: reportFee,
        booking_notice_hours: noticeHours,
        booking_advance_days: advanceDays,
        payment_policy: paymentPolicy,
        payment_deadline_hours: deadlineHours,
        cancel_fee_mode: cancelMode,
        cancel_fee_value: cancelVal,
      };
      if (meta?.is_admin) {
        payload.department_id = departmentId || null;
        payload.chamber_id = chamberId || null;
        payload.receptionist_id = receptionistId || null;
        payload.gender = gender;
        payload.registration_number = regNumber;
        payload.hospital_share_mode = hospMode;
        payload.hospital_share_value = hospVal;
      }
      const res = await api.put<{ doctor: Doctor; message: string }>(
        `/staff/doctor/${id}/rules`,
        payload
      );
      showToast(res.data.message, 'success');
      setMeta((prev) => (prev ? { ...prev, doctor: res.data.doctor } : prev));
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save doctor rules.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !meta) {
    return (
      <AppLayout>
        <LoadingScreen />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FEE TIERS &amp; BOOKING POLICY</p>
          <h1>{meta.doctor.name}</h1>
          <p>
            Configure consultation fees, advance booking windows, payment deadlines, and
            cancellation rules.
          </p>
        </div>
        <div className="heading-actions">
          <Link className="button button-outline" to={`/schedules?doctor=${meta.doctor.id}`}>
            Manage Slots
          </Link>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="content-columns">
        <div className="panel" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Consultation Fees &amp; Clinical Profile</h2>
          <div className="form-grid two-col">
            <div className="form-group">
              <label htmlFor="dr-desig">Designation</label>
              <input
                id="dr-desig"
                type="text"
                className="field-control"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-exp">Experience (Years)</label>
              <input
                id="dr-exp"
                type="number"
                min={0}
                className="field-control"
                value={experienceYears}
                onChange={(e) => setExperienceYears(Number(e.target.value))}
              />
            </div>

            <div className="form-group full">
              <label htmlFor="dr-qual">Qualifications (comma-separated)</label>
              <input
                id="dr-qual"
                type="text"
                className="field-control"
                value={qualifications}
                onChange={(e) => setQualifications(e.target.value)}
              />
            </div>

            <div className="form-group full">
              <label htmlFor="dr-bio">Clinical Biography</label>
              <textarea
                id="dr-bio"
                rows={3}
                className="field-control"
                value={biography}
                onChange={(e) => setBiography(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-ifee">First Visit Fee (BDT)</label>
              <input
                id="dr-ifee"
                type="number"
                min={0}
                className="field-control"
                value={initialFee}
                onChange={(e) => setInitialFee(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-ffee">Follow-up Fee (BDT)</label>
              <input
                id="dr-ffee"
                type="number"
                min={0}
                className="field-control"
                value={followupFee}
                onChange={(e) => setFollowupFee(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-fdays">Follow-up Eligibility (Days)</label>
              <input
                id="dr-fdays"
                type="number"
                min={1}
                className="field-control"
                value={followupWithinDays}
                onChange={(e) => setFollowupWithinDays(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-rfee">Report Review Fee (BDT)</label>
              <input
                id="dr-rfee"
                type="number"
                min={0}
                className="field-control"
                value={reportFee}
                onChange={(e) => setReportFee(Number(e.target.value))}
              />
            </div>

            <div className="form-group full">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                />
                Listed as accepting public appointments
              </label>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 24, alignSelf: 'start' }}>
          <h2 style={{ marginTop: 0 }}>Booking &amp; Settlement Rules</h2>
          <div className="form-grid two-col">
            <div className="form-group">
              <label htmlFor="dr-notice">Minimum Notice (Hours)</label>
              <input
                id="dr-notice"
                type="number"
                min={0}
                className="field-control"
                value={noticeHours}
                onChange={(e) => setNoticeHours(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-adv">Max Advance Window (Days)</label>
              <input
                id="dr-adv"
                type="number"
                min={1}
                className="field-control"
                value={advanceDays}
                onChange={(e) => setAdvanceDays(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-pol">Payment Requirement</label>
              <select
                id="dr-pol"
                className="field-control"
                value={paymentPolicy}
                onChange={(e) => setPaymentPolicy(e.target.value as 'on_day' | 'within')}
              >
                <option value="on_day">Pay on Appointment Day / Cash</option>
                <option value="within">Advance Prepayment Deadline</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="dr-dead">Prepayment Deadline (Hours)</label>
              <input
                id="dr-dead"
                type="number"
                min={1}
                className="field-control"
                value={deadlineHours}
                onChange={(e) => setDeadlineHours(Number(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dr-cmode">Patient Cancellation Fee Mode</label>
              <select
                id="dr-cmode"
                className="field-control"
                value={cancelMode}
                onChange={(e) => setCancelMode(e.target.value as 'percent' | 'fixed')}
              >
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed Amount (BDT)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="dr-cval">Cancellation Fee Value</label>
              <input
                id="dr-cval"
                type="number"
                min={0}
                max={cancelMode === 'percent' ? 100 : undefined}
                className="field-control"
                value={cancelVal}
                onChange={(e) => setCancelVal(Number(e.target.value))}
              />
            </div>

            {meta.is_admin && (
              <>
                <div className="form-group full" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                  <strong>Administrator Governance Overrides</strong>
                </div>

                <div className="form-group">
                  <label htmlFor="dr-dept">Department (Optional)</label>
                  <select
                    id="dr-dept"
                    className="field-control"
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                  >
                    <option value="">No Department / Unassigned</option>
                    {meta.departments.map((dep) => (
                      <option key={dep.id} value={dep.id}>
                        {dep.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="dr-chamb">Assigned Room</label>
                  <select
                    id="dr-chamb"
                    className="field-control"
                    value={chamberId}
                    onChange={(e) => setChamberId(e.target.value)}
                  >
                    <option value="">No Room / Unassigned</option>
                    {meta.chambers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.room_number} ({c.building})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="dr-rec">Assigned Receptionist</label>
                  <select
                    id="dr-rec"
                    className="field-control"
                    value={receptionistId}
                    onChange={(e) => setReceptionistId(e.target.value)}
                  >
                    <option value="">None</option>
                    {meta.receptionists.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.display_name} (@{r.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="dr-reg">BM&amp;DC Registration No.</label>
                  <input
                    id="dr-reg"
                    type="text"
                    className="field-control"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="dr-hmode">Hospital Revenue Share Mode</label>
                  <select
                    id="dr-hmode"
                    className="field-control"
                    value={hospMode}
                    onChange={(e) => setHospMode(e.target.value as 'percent' | 'fixed')}
                  >
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed Fee (BDT)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="dr-hval">Hospital Share Value</label>
                  <input
                    id="dr-hval"
                    type="number"
                    min={0}
                    max={hospMode === 'percent' ? 100 : undefined}
                    className="field-control"
                    value={hospVal}
                    onChange={(e) => setHospVal(Number(e.target.value))}
                  />
                </div>

                <div className="form-group full">
                  <label htmlFor="dr-gender">Gender Profile (Default Icon)</label>
                  <select
                    id="dr-gender"
                    className="field-control"
                    value={gender}
                    onChange={(e) => setGender(e.target.value as 'male' | 'female' | 'other')}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </>
            )}

            <div className="form-group full">
              <button type="submit" className="button button-primary full" disabled={saving}>
                {saving ? 'Saving Policy...' : 'Save Fees & Booking Rules'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </AppLayout>
  );
}
