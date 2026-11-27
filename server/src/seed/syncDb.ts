import { fileURLToPath } from 'node:url';
import { prisma } from '../config/db.js';
import { materializeWeekly } from '../services/appointments.js';
import { assertNoRoomWeeklyConflict } from '../services/roomConflict.js';
import { parseIsoDate, parseTimeStr } from '../utils/dateTime.js';
import { hashPassword } from '../utils/password.js';
import {
  CHAMBER_SPECS,
  computeDoctorFees,
  CREDENTIALS,
  DEPARTMENTS,
  MEN,
  SCHEDULE_PATTERNS,
  slugify,
  WOMEN,
} from './seed.js';

export async function syncLiveDatabase(): Promise<void> {
  // 1. Migrate any usernames containing underscores '_' to dots '.'
  const allUsers = await prisma.user.findMany({ orderBy: { id: 'asc' } });
  const takenLower = new Set(allUsers.map((u) => u.username.toLowerCase()));
  let migratedUsernames = 0;

  for (const u of allUsers) {
    if (!u.username.includes('_')) continue;
    const base = u.username.replace(/_+/g, '.').replace(/^\.+|\.+$/g, '') || `user.${u.id}`;
    let candidate = base;
    let suffix = 1;
    while (takenLower.has(candidate.toLowerCase()) && candidate.toLowerCase() !== u.username.toLowerCase()) {
      candidate = `${base}.${suffix++}`;
    }
    takenLower.delete(u.username.toLowerCase());
    takenLower.add(candidate.toLowerCase());
    await prisma.user.update({ where: { id: u.id }, data: { username: candidate } });
    migratedUsernames++;
  }
  console.log(`[sync] Migrated ${migratedUsernames} username(s) from '_' to '.'.`);

  // 2. Deduplicate existing chambers by roomNumber and ensure all CHAMBER_SPECS exist
  const existingChambers = await prisma.chamber.findMany({ orderBy: { id: 'asc' } });
  const keeperByRoom = new Map<string, (typeof existingChambers)[number]>();
  for (const ch of existingChambers) {
    if (!keeperByRoom.has(ch.roomNumber)) {
      keeperByRoom.set(ch.roomNumber, ch);
      continue;
    }
    const keeper = keeperByRoom.get(ch.roomNumber)!;
    await prisma.doctorProfile.updateMany({
      where: { chamberId: ch.id },
      data: { chamberId: keeper.id, roomNumber: keeper.roomNumber },
    });
    await prisma.user.updateMany({
      where: { chamberId: ch.id },
      data: { chamberId: keeper.id },
    });
    await prisma.chamber.delete({ where: { id: ch.id } });
  }

  const chambers = [];
  for (const [bld, rm, desc] of CHAMBER_SPECS) {
    let ch = keeperByRoom.get(rm);
    if (!ch) {
      ch = await prisma.chamber.create({
        data: {
          building: bld,
          roomNumber: rm,
          name: rm,
          floor: desc.split(',')[0],
          description: desc,
          address: 'Mirpur, Dhaka',
          contactNumber: '+88096100016211',
          isActive: true,
        },
      });
      keeperByRoom.set(rm, ch);
    }
    chambers.push(ch);
  }
  console.log(`[sync] Ensured ${chambers.length} unique consultation rooms.`);

  // 3. Ensure all 15 departments exist
  const departments = [];
  for (const [name, description] of DEPARTMENTS) {
    const slug = slugify(name);
    let dep = await prisma.department.findUnique({ where: { slug } });
    if (!dep) {
      dep = await prisma.department.create({
        data: { name, slug, description, icon: 'heart-pulse', isActive: true },
      });
    }
    departments.push(dep);
  }
  console.log(`[sync] Ensured ${departments.length} departments.`);

  const receps = await prisma.user.findMany({
    where: { role: 'receptionist', isActive: true },
    orderBy: { id: 'asc' },
  });
  const starterPassword = process.env.SEED_STARTER_PASSWORD || 'abc123';
  const defaultPasswordHash = await hashPassword(starterPassword);

  // 4. Create any missing department doctors (preserving 3 male, 2 female per department)
  let addedDoctors = 0;
  for (let group = 0; group < departments.length; group++) {
    const dep = departments[group];
    const roster: Array<[[string, string], 'male' | 'female']> = [
      ...[0, 1, 2].map((j) => [MEN[group * 3 + j], 'male'] as [[string, string], 'male']),
      ...[0, 1].map((j) => [WOMEN[group * 2 + j], 'female'] as [[string, string], 'female']),
    ];

    for (let j = 0; j < roster.length; j++) {
      const [[first, last], gender] = roster[j];
      const username =
        first === 'Karim'
          ? 'karim'
          : `${first}.${last}`.toLowerCase().replace(/\s+/g, '.');
      const phone = `018${String(group).padStart(2, '0')}${String(j + 1).padStart(6, '0')}`;

      let u = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: username, mode: 'insensitive' } },
            { phone },
          ],
        },
        include: { doctorProfile: true },
      });

      if (!u) {
        u = await prisma.user.create({
          data: {
            username,
            firstName: first,
            lastName: last,
            role: 'doctor',
            email: `${username}@gmail.com`,
            phone,
            dob: parseIsoDate(`${1981 + ((group + j) % 15)}-07-12`),
            password: defaultPasswordHash,
          },
          include: { doctorProfile: true },
        });
      }

      if (!u.doctorProfile) {
        const credList = CREDENTIALS[group] || [];
        const cred = credList[Math.min(j, credList.length - 1)];
        const qual = cred?.qual || 'MBBS, FCPS';
        const desig = cred?.desig || 'Consultant';
        const bmdc = cred?.bmdc || `BMDC Reg: A-${32000 + group * 100 + j}`;
        const exp = cred?.exp ?? 5 + ((group + j) % 17);
        const title = cred?.title || 'Dr.';
        const { initFee, folFee, folDays, repFee, maxCap } = computeDoctorFees(group, j, desig, exp);

        const defaultRoom = chambers[0];
        const doc = await prisma.doctorProfile.create({
          data: {
            userId: u.id,
            departmentId: dep.id,
            chamberId: defaultRoom.id,
            chamberDays: '5,0,2',
            gender,
            qualifications: qual,
            designation: desig,
            registrationNumber: bmdc,
            experienceYears: exp,
            titlePrefix: title,
            roomNumber: defaultRoom.roomNumber,
            chamberAddress: defaultRoom.address,
            contactNumber: '+88096100016211',
            initialFee: initFee,
            followupFee: folFee,
            followupWithinDays: folDays,
            reportFee: repFee,
            maxPatientsPerSession: maxCap,
          },
        });

        for (const r of receps) {
          await prisma.doctorReceptionist.create({
            data: { doctorProfileId: doc.id, userId: r.id },
          });
        }
        addedDoctors++;
      }
    }
  }
  console.log(`[sync] Added ${addedDoctors} new doctor(s).`);

  // 5. Assign strictly non-overlapping (room, shift) schedules across all active doctors
  const room102 = chambers.find((c) => c.roomNumber === 'Room 102') || chambers[1];
  const room707 = chambers.find((c) => c.roomNumber === 'Room 707') || chambers[chambers.length - 1];

  const freeSlots: Array<{ chamber: (typeof chambers)[number]; sched: (typeof SCHEDULE_PATTERNS)[number] }> = [];
  for (let p = 0; p < SCHEDULE_PATTERNS.length; p++) {
    for (const ch of chambers) {
      if (ch.id === room102.id && p === 2) continue; // Reserved for mahmud.rahman (booked appt)
      if (ch.id === room707.id && p === 1) continue; // Reserved for shamima.sultana (Mon/Wed 18:00-20:30)
      freeSlots.push({ chamber: ch, sched: SCHEDULE_PATTERNS[p] });
    }
  }

  const allDoctors = await prisma.doctorProfile.findMany({
    include: { user: true },
    orderBy: { id: 'asc' },
  });

  // Remove unbooked appointment slots, detach booked slots from old templates, then reset weekly rules
  await prisma.appointmentSlot.deleteMany({
    where: { appointments: { none: {} } },
  });
  await prisma.appointmentSlot.updateMany({
    where: { templateId: { not: null } },
    data: { templateId: null },
  });
  await prisma.weeklyAvailability.deleteMany({});

  let freeCursor = 0;
  for (const doc of allDoctors) {
    const uname = doc.user.username.toLowerCase();
    let targetChamber = room102;
    let targetDays = [6, 1, 3];
    let targetStart = '09:30';
    let targetEnd = '13:30';
    let targetDur = 240;
    let targetDaysStr = '6,1,3';

    if (uname === 'mahmud.rahman') {
      targetChamber = room102;
    } else if (uname === 'shamima.sultana') {
      targetChamber = room707;
      targetDays = [0, 2];
      targetStart = '18:00';
      targetEnd = '20:30';
      targetDur = 150;
      targetDaysStr = '0,2';
    } else {
      const slot = freeSlots[freeCursor++];
      if (!slot) throw new Error('Insufficient conflict-free room slots for doctors.');
      targetChamber = slot.chamber;
      targetDays = slot.sched.days;
      targetStart = slot.sched.start;
      targetEnd = slot.sched.end;
      targetDur = slot.sched.dur;
      targetDaysStr = slot.sched.daysStr;
    }

    const updatedDoc = await prisma.doctorProfile.update({
      where: { id: doc.id },
      data: {
        chamberId: targetChamber.id,
        roomNumber: targetChamber.roomNumber,
        chamberAddress: targetChamber.address,
        chamberDays: targetDaysStr,
      },
    });

    const startTime = parseTimeStr(targetStart)!;
    const endTime = parseTimeStr(targetEnd)!;

    await assertNoRoomWeeklyConflict(prisma, {
      chamberId: targetChamber.id,
      excludeDoctorId: doc.id,
      rules: targetDays.map((weekday) => ({ weekday, startTime, endTime })),
    });

    for (const weekday of targetDays) {
      await prisma.weeklyAvailability.create({
        data: {
          doctorId: doc.id,
          weekday,
          startTime,
          endTime,
          durationMinutes: targetDur,
          capacity: doc.maxPatientsPerSession,
          active: true,
        },
      });
    }

    await materializeWeekly(updatedDoc, 60);
  }

  console.log(`[sync] Verified 0 room conflicts and materialized slots across ${allDoctors.length} doctors.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  syncLiveDatabase()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('[sync] failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
