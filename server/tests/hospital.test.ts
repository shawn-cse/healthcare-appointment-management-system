import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureDatabaseSchema, prisma } from '../src/config/db.js';
import app from '../src/app.js';
import {
  cancelAppointment,
  collectedRevenueShares,
  createAppointment,
  feeFor,
  recordCashPayment,
} from '../src/services/appointments.js';
import { approveRefund, finalizeCashRefund } from '../src/services/refunds.js';
import { addDaysDate, dateToIso, localTodayDate, parseIsoDate, parseTimeStr } from '../src/utils/dateTime.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

function makeDjangoPbkdf2Hash(password: string): string {
  const salt = 'TestSalt123456';
  const iterations = 100000;
  const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
  return `pbkdf2_sha256$${iterations}$${salt}$${derived}`;
}

async function resetTestDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      hospital_auditevent,
      hospital_complaintmessage,
      hospital_complaint,
      hospital_refundrequest,
      hospital_paymenttransaction,
      hospital_appointment,
      hospital_appointmentslot,
      hospital_weeklyavailability,
      hospital_doctorprofile_receptionists,
      hospital_doctorprofile,
      hospital_chamber,
      hospital_department,
      hospital_hospitalpolicy,
      hospital_user
    RESTART IDENTITY CASCADE
  `);
}

describe('Green Hospital TypeScript + PostgreSQL Integration Suite', () => {
  let deptId: bigint;
  let adminUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let doctorUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let docProfile: Awaited<ReturnType<typeof prisma.doctorProfile.create>>;
  let otherDoctorUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let otherDocProfile: Awaited<ReturnType<typeof prisma.doctorProfile.create>>;
  let receptionUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let patientUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let otherPatientUser: Awaited<ReturnType<typeof prisma.user.create>>;
  let slotOneId: bigint;
  let slotTwoId: bigint;
  let futureDate: Date;

  let adminToken: string;
  let doctorToken: string;
  let receptionToken: string;
  let patientToken: string;
  let otherPatientToken: string;
  let otherDoctorToken: string;

  beforeAll(async () => {
    await ensureDatabaseSchema();
  });

  afterAll(async () => {
    await resetTestDb();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetTestDb();
    await prisma.hospitalPolicy.create({ data: { id: 1 } });

    const dept = await prisma.department.create({
      data: { name: 'Cardiology', slug: 'cardiology', isActive: true },
    });
    deptId = dept.id;

    const pwAdmin = await hashPassword('secureAdmin123!');
    const pwDoc = await hashPassword('secureDoctor123!');
    const pwRec = await hashPassword('secureReception123!');
    const pwPat = await hashPassword('securePatient123!');

    adminUser = await prisma.user.create({
      data: {
        username: 'admin',
        password: pwAdmin,
        firstName: 'Hospital',
        lastName: 'Admin',
        role: 'admin',
        phone: '01911111111',
        email: 'admin@greenhospital.local',
        isStaff: true,
        isSuperuser: true,
      },
    });

    doctorUser = await prisma.user.create({
      data: {
        username: 'doctor_one',
        password: pwDoc,
        firstName: 'Karim',
        lastName: 'Doctor',
        role: 'doctor',
        phone: '01811111111',
        email: 'karim@example.org',
      },
    });

    docProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        departmentId: deptId,
        initialFee: 1000,
        followupFee: 800,
        followupWithinDays: 30,
        reportFee: 500,
        cancelFeeMode: 'percent',
        cancelFeeValue: 15,
      },
    });

    otherDoctorUser = await prisma.user.create({
      data: {
        username: 'doctor_two',
        password: pwDoc,
        firstName: 'Tariq',
        lastName: 'Second',
        role: 'doctor',
        phone: '01822222222',
        email: 'tariq@example.org',
      },
    });

    otherDocProfile = await prisma.doctorProfile.create({
      data: {
        userId: otherDoctorUser.id,
        departmentId: deptId,
      },
    });

    receptionUser = await prisma.user.create({
      data: {
        username: 'reception_one',
        password: pwRec,
        firstName: 'Shirin',
        lastName: 'Reception',
        role: 'receptionist',
        phone: '01711111111',
        email: 'reception@example.org',
      },
    });

    await prisma.doctorReceptionist.create({
      data: { doctorProfileId: docProfile.id, userId: receptionUser.id },
    });

    patientUser = await prisma.user.create({
      data: {
        username: 'patient1',
        email: 'patient1@greenhospital.local',
        password: pwPat,
        role: 'patient',
        phone: '01611111111',
        firstName: 'Amin',
        lastName: 'Ahmed',
        dob: parseIsoDate('1990-01-01'),
      },
    });

    otherPatientUser = await prisma.user.create({
      data: {
        username: 'patient2',
        email: 'patient2@greenhospital.local',
        password: pwPat,
        role: 'patient',
        phone: '01622222222',
        firstName: 'Other',
        lastName: 'Patient',
        dob: parseIsoDate('1992-02-02'),
      },
    });

    futureDate = addDaysDate(localTodayDate(), 5);
    const start15 = parseTimeStr('15:00')!;
    const end1530 = parseTimeStr('15:30')!;

    await prisma.weeklyAvailability.create({
      data: {
        doctorId: docProfile.id,
        weekday: (futureDate.getUTCDay() + 6) % 7,
        startTime: start15,
        endTime: end1530,
        capacity: 1,
      },
    });

    const slot1 = await prisma.appointmentSlot.create({
      data: {
        doctorId: docProfile.id,
        date: futureDate,
        startTime: start15,
        endTime: end1530,
        capacity: 1,
      },
    });
    slotOneId = slot1.id;

    const slot2 = await prisma.appointmentSlot.create({
      data: {
        doctorId: otherDocProfile.id,
        date: futureDate,
        startTime: start15,
        endTime: end1530,
        capacity: 2,
      },
    });
    slotTwoId = slot2.id;

    const loginStaff = async (identifier: string, password: string) => {
      const r = await request(app)
        .post('/api/auth/login')
        .send({ identifier, password, portal: 'staff' });
      return r.body.token as string;
    };
    const loginPatient = async (identifier: string, password: string) => {
      const r = await request(app)
        .post('/api/auth/login')
        .send({ identifier, password, portal: 'patient' });
      return r.body.token as string;
    };

    adminToken = await loginStaff('admin', 'secureAdmin123!');
    doctorToken = await loginStaff('doctor_one', 'secureDoctor123!');
    otherDoctorToken = await loginStaff('doctor_two', 'secureDoctor123!');
    receptionToken = await loginStaff('reception_one', 'secureReception123!');
    patientToken = await loginPatient('patient1', 'securePatient123!');
    otherPatientToken = await loginPatient('patient2', 'securePatient123!');
  });

  it('verifies legacy Django pbkdf2_sha256 hashes seamlessly alongside bcrypt', async () => {
    const djangoHash = makeDjangoPbkdf2Hash('abc123');
    expect(await verifyPassword('abc123', djangoHash)).toBe(true);
    expect(await verifyPassword('wrong', djangoHash)).toBe(false);

    await prisma.user.update({
      where: { id: patientUser.id },
      data: { password: djangoHash },
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'patient1', password: 'abc123', portal: 'patient' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('enforces patient booking, capacity lock, and 6-char alphanumeric references', async () => {
    const app1 = await createAppointment({
      actor: patientUser,
      slotId: slotOneId,
      patientId: patientUser.id,
      visitType: 'first',
      source: 'web',
    });
    expect(Number(app1.fee)).toBe(1000);
    expect(app1.status).toBe('confirmed');
    expect(app1.serialNumber).toBe(1);
    expect(app1.reference).toMatch(/^[A-Z0-9]{6}$/);

    await expect(
      createAppointment({
        actor: patientUser,
        slotId: slotOneId,
        patientId: patientUser.id,
        visitType: 'first',
        source: 'web',
      })
    ).rejects.toThrow();
  });

  it('forbids staff from booking unassigned doctor and patients from booking other accounts', async () => {
    await expect(
      createAppointment({
        actor: receptionUser,
        slotId: slotTwoId,
        patientId: null,
        name: 'Telephone caller',
        phone: '01733333333',
        source: 'phone',
      })
    ).rejects.toThrow(/assigned/i);

    await expect(
      createAppointment({
        actor: patientUser,
        slotId: slotOneId,
        patientId: otherPatientUser.id,
        name: 'Other',
        phone: '01622222222',
        source: 'web',
      })
    ).rejects.toThrow(/own account/i);
  });

  it('enforces follow-up eligibility based on completed visit within window', async () => {
    await expect(
      feeFor(docProfile, 'followup', { patient: patientUser, appointmentDate: futureDate })
    ).rejects.toThrow();

    const earlierSlot = await prisma.appointmentSlot.create({
      data: {
        doctorId: docProfile.id,
        date: addDaysDate(futureDate, -10),
        startTime: parseTimeStr('10:00')!,
        endTime: parseTimeStr('10:30')!,
        capacity: 1,
      },
    });
    await prisma.appointment.create({
      data: {
        reference: 'PREV01',
        slotId: earlierSlot.id,
        patientId: patientUser.id,
        guestName: 'Amin Ahmed',
        guestPhone: patientUser.phone!,
        visitType: 'first',
        status: 'completed',
        paymentStatus: 'paid',
        fee: 1000,
      },
    });

    expect(
      await feeFor(docProfile, 'followup', { patient: patientUser, appointmentDate: futureDate })
    ).toBe(800);
    const booked = await createAppointment({
      actor: patientUser,
      slotId: slotOneId,
      patientId: patientUser.id,
      visitType: 'followup',
      source: 'web',
    });
    expect(Number(booked.fee)).toBe(800);
  });

  it('handles doctor full-refund cancellation and patient snapshot cancellation penalty + proportional revenue shares', async () => {
    const booked = await createAppointment({
      actor: patientUser,
      slotId: slotOneId,
      patientId: patientUser.id,
      visitType: 'first',
      source: 'web',
    });
    await recordCashPayment(booked.id, receptionUser);
    await cancelAppointment(booked.id, doctorUser, {
      byDoctor: true,
      reason: 'Doctor unavailable',
    });

    const refReq = await prisma.refundRequest.findUniqueOrThrow({
      where: { appointmentId: booked.id },
    });
    expect(Number(refReq.amount)).toBe(1000);
    await approveRefund(refReq.id, receptionUser);
    await finalizeCashRefund(refReq.id, receptionUser);
    const afterFull = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
    expect(afterFull.paymentStatus).toBe('refunded');

    // Second booking: patient cancels after doctor increases cancel fee to 90% -> uses 15% snapshot
    const slotExtra = await prisma.appointmentSlot.create({
      data: {
        doctorId: docProfile.id,
        date: addDaysDate(futureDate, 1),
        startTime: parseTimeStr('16:00')!,
        endTime: parseTimeStr('16:30')!,
        capacity: 2,
      },
    });
    const booked2 = await createAppointment({
      actor: patientUser,
      slotId: slotExtra.id,
      patientId: patientUser.id,
      visitType: 'first',
      source: 'web',
    });
    await recordCashPayment(booked2.id, receptionUser);
    await prisma.doctorProfile.update({
      where: { id: docProfile.id },
      data: { cancelFeeValue: 90 },
    });
    await cancelAppointment(booked2.id, patientUser, { reason: 'Changed plans' });

    const refReq2 = await prisma.refundRequest.findUniqueOrThrow({
      where: { appointmentId: booked2.id },
    });
    expect(Number(refReq2.amount)).toBe(850);
    await approveRefund(refReq2.id, receptionUser);
    await finalizeCashRefund(refReq2.id, receptionUser);

    const shares = await collectedRevenueShares([booked2]);
    expect(shares.hospital + shares.doctor).toBe(150);
    expect(shares.hospital).toBe(15);
    expect(shares.doctor).toBe(135);
  });

  it('enforces cross-role login portal guard and username/phone/email login', async () => {
    const res1 = await request(app)
      .post('/api/auth/login')
      .send({ identifier: patientUser.phone, password: 'securePatient123!', portal: 'staff' });
    expect(res1.status).toBe(403);
    expect(res1.body.error).toContain('patient account');

    const res2 = await request(app)
      .post('/api/auth/login')
      .send({ identifier: doctorUser.username, password: 'secureDoctor123!', portal: 'patient' });
    expect(res2.status).toBe(403);
    expect(res2.body.error).toContain('staff account');

    for (const id of [patientUser.username, patientUser.phone!, patientUser.email]) {
      const ok = await request(app)
        .post('/api/auth/login')
        .send({ identifier: id, password: 'securePatient123!', portal: 'patient' });
      expect(ok.status).toBe(200);
    }
  });

  it('auto-assigns patientN username when blank and provides live username conflict check', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      first_name: 'Test',
      last_name: 'User',
      username: '',
      phone: '01633333333',
      dob: '1992-05-10',
      email: 'testuser@example.com',
      password1: 'SecureTest123!',
      password2: 'SecureTest123!',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user.username).toMatch(/^patient\d+$/);

    const emptyCheck = await request(app).get('/api/auth/check-username?username=');
    expect(emptyCheck.body.status).toBe('empty');

    const conflictCheck = await request(app).get(
      `/api/auth/check-username?username=${doctorUser.username}`
    );
    expect(conflictCheck.body.status).toBe('conflict');

    const selfCheck = await request(app).get(
      `/api/auth/check-username?username=${doctorUser.username}&exclude_id=${doctorUser.id}`
    );
    expect(selfCheck.body.status).toBe('available');

    const okCheck = await request(app).get('/api/auth/check-username?username=dr_unique_999');
    expect(okCheck.body.status).toBe('available');
  });

  it('prevents patients and unassigned doctors from viewing another appointment', async () => {
    const app1 = await createAppointment({
      actor: patientUser,
      slotId: slotOneId,
      patientId: patientUser.id,
      visitType: 'first',
      source: 'web',
    });

    const r1 = await request(app)
      .get(`/api/appointments/${app1.id}`)
      .set('Authorization', `Bearer ${otherPatientToken}`);
    expect(r1.status).toBe(404);

    const r2 = await request(app)
      .get(`/api/appointments/${app1.id}`)
      .set('Authorization', `Bearer ${otherDoctorToken}`);
    expect(r2.status).toBe(404);
  });

  it('rejects cash payment after deadline expires', async () => {
    await prisma.doctorProfile.update({
      where: { id: docProfile.id },
      data: { paymentPolicy: 'within' },
    });
    const booked = await createAppointment({
      actor: patientUser,
      slotId: slotOneId,
      patientId: patientUser.id,
      visitType: 'first',
      source: 'web',
    });
    await prisma.appointment.update({
      where: { id: booked.id },
      data: { paymentDueAt: new Date(Date.now() - 60_000) },
    });

    await expect(recordCashPayment(booked.id, receptionUser)).rejects.toThrow(/deadline/i);
  });

  it('handles appointment quick-update permissions, fee tiers, and cash collection', async () => {
    const booked = await createAppointment({
      actor: patientUser,
      slotId: slotOneId,
      patientId: patientUser.id,
      visitType: 'first',
      source: 'web',
    });

    const r1 = await request(app)
      .post(`/api/appointments/${booked.id}/quick-update`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ visit_type: 'followup', status: 'completed' });
    expect(r1.status).toBe(200);
    expect(Number(r1.body.fee)).toBe(800);
    expect(r1.body.status).toBe('completed');

    const r2 = await request(app)
      .post(`/api/appointments/${booked.id}/quick-update`)
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ visit_type: 'report', collect_cash: '1' });
    expect(r2.status).toBe(200);
    expect(Number(r2.body.fee)).toBe(500);
    expect(r2.body.payment_status).toBe('paid');

    const otherAppt = await createAppointment({
      actor: adminUser,
      slotId: slotTwoId,
      patientId: otherPatientUser.id,
      name: 'Other Patient',
      phone: otherPatientUser.phone!,
      visitType: 'first',
      source: 'desk',
    });
    const r3 = await request(app)
      .post(`/api/appointments/${otherAppt.id}/quick-update`)
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ visit_type: 'followup' });
    expect(r3.status).toBe(404);
  });

  it('enforces Excel export permission and escapes formula injection payloads', async () => {
    await createAppointment({
      actor: receptionUser,
      slotId: slotOneId,
      patientId: null,
      name: '=2+2',
      phone: '01744444444',
      source: 'phone',
    });

    const recAttempt = await request(app)
      .get('/api/reports/excel')
      .set('Authorization', `Bearer ${receptionToken}`);
    expect(recAttempt.status).toBe(403);

    const from = dateToIso(localTodayDate());
    const to = dateToIso(futureDate);
    const adminExport = await request(app)
      .get(`/api/reports/excel?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(adminExport.status).toBe(200);
    expect(adminExport.headers['content-type']).toContain('spreadsheetml.sheet');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(adminExport.body);
    const sheet = wb.getWorksheet('Appointments')!;
    expect(sheet.getCell(2, 6).value).toBe("'=2+2");
  });

  it('supports public doctor directory, semantic slug resolution, and hides empty departments from public', async () => {
    await prisma.department.create({
      data: { name: 'Orthopedics Empty', slug: 'orthopedics-empty', isActive: true },
    });

    const homeRes = await request(app).get('/api/catalog/home');
    expect(homeRes.status).toBe(200);
    expect(homeRes.body.departments.map((d: { name: string }) => d.name)).not.toContain(
      'Orthopedics Empty'
    );

    const dirRes = await request(app).get('/api/catalog/doctors');
    expect(dirRes.status).toBe(200);
    expect(dirRes.body.departments.map((d: { name: string }) => d.name)).not.toContain(
      'Orthopedics Empty'
    );

    const allDeptRes = await request(app)
      .get('/api/catalog/departments')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(allDeptRes.status).toBe(200);
    expect(allDeptRes.body.departments.map((d: { name: string }) => d.name)).toContain(
      'Orthopedics Empty'
    );

    const slugRes = await request(app).get(`/api/catalog/doctors/${doctorUser.username}`);
    expect(slugRes.status).toBe(200);
    expect(slugRes.body.doctor.id).toBe(Number(docProfile.id));

    const pkRes = await request(app).get(`/api/catalog/doctors/${docProfile.id}`);
    expect(pkRes.status).toBe(200);
  });

  it('supports 3-step complaint lifecycle, role scoping, bulk update, and file attachments', async () => {
    const tmpFile = path.join('/tmp', 'test_ecg_report.pdf');
    await fs.writeFile(tmpFile, Buffer.from('%PDF-1.4 test document'));

    const createRes = await request(app)
      .post('/api/complaints')
      .set('Authorization', `Bearer ${patientToken}`)
      .field('category', 'support')
      .field('subject', 'Inquiry about report collection')
      .field('message', 'When can I collect my cardiology ECG report?')
      .attach('attachment', tmpFile);
    expect(createRes.status).toBe(201);
    const ticket = createRes.body.complaint;
    expect(ticket.status).toBe('submitted');
    expect(ticket.status_step).toBe(1);
    expect(ticket.display_code).toMatch(/^[A-Z0-9]{6}$/);
    expect(ticket.attachment).toContain('/media/complaints/patient/');

    const updateRes = await request(app)
      .put(`/api/complaints/${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('status', 'resolved')
      .field('response', 'Report ready at reception desk.');
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.complaint.status).toBe('resolved');
    expect(updateRes.body.complaint.status_step).toBe(3);

    const bulkRes = await request(app)
      .post('/api/complaints/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ selected_complaints: [ticket.id], bulk_status: 'reviewing' });
    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.updated).toBe(1);

    await fs.unlink(tmpFile).catch(() => {});
  });

  it('supports admin doctor onboarding, room management, and safe room deletion', async () => {
    const roomRes = await request(app)
      .post('/api/catalog/chambers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ room_number: 'Room 505', description: '5th Floor, Outpatient Clinic Note' });
    expect(roomRes.status).toBe(201);
    const roomId = roomRes.body.chamber.id;

    const newDocRes = await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        role: 'doctor',
        first_name: 'New',
        last_name: 'Doctor',
        username: 'new_doctor',
        email: 'new.doctor@example.org',
        phone: '01855555555',
        is_active: true,
        new_password: 'AnUniquePassword123!',
        department: Number(deptId),
        assigned_receptionist: Number(receptionUser.id),
        chamber: roomId,
        consultation_days: ['0', '2', '4'],
        consultation_start_time: '18:00',
        consultation_end_time: '20:00',
      });
    expect(newDocRes.status).toBe(201);

    const delRoom = await request(app)
      .delete(`/api/catalog/chambers/${roomId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRoom.status).toBe(200);

    const docAfter = await prisma.doctorProfile.findFirstOrThrow({
      where: { user: { username: 'new_doctor' } },
    });
    expect(docAfter.chamberId).toBeNull();
    expect(docAfter.roomNumber).toBe('');
  });
});
