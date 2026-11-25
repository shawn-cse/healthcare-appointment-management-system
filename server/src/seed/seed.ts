import { fileURLToPath } from 'node:url';
import { ensureDatabaseSchema, prisma } from '../config/db.js';
import { materializeWeekly } from '../services/appointments.js';
import { parseIsoDate, parseTimeStr } from '../utils/dateTime.js';
import { hashPassword } from '../utils/password.js';

const DEPARTMENTS: Array<[string, string]> = [
  ['Cardiology', 'Heart and cardiovascular care'],
  ['Neurology', 'Brain, spinal cord and nervous system care'],
  ['Orthopedics', 'Bone, joint and musculoskeletal care'],
  ['Gastroenterology', 'Digestive system and liver care'],
  ['Dermatology', 'Skin, hair and nail care'],
  ['Pediatrics', 'Healthcare for infants, children and adolescents'],
  ['Gynecology and Obstetrics', 'Women’s health, pregnancy and maternity care'],
  ['ENT', 'Ear, nose and throat care'],
  ['Endocrinology', 'Hormonal and metabolic health'],
  ['General Medicine', 'Internal medicine and primary consultation'],
];

const MEN: Array<[string, string]> = [
  ['Karim', 'Hassan'], ['Mahmud', 'Rahman'], ['Tanvir', 'Ahmed'],
  ['Rafiq', 'Islam'], ['Anis', 'Chowdhury'], ['Nayeem', 'Khan'],
  ['Fahim', 'Kabir'], ['Imran', 'Hossain'], ['Sabbir', 'Mahmud'],
  ['Farhan', 'Siddique'], ['Shafiqul', 'Alam'], ['Arif', 'Miah'],
  ['Faisal', 'Haque'], ['Rashed', 'Uddin'], ['Iftikhar', 'Sarker'],
  ['Shahid', 'Iqbal'], ['Raihan', 'Azad'], ['Aminul', 'Bari'],
  ['Zahid', 'Hasan'], ['Ashraf', 'Kamal'], ['Nabil', 'Sultan'],
  ['Saif', 'Noman'], ['Tariq', 'Rashid'], ['Adnan', 'Faruq'],
  ['Moin', 'Akter'], ['Jubayer', 'Hasib'], ['Arafat', 'Haque'],
  ['Shihab', 'Nasir'], ['Alif', 'Chowdhury'], ['Shuvo', 'Ahmed'],
];

const WOMEN: Array<[string, string]> = [
  ['Nusrat', 'Jahan'], ['Samira', 'Rahman'], ['Farzana', 'Islam'], ['Nadia', 'Khan'],
  ['Tasnim', 'Akter'], ['Maliha', 'Hasan'], ['Rumana', 'Haque'], ['Sadia', 'Anjum'],
  ['Nafisa', 'Chowdhury'], ['Tanjina', 'Sultana'], ['Ayesha', 'Nawrin'], ['Ishrat', 'Ferdous'],
  ['Mehjabin', 'Alam'], ['Rabeya', 'Khatun'], ['Mariam', 'Begum'], ['Sharmin', 'Sarker'],
  ['Jannatul', 'Fariha'], ['Tahmina', 'Rahman'], ['Rima', 'Hossain'], ['Sabrina', 'Afroz'],
];

interface CredSpec {
  qual: string;
  desig: string;
  bmdc: string;
  exp: number;
  title: string;
}

const CREDENTIALS: Record<number, CredSpec[]> = {
  0: [
    { qual: 'MBBS, FCPS (Medicine), MD (Cardiology), FACC (USA)\nSpecial Training in Interventional Cardiology & Angioplasty\nSenior Interventional Cardiologist', desig: 'Professor & Head of Department, Cardiology', bmdc: 'BMDC Reg: A-21940', exp: 22, title: 'Prof. Dr.' },
    { qual: 'MBBS, D-Card (BSMMU), FCPS (Cardiology)\nSpecialist in Clinical & Preventive Cardiology, Echocardiography\nAdult Cardiovascular Specialist', desig: 'Associate Professor, Cardiology', bmdc: 'BMDC Reg: A-31852', exp: 16, title: 'Dr.' },
    { qual: 'MBBS, MD (Cardiology), MRCP (UK)\nSpecial Training in Cardiac Arrhythmia & Heart Failure\nConsultant Clinical Cardiologist', desig: 'Assistant Professor, Cardiology', bmdc: 'BMDC Reg: A-42109', exp: 11, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Cardiology), Fellow Non-Invasive Cardiology (NHF)\nSpecialist in Hypertension, Heart Failure & 2D/3D Echo\nSenior Consultant Cardiologist', desig: 'Associate Professor, Cardiology', bmdc: 'BMDC Reg: A-28941', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, MD (Cardiology)\nSpecialist in Coronary Care & Clinical Cardiology\nCardiovascular Disease Consultant', desig: 'Assistant Professor, Cardiology', bmdc: 'BMDC Reg: A-49301', exp: 9, title: 'Dr.' },
  ],
  1: [
    { qual: 'MBBS, FCPS (Medicine), MD (Neurology), FINR (Switzerland)\nSpecial Training in Stroke Management & Interventional Neurology\nNeurology & Stroke Specialist', desig: 'Professor & Head of Department, Neurology', bmdc: 'BMDC Reg: A-20184', exp: 20, title: 'Prof. Dr.' },
    { qual: 'MBBS, MS (Neurosurgery), Fellow Skull Base Surgery\nBrain, Spine & Micro-Neurosurgery Specialist\nSenior Neurosurgeon', desig: 'Associate Professor, Neurosurgery', bmdc: 'BMDC Reg: A-33451', exp: 15, title: 'Dr.' },
    { qual: "MBBS, MD (Neurology), Fellow Clinical Neurophysiology\nSpecialist in Epilepsy, Parkinson's & Neuropathy\nConsultant Neurologist", desig: 'Associate Professor, Neurology', bmdc: 'BMDC Reg: A-39820', exp: 12, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Neurology), Fellow Stroke Rehabilitation\nSpecialist in Headache, Neuromuscular & Neuro-Critical Care\nSenior Consultant Neurologist', desig: 'Associate Professor, Neurology', bmdc: 'BMDC Reg: A-35129', exp: 14, title: 'Dr.' },
    { qual: 'MBBS, MS (Neurosurgery), AO Spine Fellow\nMinimally Invasive Spine & Brain Surgeon\nConsultant Neurosurgeon', desig: 'Assistant Professor, Neurosurgery', bmdc: 'BMDC Reg: A-46781', exp: 8, title: 'Dr.' },
  ],
  2: [
    { qual: 'MBBS, MS (Orthopedics), D-Ortho (NITOR)\nSpecial Training in Arthroscopy & Total Knee/Hip Replacement\nSenior Joint Reconstruction Surgeon', desig: 'Professor & Chief Orthopedic Surgeon', bmdc: 'BMDC Reg: A-19842', exp: 24, title: 'Prof. Dr.' },
    { qual: 'MBBS, FCPS (Orthopedic Surgery), AO Trauma Fellow (Germany)\nComplex Trauma, Pelvic Fracture & Deformity Correction Specialist\nTrauma & Orthopedic Surgeon', desig: 'Associate Professor, Orthopedics', bmdc: 'BMDC Reg: A-30219', exp: 16, title: 'Dr.' },
    { qual: 'MBBS, MS (Ortho), Fellow Pediatric Orthopedics\nSpine Surgery & Sports Medicine Specialist\nConsultant Orthopedic Surgeon', desig: 'Associate Professor, Orthopedics', bmdc: 'BMDC Reg: A-37650', exp: 13, title: 'Dr.' },
    { qual: 'MBBS, D-Ortho, FCPS (Ortho Surgery)\nArthroscopic Surgery & Musculoskeletal Trauma Specialist\nSenior Consultant Orthopedic Surgeon', desig: 'Associate Professor, Orthopedic Surgery', bmdc: 'BMDC Reg: A-32890', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, MS (Orthopedics)\nJoint Pain, Osteoarthritis & Fracture Care Specialist\nConsultant Orthopedic Surgeon', desig: 'Assistant Professor, Orthopedics', bmdc: 'BMDC Reg: A-44120', exp: 9, title: 'Dr.' },
  ],
  3: [
    { qual: 'MBBS, FCPS (Medicine), MD (Gastroenterology), FACG (USA)\nSpecial Training in Therapeutic Endoscopy, Colonoscopy & ERCP\nSenior Gastroenterologist & Hepatologist', desig: 'Professor & Head of Department, Gastroenterology', bmdc: 'BMDC Reg: A-21094', exp: 21, title: 'Prof. Dr.' },
    { qual: 'MBBS, MD (Hepatology), Fellow Liver Disease & Transplant\nSpecialist in Hepatitis, Fatty Liver & Liver Cirrhosis\nAssociate Professor of Hepatology', desig: 'Associate Professor, Hepatology', bmdc: 'BMDC Reg: A-32810', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Gastroenterology), MRCP (UK)\nSpecialist in IBD, Acid Peptic Disorders & GI Bleeding\nConsultant Gastroenterologist', desig: 'Associate Professor, Gastroenterology', bmdc: 'BMDC Reg: A-38491', exp: 12, title: 'Dr.' },
    { qual: 'MBBS, MD (Gastroenterology), Fellow Interventional GI Endoscopy\nGI Stenting, Polypectomy & Capsule Endoscopy Specialist\nSenior Consultant Gastroenterologist', desig: 'Associate Professor, Gastroenterology', bmdc: 'BMDC Reg: A-33120', exp: 14, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Medicine), MD (Hepatology)\nClinical Hepatologist & Digestive Health Specialist\nAssistant Professor, Gastroenterology', desig: 'Assistant Professor, Gastroenterology', bmdc: 'BMDC Reg: A-47209', exp: 8, title: 'Dr.' },
  ],
  4: [
    { qual: 'MBBS, DDV (BSMMU), FCPS (Dermatology & Venereology)\nSpecial Training in Dermatosurgery, Hair Transplant & Cutaneous Laser\nSenior Clinical Dermatologist', desig: 'Professor & Head of Department, Dermatology', bmdc: 'BMDC Reg: A-22419', exp: 20, title: 'Prof. Dr.' },
    { qual: 'MBBS, DVD, MD (Dermatology), Fellow Aesthetic Medicine\nSpecialist in Psoriasis, Eczema & Laser Skin Procedures\nAssociate Professor, Dermatology', desig: 'Associate Professor, Dermatology', bmdc: 'BMDC Reg: A-31802', exp: 14, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Dermatology), Fellow Dermatopathology\nClinical Dermatologist, Allergy & Nail-Hair Disease Specialist\nConsultant Dermatologist', desig: 'Associate Professor, Dermatology', bmdc: 'BMDC Reg: A-37419', exp: 11, title: 'Dr.' },
    { qual: 'MBBS, DDV, Fellow Cosmetic Dermatology (Thailand)\nSpecialist in Acne, Melasma, Scar Treatment & Chemical Peel\nSenior Consultant Dermatologist', desig: 'Associate Professor, Dermatology', bmdc: 'BMDC Reg: A-33980', exp: 13, title: 'Dr.' },
    { qual: 'MBBS, MD (Dermatology & Venereology)\nGeneral Dermatology, Skin Allergy & Infection Specialist\nAssistant Professor, Dermatology', desig: 'Assistant Professor, Dermatology', bmdc: 'BMDC Reg: A-48190', exp: 7, title: 'Dr.' },
  ],
  5: [
    { qual: 'MBBS, DCH, FCPS (Pediatrics), MD (Child Health)\nSpecial Training in Neonatal & Pediatric Intensive Care (NICU/PICU)\nSenior Child Specialist & Neonatologist', desig: 'Professor & Head of Department, Pediatrics', bmdc: 'BMDC Reg: A-23450', exp: 23, title: 'Prof. Dr.' },
    { qual: 'MBBS, FCPS (Pediatrics), MRCPCH (UK)\nSpecialist in Pediatric Pulmonology, Childhood Asthma & Allergy\nAssociate Professor, Child Health', desig: 'Associate Professor, Pediatrics', bmdc: 'BMDC Reg: A-31209', exp: 16, title: 'Dr.' },
    { qual: 'MBBS, MD (Pediatrics), Fellow Pediatric Cardiology\nChild Nutrition, Growth & Developmental Assessment Specialist\nConsultant Pediatrician', desig: 'Associate Professor, Pediatrics', bmdc: 'BMDC Reg: A-38910', exp: 12, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Pediatrics), Fellow Neonatology\nSpecialist in Newborn Care & Adolescent Medicine\nSenior Consultant Pediatrician', desig: 'Associate Professor, Pediatrics', bmdc: 'BMDC Reg: A-29401', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, DCH (BSMMU), FCPS (Pediatrics)\nGeneral Pediatrics, Immunization & Child Infection Specialist\nAssistant Professor, Pediatrics', desig: 'Assistant Professor, Pediatrics', bmdc: 'BMDC Reg: A-47890', exp: 8, title: 'Dr.' },
  ],
  6: [
    { qual: 'MBBS, FCPS(Gynaecological Oncology), FCPS(Gynae & Obs)\nSpecial Training in Colposcopy & Advanced Gynae Laparoscopy\nNational Institute of Cancer Research & Hospital(NICRH)\nGynaecological Oncology Specialist & Surgeon', desig: 'Professor & Head of Department, Gynaecological Oncology', bmdc: 'BMDC Reg: A-18492', exp: 25, title: 'Prof. Dr.' },
    { qual: 'MBBS, MS (Gynae & Obs), Fellow Maternal Fetal Medicine\nHigh-Risk Pregnancy, Infertility & Laparoscopic Gynae Surgeon\nSenior Obstetrician & Gynaecologist', desig: 'Professor, Obstetrics & Gynaecology', bmdc: 'BMDC Reg: A-25109', exp: 19, title: 'Prof. Dr.' },
    { qual: 'MBBS, FCPS (Gynae & Obs), Fellow Infertility & IVF\nReproductive Endocrinology, PCOS & Infertility Specialist\nAssociate Professor, Gynae & Obs', desig: 'Associate Professor, Gynae & Obs', bmdc: 'BMDC Reg: A-34821', exp: 14, title: 'Dr.' },
    { qual: 'MBBS, DGO, FCPS (Gynae & Obs)\nPelvic Reconstructive Surgery & Hysteroscopy Specialist\nSenior Consultant Obstetrician & Gynaecologist', desig: 'Associate Professor, Gynae & Obs', bmdc: 'BMDC Reg: A-29840', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, MS (Obstetrics & Gynaecology)\nNormal Delivery, Antenatal Care & Adolescent Gynaecology Specialist\nConsultant Obstetrician & Gynaecologist', desig: 'Assistant Professor, Gynae & Obs', bmdc: 'BMDC Reg: A-46109', exp: 9, title: 'Dr.' },
  ],
  7: [
    { qual: 'MBBS, DLO (BSMMU), FCPS (ENT)\nSpecial Training in Microear Surgery & Head Neck Surgery\nENT Specialist & Head Neck Surgeon', desig: 'Professor & Head of Department, ENT & Head Neck Surgery', bmdc: 'BMDC Reg: A-20194', exp: 22, title: 'Prof. Dr.' },
    { qual: 'MBBS, MS (ENT), Fellow Endoscopic Sinus Surgery (India)\nFunctional Endoscopic Sinus Surgery (FESS) & Rhinoplasty Specialist\nSenior ENT Surgeon', desig: 'Associate Professor, ENT', bmdc: 'BMDC Reg: A-32981', exp: 16, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Otolaryngology), FICS (USA)\nMicro-laryngeal Surgery, Snoring & Sleep Apnea Specialist\nConsultant Otolaryngologist', desig: 'Associate Professor, ENT', bmdc: 'BMDC Reg: A-39120', exp: 13, title: 'Dr.' },
    { qual: 'MBBS, DLO, FCPS (ENT), Fellow Otology\nEar Microsurgery, Tympanoplasty & Hearing Loss Specialist\nSenior Consultant, ENT', desig: 'Associate Professor, ENT', bmdc: 'BMDC Reg: A-34091', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, MS (Otolaryngology)\nHead & Neck Tumor, Thyroid & Salivary Gland Surgeon\nConsultant ENT Surgeon', desig: 'Assistant Professor, ENT', bmdc: 'BMDC Reg: A-45210', exp: 8, title: 'Dr.' },
  ],
  8: [
    { qual: 'MBBS, FCPS (Medicine), MD (Endocrinology), FACE (USA)\nSpecial Training in Diabetes, Thyroid Disorders & Hormone Metabolism\nSenior Diabetologist & Endocrinologist', desig: 'Professor & Head of Department, Endocrinology', bmdc: 'BMDC Reg: A-21450', exp: 21, title: 'Prof. Dr.' },
    { qual: 'MBBS, MD (Endocrinology & Metabolism), Fellow Diabetes (UK)\nSpecialist in Gestational Diabetes, Obesity & Pituitary Disorders\nAssociate Professor, Endocrinology', desig: 'Associate Professor, Endocrinology', bmdc: 'BMDC Reg: A-32109', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Medicine), DEM (BSMMU)\nDiabetes, Thyroid & Metabolic Bone Disease Specialist\nConsultant Endocrinologist', desig: 'Associate Professor, Endocrinology', bmdc: 'BMDC Reg: A-38901', exp: 12, title: 'Dr.' },
    { qual: 'MBBS, MD (Endocrinology), Fellow Pediatric Endocrinology\nGrowth Failure, Pubertal Disorders & Adrenal Specialist\nSenior Consultant Endocrinologist', desig: 'Associate Professor, Endocrinology', bmdc: 'BMDC Reg: A-33410', exp: 14, title: 'Dr.' },
    { qual: 'MBBS, DEM, FCPS (Medicine)\nClinical Diabetologist & Endocrine Specialist\nAssistant Professor, Endocrinology', desig: 'Assistant Professor, Endocrinology', bmdc: 'BMDC Reg: A-47120', exp: 8, title: 'Dr.' },
  ],
  9: [
    { qual: 'MBBS, FCPS (Internal Medicine), FRCP (Glasgow), FACP (USA)\nSpecial Training in Complex Diagnostic Medicine, Multi-organ Diseases\nSenior Consultant Physician', desig: 'Professor & Head of Department, Internal Medicine', bmdc: 'BMDC Reg: A-19410', exp: 25, title: 'Prof. Dr.' },
    { qual: 'MBBS, MD (Internal Medicine), Fellow Infectious Diseases\nSpecialist in Adult Infectious Diseases, Fever & Tropical Medicine\nAssociate Professor, Internal Medicine', desig: 'Associate Professor, Medicine', bmdc: 'BMDC Reg: A-30891', exp: 16, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Medicine), MRCP (UK)\nSpecialist in Hypertension, Geriatric Care & Rheumatology\nConsultant Physician', desig: 'Associate Professor, Internal Medicine', bmdc: 'BMDC Reg: A-37420', exp: 13, title: 'Dr.' },
    { qual: 'MBBS, MD (Medicine), Fellow Critical Care Medicine\nAdult Acute Care, Respiratory & Sepsis Specialist\nSenior Consultant Physician', desig: 'Associate Professor, Internal Medicine', bmdc: 'BMDC Reg: A-32190', exp: 15, title: 'Dr.' },
    { qual: 'MBBS, FCPS (Internal Medicine)\nGeneral Medical Care, Diabetes & Lifestyle Disease Specialist\nAssistant Professor, Internal Medicine', desig: 'Assistant Professor, Internal Medicine', bmdc: 'BMDC Reg: A-45890', exp: 8, title: 'Dr.' },
  ],
};

const SCHEDULE_PATTERNS = [
  { days: [5, 0, 2], start: '09:00', end: '13:00', dur: 240, daysStr: '5,0,2' },
  { days: [6, 1, 3], start: '09:30', end: '13:30', dur: 240, daysStr: '6,1,3' },
  { days: [5, 6, 1, 3], start: '17:00', end: '21:00', dur: 240, daysStr: '5,6,1,3' },
  { days: [6, 0, 2, 3], start: '14:00', end: '18:00', dur: 240, daysStr: '6,0,2,3' },
  { days: [5, 6, 0, 1, 2], start: '17:30', end: '21:30', dur: 240, daysStr: '5,6,0,1,2' },
  { days: [5, 6, 0, 1, 2], start: '10:00', end: '14:00', dur: 240, daysStr: '5,6,0,1,2' },
  { days: [0, 2], start: '18:00', end: '20:30', dur: 150, daysStr: '0,2' },
  { days: [5, 6, 0, 1, 2, 3], start: '10:00', end: '13:30', dur: 210, daysStr: '5,6,0,1,2,3' },
];

const CHAMBER_SPECS: Array<[string, string, string]> = [
  ['', 'Room 101', 'Ground Floor, Outpatient Wing'],
  ['', 'Room 102', 'Ground Floor, Diagnostic OPD'],
  ['', 'Room 201', '2nd Floor, Cardiology & Chest'],
  ['', 'Room 302', '3rd Floor, Specialist Clinic'],
  ['', 'Room 405', '4th Floor, Surgery Suite'],
  ['', 'Room 707', '7th Floor, Oncology & Women Care'],
  ['', 'Room 105', '1st Floor, Internal Medicine'],
  ['', 'Room 202', '2nd Floor, Pediatrics & Child Care'],
  ['', 'Room 303', '3rd Floor, Neurology & Brain Care'],
  ['', 'Room 401', '4th Floor, Diabetes & Endocrine'],
  ['', 'Room 202', '2nd Floor, Special Consultation'],
  ['', 'Room 305', '3rd Floor, ENT & Head-Neck'],
  ['', 'Room 402', '4th Floor, Dermatology Care'],
  ['', 'Room 501', '5th Floor, Executive Lounge'],
];

const RECEPTIONISTS: Array<[string, string]> = [
  ['Shirin', 'Akter'],
  ['Masud', 'Rana'],
  ['Lubna', 'Yasmin'],
  ['Abir', 'Hossain'],
  ['Sumaiya', 'Islam'],
];

const PATIENTS: Array<[string, string]> = [
  ['Amin', 'Hossain'],
  ['Joya', 'Rahman'],
  ['Rifat', 'Hasan'],
  ['Mim', 'Akter'],
  ['Arman', 'Kabir'],
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function seedDatabase(): Promise<void> {
  // Always ensure HospitalPolicy id=1 exists
  await prisma.hospitalPolicy.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  // If doctors already exist (e.g. existing live database), do not overwrite existing live records!
  const existingDoctorCount = await prisma.doctorProfile.count();
  if (existingDoctorCount > 0) {
    console.log(
      `[seed] Existing database detected (${existingDoctorCount} doctors); skipping starter overwrite.`
    );
    return;
  }

  const defaultPasswordHash = await hashPassword('abc123');

  // Admin
  const existingAdmin = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        username: 'admin',
        firstName: 'Hospital',
        lastName: 'Administrator',
        role: 'admin',
        isStaff: true,
        isSuperuser: true,
        email: 'admin@greenhospital.local',
        phone: '01900000000',
        password: defaultPasswordHash,
      },
    });
  }

  // Departments
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

  // Receptionists
  const receps = [];
  for (let i = 0; i < RECEPTIONISTS.length; i++) {
    const [first, last] = RECEPTIONISTS[i];
    const username = first.toLowerCase();
    let u = await prisma.user.findUnique({ where: { username } });
    if (!u) {
      u = await prisma.user.create({
        data: {
          username,
          firstName: first,
          lastName: last,
          role: 'receptionist',
          email: `${username}.reception@gmail.com`,
          phone: `01700004${String(i + 1).padStart(3, '0')}`,
          dob: parseIsoDate(`${1996 + i}-04-15`),
          password: defaultPasswordHash,
        },
      });
    }
    receps.push(u);
  }

  // Patients
  for (let i = 0; i < PATIENTS.length; i++) {
    const [first, last] = PATIENTS[i];
    const phone = `01600005${String(i + 1).padStart(3, '0')}`;
    const username = `patient${i + 1}`;
    const email = `patient.${first.toLowerCase()}${i + 1}@gmail.com`;
    const existing = await prisma.user.findFirst({ where: { role: 'patient', phone } });
    if (!existing) {
      const byUser = await prisma.user.findUnique({ where: { username } });
      if (!byUser) {
        await prisma.user.create({
          data: {
            username,
            firstName: first,
            lastName: last,
            role: 'patient',
            phone,
            email,
            dob: parseIsoDate(`${1995 + i}-06-10`),
            password: defaultPasswordHash,
          },
        });
      }
    }
  }

  // Chambers
  const chambers = [];
  for (const [bld, rm, desc] of CHAMBER_SPECS) {
    let ch = await prisma.chamber.findFirst({
      where: { roomNumber: rm, description: desc },
    });
    if (!ch) {
      ch = await prisma.chamber.findFirst({
        where: { roomNumber: rm },
      });
    }
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
    }
    chambers.push(ch);
  }

  // 50 Doctors (5 per department)
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
          : `${first}_${last}`.toLowerCase().replace(/\s+/g, '_');
      const phone = `018${String(group).padStart(2, '0')}${String(j + 1).padStart(6, '0')}`;

      let u = await prisma.user.findUnique({ where: { username } });
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
        });
      }

      const credList = CREDENTIALS[group] || [];
      const cred = credList[Math.min(j, credList.length - 1)];
      const qual = cred?.qual || 'MBBS, FCPS';
      const desig = cred?.desig || 'Consultant';
      const bmdc = cred?.bmdc || `BMDC Reg: A-${32000 + group * 100 + j}`;
      const exp = cred?.exp ?? 5 + ((group + j) % 17);
      const title = cred?.title || 'Dr.';

      let initFee = 1000;
      let folFee = 700;
      let folDays = 30;
      let repFee = 300;
      let maxCap = 25;

      if (desig.includes('Professor & Head') || desig.includes('Chief') || exp >= 22) {
        initFee = (group + j) % 2 === 0 ? 1800 : 1500;
        folFee = initFee === 1800 ? 1200 : 1000;
        folDays = (group + j) % 2 === 0 ? 45 : 60;
        repFee = 600;
        maxCap = 35;
      } else if (desig.includes('Professor') || exp >= 16) {
        initFee = (group + j) % 2 === 0 ? 1500 : 1200;
        folFee = initFee === 1500 ? 1000 : 800;
        folDays = (group + j) % 2 === 0 ? 30 : 45;
        repFee = 500;
        maxCap = 30;
      } else if (desig.includes('Associate') || exp >= 12) {
        initFee = (group + j) % 2 === 0 ? 1200 : 1000;
        folFee = initFee === 1200 ? 800 : 700;
        folDays = 30;
        repFee = 400;
        maxCap = 30;
      } else {
        initFee = (group + j) % 2 === 0 ? 1000 : 800;
        folFee = initFee === 1000 ? 700 : 500;
        folDays = 30;
        repFee = 300;
        maxCap = 25;
      }

      const assignedChamber = chambers[(group * 2 + j) % chambers.length];
      const sched = SCHEDULE_PATTERNS[(group * 3 + j) % SCHEDULE_PATTERNS.length];

      const doc = await prisma.doctorProfile.create({
        data: {
          userId: u.id,
          departmentId: dep.id,
          chamberId: assignedChamber.id,
          chamberDays: sched.daysStr,
          gender,
          qualifications: qual,
          designation: desig,
          registrationNumber: bmdc,
          experienceYears: exp,
          titlePrefix: title,
          roomNumber: assignedChamber.roomNumber,
          chamberAddress: assignedChamber.address,
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

      for (const w of sched.days) {
        await prisma.weeklyAvailability.create({
          data: {
            doctorId: doc.id,
            weekday: w,
            startTime: parseTimeStr(sched.start)!,
            endTime: parseTimeStr(sched.end)!,
            durationMinutes: sched.dur,
            capacity: maxCap,
            active: true,
          },
        });
      }

      await materializeWeekly(doc, 60);
    }
  }

  // Reference Doctor: Prof. Dr. Chowdhury Shamima Sultana
  const gynaeDep =
    departments.find((d) => d.slug.includes('gynecology') || d.slug.includes('gynae')) ||
    departments[6];
  const shamimaUser = await prisma.user.create({
    data: {
      username: 'shamima_sultana',
      firstName: 'Chowdhury Shamima',
      lastName: 'Sultana',
      role: 'doctor',
      email: 'shamima.sultana@greenhospital.local',
      phone: '01899990707',
      dob: parseIsoDate('1975-05-20'),
      password: defaultPasswordHash,
    },
  });
  const room707 = chambers.find((c) => c.roomNumber === 'Room 707') || chambers[5];
  const shamimaProf = await prisma.doctorProfile.create({
    data: {
      userId: shamimaUser.id,
      departmentId: gynaeDep.id,
      chamberId: room707.id,
      chamberDays: '0,2',
      titlePrefix: 'Prof. Dr.',
      qualifications:
        'MBBS, FCPS(Gynaecological Oncology), FCPS(Gynae & Obs)\n' +
        'National Institute of Cancer Research & Hospital(NICRH)\n' +
        'Special Training in Gynecological Cancer Surgery & Laparoscopic Oncology',
      designation: 'Professor & Consultant',
      institute: 'National Institute of Cancer Research & Hospital(NICRH)',
      registrationNumber: 'A-22841',
      gender: 'female',
      maxPatientsPerSession: 35,
      roomNumber: 'Room 707',
      chamberAddress: 'Mirpur, Dhaka',
      contactNumber: '+88096100016211',
      initialFee: 1500,
      followupFee: 1000,
      followupWithinDays: 45,
      reportFee: 600,
    },
  });

  for (const r of receps) {
    await prisma.doctorReceptionist.create({
      data: { doctorProfileId: shamimaProf.id, userId: r.id },
    });
  }

  for (const wd of [0, 2]) {
    await prisma.weeklyAvailability.create({
      data: {
        doctorId: shamimaProf.id,
        weekday: wd,
        startTime: parseTimeStr('18:00')!,
        endTime: parseTimeStr('20:30')!,
        durationMinutes: 150,
        capacity: 35,
        active: true,
      },
    });
  }
  await materializeWeekly(shamimaProf, 60);

  console.log(
    '[seed] Green Hospital directory ready: 10 departments, 51 doctors, 5 receptionists, 5 patients, 14 chambers.'
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ensureDatabaseSchema()
    .then(() => seedDatabase())
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('[seed] failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
