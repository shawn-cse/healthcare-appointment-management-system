import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureDatabaseSchema, prisma } from '../src/config/db.js';
import { env } from '../src/config/env.js';
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
    expect(refReq.requestedById).toBeNull();
    await expect(approveRefund(refReq.id, receptionUser)).rejects.toThrow(/administrator/i);
    await approveRefund(refReq.id, adminUser);
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
    const patientCancel = await request(app).post(`/api/appointments/${booked2.id}/cancel`).set('Authorization', `Bearer ${patientToken}`);
    expect(patientCancel.status).toBe(403);
    await cancelAppointment(booked2.id, adminUser, { reason: 'Patient requested cancellation' });

    const refReq2 = await prisma.refundRequest.findUniqueOrThrow({
      where: { appointmentId: booked2.id },
    });
    expect(Number(refReq2.amount)).toBe(850);
    await approveRefund(refReq2.id, adminUser);
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

  it('auto-generates a unique patient username when omitted and provides live username conflict checking', async () => {
    const payload = {
      full_name: 'Test User',
      gender: 'female',
      username: '',
      phone: '01633333333',
      dob: '1992-05-10',
      email: 'testuser@example.com',
      password1: 'SecureTest123!',
      password2: 'SecureTest123!',
    };
    const autoReg = await request(app).post('/api/auth/register').send({
      ...payload,
      phone: '01633333334',
      email: '',
    });
    expect(autoReg.status).toBe(201);
    expect(autoReg.body.user.username).toMatch(/^testuser_[0-9a-f]{6}$/);

    const reg = await request(app).post('/api/auth/register').send({ ...payload, username: 'test-unique' });
    expect(reg.status).toBe(201);
    const equivalentPhone = await request(app).post('/api/auth/register').send({ ...payload, username: 'second', email: '', phone: '+880 1633-333333' });
    expect(equivalentPhone.status).toBe(400);
    expect(reg.body.user.username).toBe('test-unique');

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

  it('blocks deactivated staff and revokes blocked or reset sessions', async () => {
    const account = Number(doctorUser.id);
    const admin = `Bearer ${adminToken}`;
    await request(app).post(`/api/staff/${account}/toggle-active`).set('Authorization', admin).expect(200);
    await request(app).get('/api/appointments').set('Authorization', `Bearer ${doctorToken}`).expect(401);
    await request(app).get('/api/complaints').set('Authorization', `Bearer ${doctorToken}`).expect(401);
    await request(app).post('/api/auth/login').send({ identifier: doctorUser.username, password: 'secureDoctor123!', portal: 'staff' }).expect(401);
    await request(app).put(`/api/staff/${account}/login-permission`).set('Authorization', admin).send({ login_allowed: true }).expect(400);
    const inactive = await request(app).get('/api/catalog/doctors').expect(200);
    expect(inactive.body.doctors.some((doctor: { user_id: number }) => doctor.user_id === account)).toBe(false);
    await request(app).post(`/api/staff/${account}/toggle-active`).set('Authorization', admin).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${doctorToken}`).expect(401);
    const reenabled = await request(app).post('/api/auth/login').send({ identifier: doctorUser.username, password: 'secureDoctor123!', portal: 'staff' }).expect(200);
    await request(app).put(`/api/staff/${account}`).set('Authorization', admin).send({ new_password: 'UpdatedDoctor789!' }).expect(200);
    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${reenabled.body.token}`).expect(401);
    await request(app).post('/api/auth/login').send({ identifier: doctorUser.username, password: 'UpdatedDoctor789!', portal: 'staff' }).expect(200);
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
      .send({ fee: 800 });
    expect(r1.status).toBe(200);
    expect(Number(r1.body.fee)).toBe(800);
    expect(r1.body.status).toBe(booked.status);

    const r2 = await request(app)
      .post(`/api/appointments/${booked.id}/quick-update`)
      .set('Authorization', `Bearer ${receptionToken}`)
      .send({ visit_type: 'report', collect_cash: '1' });
    expect(r2.status).toBe(403);
    const doctorCollect = await request(app).post(`/api/appointments/${booked.id}/collect`).set('Authorization', `Bearer ${doctorToken}`);
    expect(doctorCollect.status).toBe(403);
    const collected = await request(app).post(`/api/appointments/${booked.id}/collect`).set('Authorization', `Bearer ${receptionToken}`);
    expect(collected.status).toBe(200);
    const paidEdit = await request(app).post(`/api/appointments/${booked.id}/quick-update`).set('Authorization', `Bearer ${doctorToken}`).send({ visit_type: 'report' });
    expect(paidEdit.status).toBe(409);

    const otherAppt = await createAppointment({
      actor: adminUser,
      slotId: slotTwoId,
      patientId: null,
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
    expect(ticket.attachment).toBe(`/complaints/${ticket.id}/attachments/original`);
    expect((await request(app).get(`/api${ticket.attachment}`).set('Authorization', `Bearer ${otherPatientToken}`)).status).toBe(403);
    expect((await request(app).get(`/api${ticket.attachment}`).set('Authorization', `Bearer ${patientToken}`)).status).toBe(200);

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
        dob: '1984-10-19',
        registration_number: 'A-182371',
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

  it('preserves guest age, links verified historical bookings, and scopes support conversations', async () => {
    const phone = '01315550000';
    const dob = new Date('2000-01-01T00:00:00.000Z');
    const age = new Date().getUTCFullYear() - dob.getUTCFullYear();
    const desk = await request(app).post('/api/appointments').set('Authorization', `Bearer ${receptionToken}`).send({
      slot_id: Number(slotOneId), name: 'Guest Example', phone, age, gender: 'female', visit_type: 'first', payment_method: 'cash',
    }).expect(201);
    const guestId = BigInt(desk.body.appointment.id);
    const saved = await prisma.appointment.findUniqueOrThrow({ where: { id: guestId } });
    expect(saved).toMatchObject({ patientId: null, guestAge: age, guestDob: null });
    const registration = await request(app).post('/api/auth/register').send({
      full_name: 'Guest Example', username: 'guest-verify', phone, dob: '2000-01-01', gender: 'female', password1: 'StrongGuest123!', password2: 'StrongGuest123!',
    }).expect(201);
    const account = BigInt(registration.body.user.id);
    const authorization = `Bearer ${registration.body.token}`;
    await request(app).get(`/api/appointments/${guestId}`).set('Authorization', authorization).expect(404);
    const code = '123456';
    await prisma.phoneChallenge.create({ data: { userId: account, phone, codeHash: crypto.createHmac('sha256', env.jwtSecret).update(`${account}:${phone}:${code}`).digest('hex'), sentAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } });
    await request(app).post('/api/auth/phone/verify').set('Authorization', authorization).send({ code: '999999' }).expect(400);
    const verification = await request(app).post('/api/auth/phone/verify').set('Authorization', authorization).send({ code }).expect(200);
    expect(verification.body.linked).toBe(1);
    await request(app).get(`/api/appointments/${guestId}`).set('Authorization', authorization).expect(200);
    await request(app).get(`/api/appointments/${guestId}`).set('Authorization', `Bearer ${otherPatientToken}`).expect(404);
    const ticket = await request(app).post('/api/complaints').set('Authorization', `Bearer ${receptionToken}`).send({ subject: 'Schedule assistance', message: 'Please check the morning schedule.', category: 'assistance', recipient_id: Number(doctorUser.id) }).expect(201);
    const id = ticket.body.complaint.id;
    await request(app).get(`/api/complaints/${id}`).set('Authorization', `Bearer ${otherDoctorToken}`).expect(403);
    await request(app).post(`/api/complaints/${id}/reply`).set('Authorization', `Bearer ${doctorToken}`).send({ message: 'The schedule has been checked.' }).expect(200);
  });

  it('applies opening and payment cutoffs and preserves booked consultation times after recurring edits', async () => {
    const doctorId = Number(docProfile.id);
    await request(app).put(`/api/staff/doctor/${doctorId}/rules`).set('Authorization', `Bearer ${doctorToken}`).send({ booking_window_hours: 24, payment_deadline_hours: 24, payment_policy: 'within' }).expect(400);
    await request(app).put(`/api/staff/doctor/${doctorId}/rules`).set('Authorization', `Bearer ${doctorToken}`).send({ booking_window_hours: 720, payment_deadline_hours: 4, payment_policy: 'within' }).expect(200);
    const week = await request(app).post(`/api/catalog/schedules/weekly/${doctorId}`).set('Authorization', `Bearer ${doctorToken}`).send({ weekday: 5, start_time: '09:00', end_time: '10:00' }).expect(201);
    await request(app).post(`/api/catalog/schedules/weekly/${doctorId}`).set('Authorization', `Bearer ${doctorToken}`).send({ weekday: 5, start_time: '09:30', end_time: '10:30' }).expect(409);
    const slot = await prisma.appointmentSlot.findFirstOrThrow({ where: { doctorId: docProfile.id, templateId: BigInt(week.body.weekly.id), date: { gte: addDaysDate(localTodayDate(), 1), lte: addDaysDate(localTodayDate(), 14) } } });
    const booked = await request(app).post('/api/appointments').set('Authorization', `Bearer ${patientToken}`).send({ slot_id: Number(slot.id), visit_type: 'first', payment_method: 'cash' }).expect(201);
    await request(app).put(`/api/catalog/schedules/weekly/${doctorId}/${week.body.weekly.id}`).set('Authorization', `Bearer ${doctorToken}`).send({ weekday: 5, start_time: '10:30', end_time: '11:30' }).expect(200);
    const detail = await request(app).get(`/api/appointments/${booked.body.appointment.id}`).set('Authorization', `Bearer ${patientToken}`).expect(200);
    expect(detail.body.appointment.slot.start_time).toBe('09:00');
    expect((await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slot.id } })).isOpen).toBe(false);
  });

  it('reconciles refunds on transaction dates independently of consultation dates', async () => {
    const appt = await createAppointment({ actor: patientUser, slotId: slotOneId, patientId: patientUser.id });
    await recordCashPayment(appt.id, receptionUser);
    await cancelAppointment(appt.id, adminUser, { reason: 'Patient requested cancellation' });
    const refund = await prisma.refundRequest.findUniqueOrThrow({ where: { appointmentId: appt.id } });
    await approveRefund(refund.id, adminUser);
    await request(app).post(`/api/refunds/${refund.id}/cash`).set('Authorization', `Bearer ${receptionToken}`).send({ transaction_reference: 'REFUND-001' }).expect(200);
    const [charge, payout] = await Promise.all([
      prisma.paymentTransaction.findFirstOrThrow({ where: { appointmentId: appt.id, kind: 'charge' } }),
      prisma.paymentTransaction.findFirstOrThrow({ where: { appointmentId: appt.id, kind: 'refund' } }),
    ]);
    expect(payout.refundReference).toBe('REFUND-001');
    const earlier = addDaysDate(localTodayDate(), -2);
    await prisma.paymentTransaction.update({ where: { id: charge.id }, data: { processedAt: earlier } });
    const response = await request(app).get(`/api/reports?from=${dateToIso(earlier)}&to=${dateToIso(localTodayDate())}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(response.body.appointments).toHaveLength(0);
    expect(response.body.report).toMatchObject({ collected: 1000, refunded: 850, net: 150, hospital_cut: 15, doctor_cut: 135 });
    await request(app).get('/api/payments').set('Authorization', `Bearer ${otherPatientToken}`).expect(200).expect(({ body }) => expect(body.rows).toHaveLength(0));
  });

  it('routes rescheduling requests without moving appointments until authorized', async () => {
    const appt = await createAppointment({ actor: patientUser, slotId: slotOneId, patientId: patientUser.id });
    const patientAuth = `Bearer ${patientToken}`;
    const receptionistAuth = `Bearer ${receptionToken}`;
    const newSlot = await prisma.appointmentSlot.create({ data: { doctorId: docProfile.id, date: addDaysDate(futureDate, 1), startTime: parseTimeStr('11:00')!, endTime: parseTimeStr('12:00')!, capacity: 5 } });
    const reschedule = `/api/appointments/${appt.id}/reschedule`;
    await request(app).put(reschedule).set('Authorization', patientAuth).send({ slot_id: Number(newSlot.id) }).expect(403);
    await request(app).put(reschedule).set('Authorization', receptionistAuth).send({ slot_id: Number(newSlot.id) }).expect(403);
    const payload = { appointment_id: Number(appt.id), subject: 'Move my consultation', category: 'reschedule', message: 'Please move my visit to the next available morning.' };
    const first = await request(app).post('/api/complaints').set('Authorization', patientAuth).send(payload).expect(201);
    const repeated = await request(app).post('/api/complaints').set('Authorization', patientAuth).send(payload).expect(201);
    expect(repeated.body.complaint.id).toBe(first.body.complaint.id);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).slotId).toBe(slotOneId);
    const ticket = `/api/complaints/${first.body.complaint.id}`;
    await request(app).put(ticket).set('Authorization', `Bearer ${adminToken}`).send({ status: 'approved', recipient_id: Number(receptionUser.id) }).expect(200);
    const moved = await request(app).put(reschedule).set('Authorization', receptionistAuth).send({ slot_id: Number(newSlot.id) }).expect(200);
    expect(moved.body.appointment.reference).toBe(appt.reference);
    expect(moved.body.appointment.slot_id).toBe(Number(newSlot.id));
    await request(app).get(ticket).set('Authorization', patientAuth).expect(200).expect(({ body }) => expect(body.complaint.status).toBe('resolved'));
    const method = `/api/appointments/${appt.id}/payment-method`;
    await request(app).put(method).set('Authorization', `Bearer ${otherPatientToken}`).send({ payment_method: 'online' }).expect(404);
    await request(app).put(method).set('Authorization', patientAuth).send({ payment_method: 'online' }).expect(200).expect(({ body }) => expect(body.appointment.payment_method).toBe('online'));
  });

  it('requires a trusted gateway status before releasing checkout and verifies callbacks idempotently', async () => {
    const appt = await createAppointment({ actor: patientUser, slotId: slotOneId, patientId: patientUser.id, paymentMethod: 'online' });
    const transaction = await prisma.paymentTransaction.create({ data: {
      appointmentId: appt.id, method: 'online', kind: 'charge', status: 'initiated', amount: appt.fee,
      externalId: 'GHCHECKOUT001', gatewaySessionKey: 'fake-session-key',
    } });
    const backup = [env.sslcommerzStoreId, env.sslcommerzStorePassword];
    env.sslcommerzStoreId = 'fixture';
    env.sslcommerzStorePassword = 'fixture';
    let status = 'PENDING';
    const gateway = vi.fn(async () => Response.json({ APIConnect: 'DONE', tran_id: transaction.externalId, status }));
    vi.stubGlobal('fetch', gateway);
    try {
      const method = `/api/appointments/${appt.id}/payment-method`;
      const auth = `Bearer ${patientToken}`;
      await request(app).post('/payments/callback/cancel').send({ tran_id: transaction.externalId, status: 'CANCELLED' }).expect(302);
      expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).status).toBe('initiated');
      await request(app).put(method).set('Authorization', auth).send({ payment_method: 'cash' }).expect(409);
      status = 'CANCELLED';
      await request(app).put(method).set('Authorization', auth).send({ payment_method: 'cash' }).expect(200);
      expect((await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).status).toBe('failed');

      await request(app).put(method).set('Authorization', auth).send({ payment_method: 'online' }).expect(200);
      await prisma.paymentTransaction.create({ data: { appointmentId: appt.id, method: 'online', kind: 'charge', status: 'initiated', amount: appt.fee, externalId: 'GHCHECKOUT002' } });
      gateway.mockImplementation(async () => Response.json({ status: 'VALID', currency: 'BDT', tran_id: 'GHCHECKOUT002', amount: String(appt.fee) }));
      for (let i = 0; i < 2; i++) await request(app).post('/payments/callback/ipn').send({ val_id: 'fixture-validation' }).expect(200);
      expect(await prisma.paymentTransaction.count({ where: { appointmentId: appt.id, kind: 'charge', status: 'verified' } })).toBe(1);
    } finally {
      [env.sslcommerzStoreId, env.sslcommerzStorePassword] = backup;
      vi.unstubAllGlobals();
    }
  });
  it('deducts a monthly commission from settled payments and reports actual admin dashboard totals', async () => {
    const auth = `Bearer ${adminToken}`;
    await request(app).put(`/api/staff/${doctorUser.id}`).set('Authorization', auth)
      .send({ hospital_share_mode: 'monthly', hospital_share_value: 1250 }).expect(200);
    const secondSlot = await prisma.appointmentSlot.create({ data: {
      doctorId: docProfile.id, date: futureDate,
      startTime: parseTimeStr('16:00')!, endTime: parseTimeStr('17:00')!, capacity: 2,
    } });
    const first = await createAppointment({ actor: patientUser, slotId: slotOneId, patientId: patientUser.id });
    const second = await createAppointment({ actor: otherPatientUser, slotId: secondSlot.id, patientId: otherPatientUser.id });
    expect(Number(first.hospitalCut)).toBe(0);
    expect(Number((await recordCashPayment(first.id, receptionUser)).hospitalCut)).toBe(1000);
    expect(Number((await recordCashPayment(second.id, receptionUser)).hospitalCut)).toBe(250);
    await createAppointment({ actor: patientUser, slotId: secondSlot.id, patientId: patientUser.id });
    await prisma.appointmentSlot.update({ where: { id: slotOneId }, data: { date: localTodayDate() } });
    const dashboard = await request(app).get('/api/dashboard').set('Authorization', auth).expect(200);
    expect(dashboard.body.counts).toEqual({ today: 1, total: 3, paid: 2, unpaid: 1, revenue_today: 1250, revenue_7_days: 1250, revenue_30_days: 1250 });
    expect(dashboard.body.today_appointments.map((row: {id: number}) => row.id)).toEqual([Number(first.id)]);
    const filtered = await request(app).get('/api/appointments?payment=paid&payment_method=cash&visit_type=first').set('Authorization', auth).expect(200);
    expect(filtered.body.total).toBe(2);
  });

  it('manages multiple weekly sessions in one staff update and retains an existing appointment', async () => {
    const template = await prisma.weeklyAvailability.findFirstOrThrow({ where: { doctorId: docProfile.id } });
    await prisma.appointmentSlot.update({ where: { id: slotOneId }, data: { templateId: template.id } });
    const booked = await createAppointment({ actor: patientUser, slotId: slotOneId, patientId: patientUser.id });
    const auth = `Bearer ${adminToken}`;
    const schedule_rules = [{ weekday: template.weekday, start_time: '17:00', end_time: '18:00' }, { weekday: template.weekday, start_time: '18:00', end_time: '19:00' }];
    await request(app).put(`/api/staff/${doctorUser.id}`).set('Authorization', auth).send({ schedule_rules }).expect(200);
    const prior = await prisma.appointmentSlot.findUniqueOrThrow({ where: { id: slotOneId } });
    expect(prior.isOpen).toBe(false);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } })).slotId).toBe(slotOneId);
    expect(await prisma.weeklyAvailability.count({ where: { doctorId: docProfile.id, active: true } })).toBe(2);
  });

  it('stores refund review notes and documents with assigned staff access', async () => {
    const appt = await createAppointment({ actor: patientUser, slotId: slotOneId, patientId: patientUser.id });
    await recordCashPayment(appt.id, receptionUser);
    await cancelAppointment(appt.id, adminUser, { reason: 'Patient requested cancellation' });
    const refund = await prisma.refundRequest.findUniqueOrThrow({ where: { appointmentId: appt.id } });
    const endpoint = `/api/refunds/${refund.id}/evidence`;
    const admin = `Bearer ${adminToken}`;
    const desk = `Bearer ${receptionToken}`;
    await request(app).post(endpoint).set('Authorization', desk).field('note', 'Unapproved').expect(404);
    await request(app).post(endpoint).set('Authorization', admin).field('note', 'Counter receipt reviewed')
      .attach('document', Buffer.from('%PDF-1.4 refund fixture'), 'receipt.pdf').expect(200);
    await request(app).get(endpoint).set('Authorization', `Bearer ${patientToken}`).expect(403);
    await approveRefund(refund.id, adminUser);
    const visible = await request(app).get('/api/refunds?status=approved').set('Authorization', desk).expect(200);
    expect(visible.body.refunds[0].review_note).toBe('Counter receipt reviewed');
    await request(app).get(endpoint).set('Authorization', desk).expect(200);
  });

});
