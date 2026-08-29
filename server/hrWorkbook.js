import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export const HR_IMPORT_SOURCES = ['master', 'payroll', 'insurance', 'recruitment', 'organization'];
export const MAX_HR_WORKBOOK_BYTES = 20 * 1024 * 1024;

const MAX_ROWS_PER_SHEET = 6_000;
const MAX_COLUMNS_PER_SHEET = 90;
const EMPTY_TAIL_ROWS = 100;
const IN_MEMORY_FALLBACK_BYTES = 2 * 1024 * 1024;

export class HRWorkbookError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.name = 'HRWorkbookError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function valueOf(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw !== 'object') return raw;
  if (Object.hasOwn(raw, 'result')) return valueOf(raw.result);
  if (Array.isArray(raw.richText)) return raw.richText.map((part) => part.text ?? '').join('');
  if (Object.hasOwn(raw, 'text')) return raw.text;
  if (Object.hasOwn(raw, 'hyperlink')) return raw.hyperlink;
  // Formula errors and unsupported Excel value wrappers must never leak into
  // the UI as "[object Object]". Their neighbouring raw-data column is used
  // as a fallback by the normalizer below.
  return null;
}

function meaningful(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

async function readSmallWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  return workbook.worksheets.map((worksheet) => {
    const rows = [];
    const lastRow = Math.min(worksheet.rowCount, MAX_ROWS_PER_SHEET);

    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values = Array.from({ length: MAX_COLUMNS_PER_SHEET }, (_, index) =>
        valueOf(row.getCell(index + 1).value)
      );
      if (values.some(meaningful)) rows.push({ number: rowNumber, values });
    }

    return { name: String(worksheet.name || '').trim(), rows };
  });
}

/**
 * Stream instead of materialising the workbook. The payroll workbook has over
 * one million formatted rows but only about ninety business rows; a normal
 * in-memory reader would turn formatting into hundreds of MB of empty cells.
 */
export async function readHRWorkbook(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (!buffer.length) throw new HRWorkbookError('hr_file_empty');
  if (buffer.length > MAX_HR_WORKBOOK_BYTES) {
    throw new HRWorkbookError('hr_file_too_large', 413, { maxBytes: MAX_HR_WORKBOOK_BYTES });
  }

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    entries: 'emit',
    sharedStrings: 'cache',
    styles: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });
  const sheets = [];

  try {
    for await (const worksheet of reader) {
      const rows = [];
      let emptyTail = 0;
      let started = false;

      for await (const row of worksheet) {
        const values = Array.from({ length: MAX_COLUMNS_PER_SHEET }, (_, index) =>
          valueOf(row.getCell(index + 1).value)
        );
        const hasValue = values.some(meaningful);
        if (hasValue) {
          started = true;
          emptyTail = 0;
          rows.push({ number: row.number, values });
        } else if (started) {
          emptyTail += 1;
        }

        if (row.number >= MAX_ROWS_PER_SHEET || (started && emptyTail >= EMPTY_TAIL_ROWS)) break;
      }

      sheets.push({ name: String(worksheet.name || '').trim(), rows });
    }
  } catch (error) {
    // Some valid, compact workbooks write worksheet ZIP entries before their
    // relationship metadata. ExcelJS's streaming reader cannot resolve those
    // files, while its regular reader can. Keep the fallback deliberately
    // small so large, heavily formatted payroll files remain memory-safe.
    if (buffer.length <= IN_MEMORY_FALLBACK_BYTES) {
      try {
        const fallbackSheets = await readSmallWorkbook(buffer);
        if (fallbackSheets.length) return fallbackSheets;
      } catch {
        // Report the original streaming failure below; it is usually clearer.
      }
    }
    throw new HRWorkbookError('hr_file_unreadable', 400, { message: error?.message ?? String(error) });
  }

  if (!sheets.length) throw new HRWorkbookError('hr_file_unreadable');
  return sheets;
}

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function headerKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[.`'’_\/\\()\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedName(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const text = cleanText(value);
  return text.replace(/\.0$/, '');
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 20_000 && value < 80_000) {
    const milliseconds = Math.round((value - 25_569) * 86_400_000);
    return new Date(milliseconds).toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  if (!text) return null;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function asTime(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // ExcelJS represents a time-only cell on 1899-12-30. Cairo's historical
    // timezone had a 5-minute component, so Date#toString corrupts :00 into
    // :05. The local hour still reflects the sheet hour; UTC minutes preserve
    // the exact minute stored by Excel.
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const text = cleanText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text;
}

function asStatus(value) {
  const key = headerKey(value);
  if (key === 'active') return 'active';
  if (['in active', 'inactive'].includes(key)) return 'inactive';
  if (key === 'done') return 'done';
  if (key === 'hold') return 'hold';
  if (['wait', 'wiat'].includes(key)) return 'wait';
  return key || 'unknown';
}

function recruitmentRole(value) {
  return cleanText(value)
    .replace(/\bvedio\b/gi, 'Video')
    .replace(/\bteamleader\b/gi, 'Team Leader')
    .replace(/\bspecialit\b|\bspecilaist\b/gi, 'Specialist')
    .replace(/\bengenieer\b/gi, 'Engineer')
    .replace(/\bsoftwear\b/gi, 'Software')
    .replace(/\bpowerpi\b/gi, 'Power BI')
    .replace(/\bpremiavira\b/gi, 'Primavera')
    .replace(/\bbim arche\b/gi, 'BIM Arch');
}

function headerIndex(row) {
  const map = new Map();
  row.values.forEach((value, index) => {
    const key = headerKey(value);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

function findHeader(sheet, groups) {
  return sheet?.rows.find((row) => {
    const keys = new Set(row.values.map(headerKey));
    return groups.every((aliases) => aliases.some((alias) => keys.has(headerKey(alias))));
  }) ?? null;
}

function get(row, map, ...aliases) {
  for (const alias of aliases) {
    const index = map.get(headerKey(alias));
    if (index !== undefined) return row.values[index];
  }
  return null;
}

function getFirstMeaningful(row, map, ...aliases) {
  for (const alias of aliases) {
    const index = map.get(headerKey(alias));
    if (index === undefined) continue;
    const value = row.values[index];
    if (meaningful(value) && String(value).trim() !== '0') return value;
  }
  return null;
}

function asPhone(value) {
  const phone = asId(value).replace(/\s+/g, '');
  return /^1\d{9}$/.test(phone) ? `0${phone}` : phone;
}

function rowsAfter(sheet, header) {
  return sheet.rows.filter((row) => row.number > header.number);
}

function findSheet(sheets, predicate) {
  return sheets.find(predicate) ?? null;
}

function duplicateIds(rows, key) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row[key], (counts.get(row[key]) ?? 0) + 1));
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

export function detectHRSource(sheets) {
  if (sheets.some((sheet) => Boolean(findHeader(sheet, [['Emp ID'], ['Name English'], ['Company Email address']])))) {
    return 'master';
  }
  if (sheets.some((sheet) => Boolean(findHeader(sheet, [['كود'], ['اسم الموظف'], ['الرقم التامينى']])))) {
    return 'insurance';
  }
  if (sheets.some((sheet) => Boolean(findHeader(sheet, [['المعرف'], ['معرف المدير المباشر'], ['المسمى الوظيفي']])))) {
    return 'organization';
  }
  if (
    sheets.some((sheet) =>
      Boolean(findHeader(sheet, [['Number needed'], ['Status'], ['Salary Range']]))
    )
  ) return 'recruitment';
  if (sheets.some((sheet) => Boolean(findHeader(sheet, [['Emp ID'], ['KPI`S CONT'], ['status']])))) {
    return 'payroll';
  }
  throw new HRWorkbookError('hr_source_unknown');
}

function normalizeMaster(sheets) {
  const sheet = findSheet(sheets, (item) =>
    Boolean(findHeader(item, [['Emp ID'], ['Name English'], ['Company Email address']]))
  );
  const header = findHeader(sheet, [['Emp ID'], ['Name English'], ['Employee Status']]);
  if (!sheet || !header) throw new HRWorkbookError('hr_master_layout_invalid');
  const map = headerIndex(header);

  const employees = rowsAfter(sheet, header)
    .map((row) => {
      const employeeCode = asId(get(row, map, 'Emp ID'));
      if (!employeeCode) return null;
      const daysOff = [get(row, map, 'Day off 1'), get(row, map, 'Day off 2')]
        .map(cleanText)
        .filter(Boolean);
      return {
        employeeCode,
        nameEnglish: cleanText(get(row, map, 'Name English')),
        nameArabic: cleanText(get(row, map, 'Name')),
        nameKeyEnglish: normalizedName(get(row, map, 'Name English')),
        nameKeyArabic: normalizedName(get(row, map, 'Name')),
        sector: cleanText(get(row, map, 'Sector')),
        department: cleanText(get(row, map, 'Department')),
        title: cleanText(get(row, map, 'Title')),
        directManager: cleanText(get(row, map, 'Direct Manager')),
        hiringDate: asDate(get(row, map, 'Hiring Date')),
        status: asStatus(get(row, map, 'Employee Status')),
        resignationDate: asDate(get(row, map, 'Resgnation Date', 'Resignation Date')),
        workType: cleanText(get(row, map, 'Work Type')),
        shiftStart: asTime(get(row, map, 'Shift Start')),
        shiftEnd: asTime(get(row, map, 'Shift end')),
        weeklyHours: asNumber(get(row, map, 'Weekly hours')),
        daysOff,
        companyEmail: cleanText(getFirstMeaningful(row, map, 'Company Email address', 'Company Email address Form')).toLowerCase(),
        bankName: cleanText(get(row, map, 'CIB Name')),
        bankStatus: cleanText(get(row, map, 'CIB Status')),
        bankAccount: asId(get(row, map, 'CIB Number')),
        companyPhoneEgypt: asPhone(getFirstMeaningful(row, map, 'company phone number Egypt', 'company phone number Egypt Form')),
        companyPhoneKsa: asPhone(getFirstMeaningful(row, map, 'company phone number KSA', 'company phone number KSA Form')),
        personalEmail: cleanText(getFirstMeaningful(row, map, 'Personal Mail', 'Personal Mail Form')).toLowerCase(),
        mobile: asPhone(getFirstMeaningful(row, map, 'Mobile Number', 'Mobile Number Form')),
        nationalId: asId(getFirstMeaningful(row, map, 'National ID', 'National ID Form')),
        gender: cleanText(get(row, map, 'Gender')),
        birthDate: asDate(get(row, map, 'Birth Date')),
        address: cleanText(get(row, map, 'Address')),
        maritalStatus: cleanText(get(row, map, 'Marital Status')),
        children: asNumber(get(row, map, 'children')),
        nationality: cleanText(get(row, map, 'Nationality')),
        education: cleanText(get(row, map, 'Education')),
        graduationYear: asNumber(get(row, map, 'Graduation Year')),
        religion: cleanText(get(row, map, 'Religion')),
        militaryStatus: cleanText(get(row, map, 'Military Status')),
        socialInsuranceNumber: asId(get(row, map, 'رقم تأميني')),
        documents: {
          id: Boolean(asNumber(get(row, map, 'ID'))),
          photo: Boolean(asNumber(get(row, map, 'Photo'))),
          graduation: Boolean(asNumber(get(row, map, 'Graduation'))),
          military: Boolean(asNumber(get(row, map, 'Military'))),
          workCertificate: Boolean(asNumber(get(row, map, 'كعب عمل'))),
          criminalRecord: Boolean(asNumber(get(row, map, 'Criminal Record'))),
          experienceCertificates: Boolean(asNumber(get(row, map, 'شهادات الخبرة'))),
          birthCertificate: Boolean(asNumber(get(row, map, 'birth'))),
          contract: Boolean(asNumber(get(row, map, 'Contract'))),
          application: Boolean(asNumber(get(row, map, 'Applcation'))),
          cv: Boolean(asNumber(get(row, map, 'CV'))),
          collectionStatus: cleanText(get(row, map, 'Document Collection')),
          completionRate: asNumber(get(row, map, 'Document Rate')),
        },
      };
    })
    .filter(Boolean);

  return {
    payload: { employees },
    summary: {
      rows: employees.length,
      active: employees.filter((employee) => employee.status === 'active').length,
      inactive: employees.filter((employee) => employee.status === 'inactive').length,
    },
    warnings: duplicateIds(employees, 'employeeCode').map((id) => ({ code: 'duplicate_employee_code', id })),
  };
}

function normalizePayroll(sheets) {
  const sheet = findSheet(sheets, (item) => Boolean(findHeader(item, [['Emp ID'], ['KPI`S CONT'], ['status']])));
  const header = findHeader(sheet, [['Emp ID'], ['Name English'], ['status']]);
  if (!sheet || !header) throw new HRWorkbookError('hr_payroll_layout_invalid');
  const map = headerIndex(header);
  const secondHeader = sheet.rows.find((row) => row.number > header.number && row.number <= header.number + 2);
  const detailKeys = secondHeader?.values.map(headerKey) ?? [];
  const totalIndex = detailKeys.findIndex((value) => value === 'total');
  const kpiIndex = detailKeys.findIndex((value) => value.includes('kpi'));
  const baseIndex = totalIndex > 1 ? totalIndex - 2 : Math.max(8, kpiIndex - 1);

  const employees = rowsAfter(sheet, secondHeader ?? header)
    .map((row) => {
      const employeeCode = asId(get(row, map, 'Emp ID'));
      if (!employeeCode) return null;
      return {
        employeeCode,
        sequence: asId(get(row, map, 'NO.')),
        nameEnglish: cleanText(get(row, map, 'Name English')),
        title: cleanText(get(row, map, 'Title')),
        department: cleanText(get(row, map, 'Department')),
        hiringDate: asDate(get(row, map, 'Hiring Date')),
        status: asStatus(get(row, map, 'status')),
        kpiContract: headerKey(get(row, map, 'KPI`S CONT')).startsWith('yes'),
        baseSalary: asNumber(row.values[baseIndex]),
        kpiAmount: asNumber(row.values[kpiIndex]),
        totalSalary: asNumber(row.values[totalIndex]),
      };
    })
    .filter(Boolean);

  return {
    payload: { employees },
    summary: {
      rows: employees.length,
      active: employees.filter((employee) => employee.status === 'active').length,
      totalPayroll: employees.reduce((sum, employee) => sum + (employee.totalSalary ?? 0), 0),
    },
    warnings: duplicateIds(employees, 'employeeCode').map((id) => ({ code: 'duplicate_employee_code', id })),
  };
}

function normalizeInsurance(sheets) {
  const insuranceSheet = findSheet(sheets, (sheet) =>
    Boolean(findHeader(sheet, [['كود'], ['اسم الموظف'], ['الرقم التامينى']]))
  );
  const insuranceHeader = findHeader(insuranceSheet, [['كود'], ['اسم الموظف'], ['الرقم التامينى']]);
  if (!insuranceSheet || !insuranceHeader) throw new HRWorkbookError('hr_insurance_layout_invalid');
  const map = headerIndex(insuranceHeader);

  const insurance = rowsAfter(insuranceSheet, insuranceHeader)
    .map((row) => {
      const employeeCode = asId(get(row, map, 'كود'));
      if (!employeeCode) return null;
      return {
        employeeCode,
        nameArabic: cleanText(get(row, map, 'اسم الموظف')),
        insuredTitle: cleanText(get(row, map, 'المسمي الوظيفي التامينى')),
        title: cleanText(get(row, map, 'الوظيفة')),
        department: cleanText(get(row, map, 'القسم')),
        insuredCompany: cleanText(get(row, map, 'الشركة المؤمن بها')),
        nationalId: asId(get(row, map, 'رقم بطاقة')),
        phone: cleanText(get(row, map, 'رقم الهاتف')),
        hiringDate: asDate(get(row, map, 'تاريخ التعين')),
        insuranceNumber: asId(get(row, map, 'الرقم التامينى')),
        insuranceStartDate: asDate(get(row, map, 'تاريخ دخول التامين')),
        insuranceEndDate: asDate(get(row, map, 'تاريخ انتهاء الاشتراك التاميني')),
        paymentMethod: cleanText(get(row, map, 'الية استلام الراتب')),
        payrollCompany: cleanText(get(row, map, 'شركة تحويل الراتب')),
        insuranceOffice: cleanText(get(row, map, 'مكتب التامينات')),
        actualSalary: asNumber(get(row, map, 'الراتب الفعلي')),
        salaryWithAllowances: asNumber(get(row, map, 'الراتب بالبدلات')),
        insuredSalary: asNumber(get(row, map, 'الراتب التاميني')),
        subscriptionSalary: asNumber(get(row, map, 'اجر الاشتراك التامينى الشهرى')),
        status: cleanText(get(row, map, 'الحاله')),
        employeeShare: asNumber(get(row, map, 'الاشتراك التامينى الشهرى حصة العامل')),
        employerShare: asNumber(get(row, map, 'الاشتراك التامينى الشهرى حصة صاحب العمل')),
        taxBracket: cleanText(get(row, map, 'الشريحة الضريبية')),
        annualTax: asNumber(get(row, map, 'الضريبه السنويه')),
        monthlyTax: asNumber(get(row, map, 'الضريبه الشهريه')),
      };
    })
    .filter(Boolean);

  const taxSheet = findSheet(sheets, (sheet) =>
    Boolean(findHeader(sheet, [['الرقم القومى'], ['الرقم التامينى'], ['الإجمالي']]))
  );
  const taxHeader = findHeader(taxSheet, [['الرقم القومى'], ['الرقم التامينى'], ['الإجمالي']]);
  const tax = taxHeader
    ? rowsAfter(taxSheet, taxHeader)
        .map((row) => {
          const taxMap = headerIndex(taxHeader);
          const nationalId = asId(get(row, taxMap, 'الرقم القومى'));
          if (!nationalId) return null;
          const months = {};
          taxHeader.values.forEach((heading, index) => {
            const key = cleanText(heading);
            if (/2026/.test(key) && !/Q\d/i.test(key)) months[key] = asNumber(row.values[index]);
          });
          return {
            nationalId,
            nameArabic: cleanText(get(row, taxMap, 'الاسم رباعى بالعربى كما في البطاقة')),
            insuranceNumber: asId(get(row, taxMap, 'الرقم التامينى')),
            insuranceJoinDate: asDate(get(row, taxMap, 'تاريخ الالتحاق بالتامينات')),
            months,
            total: asNumber(get(row, taxMap, 'الإجمالي')),
          };
        })
        .filter(Boolean)
    : [];

  return {
    payload: { insurance, tax },
    summary: { rows: insurance.length, taxRows: tax.length, insured: insurance.filter((row) => row.insuranceNumber).length },
    warnings: duplicateIds(insurance, 'employeeCode').map((id) => ({ code: 'duplicate_employee_code', id })),
  };
}

function normalizeRecruitment(sheets) {
  const candidates = sheets
    .map((sheet) => ({
      sheet,
      header: findHeader(sheet, [['Number needed'], ['Status'], ['Salary Range']]),
    }))
    .filter((item) => item.header);
  const selected = candidates.find((item) =>
    item.header.values.some((value) => headerKey(value).includes('accepted numb'))
  ) ?? candidates.at(-1);
  if (!selected) throw new HRWorkbookError('hr_recruitment_layout_invalid');
  const map = headerIndex(selected.header);
  const period = cleanText(selected.sheet.rows.find((row) => row.number < selected.header.number)?.values.find(meaningful))
    || selected.sheet.name;
  const requests = rowsAfter(selected.sheet, selected.header)
    .map((row) => {
      const sequence = asId(get(row, map, 'NO.'));
      const role = recruitmentRole(get(row, map, 'Total'));
      if (!sequence || !role) return null;
      return {
        // Sequence numbers are duplicated in the live workbook (46 and 47).
        // The physical row keeps every request independently editable while
        // `sequence` remains the human-facing report number.
        id: `${period}:${sequence}:${row.number}`,
        sequence,
        role,
        numberNeeded: asNumber(get(row, map, 'Number needed')) ?? 0,
        accepted: asNumber(get(row, map, 'Accepted NUMB.')) ?? 0,
        feedback: cleanText(get(row, map, 'FeedBack')),
        department: cleanText(get(row, map, 'Department')),
        vacancyReason: cleanText(get(row, map, 'Vacancy Reason')),
        status: asStatus(get(row, map, 'Status')),
        priority: headerKey(get(row, map, 'priority')),
        seniority: cleanText(get(row, map, 'Seniority')),
        location: cleanText(get(row, map, 'Location')),
        assignedTo: [get(row, map, 'Assigned to I'), get(row, map, 'Assigned to II')]
          .map(cleanText)
          .filter(Boolean),
        hiringPeriodDays: asNumber(get(row, map, 'Hiring Period')),
        activeDate: asDate(get(row, map, 'Active Date')),
        dueDate: asDate(get(row, map, 'Due date / Time of hire')),
        actualHiringDate: asDate(get(row, map, 'Actual Hiring Date')),
        receivedRequirements: asStatus(get(row, map, 'Received Requirements')),
        published: asStatus(get(row, map, 'Published')),
        receivedCandidates: asStatus(get(row, map, 'Received Candidate')),
        salaryRange: cleanText(get(row, map, 'Salary Range')),
        actualSalary: cleanText(get(row, map, 'Actual Salary')),
        interviewer: cleanText(get(row, map, 'Interviewer')),
        validation: cleanText(get(row, map, 'Validation')),
      };
    })
    .filter(Boolean);
  return {
    payload: { requests, period },
    summary: {
      rows: requests.length,
      open: requests.filter((item) => item.status === 'active').length,
      onHold: requests.filter((item) => item.status === 'hold').length,
      done: requests.filter((item) => item.status === 'done').length,
      needed: requests.reduce((sum, item) => sum + item.numberNeeded, 0),
      accepted: requests.reduce((sum, item) => sum + item.accepted, 0),
    },
    warnings: duplicateIds(requests, 'sequence').map((id) => ({ code: 'duplicate_recruitment_sequence', id })),
  };
}

function normalizeOrganization(sheets) {
  const sheet = findSheet(sheets, (item) =>
    Boolean(findHeader(item, [['المعرف'], ['معرف المدير المباشر'], ['المسمى الوظيفي']]))
  );
  const header = findHeader(sheet, [['المعرف'], ['معرف المدير المباشر'], ['المسمى الوظيفي']]);
  if (!sheet || !header) throw new HRWorkbookError('hr_organization_layout_invalid');
  const map = headerIndex(header);
  const positions = rowsAfter(sheet, header)
    .map((row) => {
      const id = asId(get(row, map, 'المعرف'));
      if (!id) return null;
      const rawEmployeeName = cleanText(get(row, map, 'اسم الموظف'));
      const employeeName = normalizedName(rawEmployeeName) === 'جديد' ? '' : rawEmployeeName;
      return {
        id,
        managerPositionId: asId(get(row, map, 'معرف المدير المباشر')) || null,
        title: cleanText(get(row, map, 'المسمى الوظيفي')),
        employeeName,
        employeeNameKey: normalizedName(employeeName),
        departmentCode: cleanText(get(row, map, 'القسم')),
        color: cleanText(get(row, map, 'لون مخصص (اختياري)')).replace(/^#/, '') || null,
      };
    })
    .filter(Boolean);

  return {
    payload: { positions },
    summary: {
      rows: positions.length,
      filled: positions.filter((position) => position.employeeName).length,
      vacancies: positions.filter((position) => !position.employeeName).length,
    },
    warnings: duplicateIds(positions, 'id').map((id) => ({ code: 'duplicate_position_id', id })),
  };
}

const NORMALIZERS = {
  master: normalizeMaster,
  payroll: normalizePayroll,
  insurance: normalizeInsurance,
  recruitment: normalizeRecruitment,
  organization: normalizeOrganization,
};

export async function parseHRWorkbook(bytes, requestedSource = 'auto') {
  if (requestedSource !== 'auto' && !HR_IMPORT_SOURCES.includes(requestedSource)) {
    throw new HRWorkbookError('hr_source_invalid');
  }
  const sheets = await readHRWorkbook(bytes);
  const detectedSource = detectHRSource(sheets);
  if (requestedSource !== 'auto' && requestedSource !== detectedSource) {
    throw new HRWorkbookError('hr_source_mismatch', 409, { requestedSource, detectedSource });
  }
  const normalized = NORMALIZERS[detectedSource](sheets);
  return {
    source: detectedSource,
    sheetNames: sheets.map((sheet) => sheet.name),
    ...normalized,
  };
}

export const __test = { asDate, asId, asNumber, asStatus, headerKey, normalizedName };
