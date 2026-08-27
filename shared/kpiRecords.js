/**
 * The July 2026 numbers, transcribed from the five approved workbooks so the
 * KPI desk opens on the company's real month rather than on an empty screen.
 *
 * Only cells the workbooks actually carry a measurement in are here. The
 * marketing card records one figure — 110,400 against a 138,000 target — and
 * its other fifteen rows stay unmeasured, because that sheet ships with
 * placeholder zeros and its own footnote calls its figures indicative until
 * management confirms them. Reading those zeros as results would print a
 * failing grade nobody earned. The sales card is an unfilled template, so it
 * seeds as an empty draft ready for its first month.
 *
 * One transcription trap is worth naming: in the recruitment workbook each
 * specialist owns a fixed pair of columns, and the settings sheet leaves a
 * blank row above the names. Reading the names positionally puts one person's
 * numbers on the other person's card, which is why the extractor pairs each
 * name with its own columns explicitly. The two totals here — 100 and 92.97 —
 * match that workbook's own dashboard.
 *
 * The recruitment settings sheet dates itself 2026-05 while all three HR
 * filenames say 7-2026; these are filed under 2026-07 to match the filenames.
 *
 * `seed()` files these once, keyed by template, subject and month, and never
 * overwrites them again — so an edit made in the app is permanent and
 * rebooting never undoes anybody's work.
 */

export const KPI_SEED_PERIOD = '2026-07';

export const KPI_SEED_RECORDS = [
  {
    "templateId": "recruitment_specialist",
    "subjectName": "شاهندة سمير",
    "period": "2026-07",
    "values": {
      "kpi-1-1": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-3": {
        "actual": 48.0,
        "target": null
      },
      "kpi-2-1": {
        "actual": 4.0,
        "target": null
      },
      "kpi-2-2": {
        "actual": 0.4,
        "target": null
      },
      "kpi-2-3": {
        "actual": 0.9,
        "target": null
      },
      "kpi-3-1": {
        "actual": 48.0,
        "target": null
      },
      "kpi-3-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-3-3": {
        "actual": 0.7,
        "target": null
      },
      "kpi-4-1": {
        "actual": 30.0,
        "target": null
      },
      "kpi-4-2": {
        "actual": 0.85,
        "target": null
      },
      "kpi-4-3": {
        "actual": 0.1,
        "target": null
      },
      "kpi-5-1": {
        "actual": 0.8,
        "target": null
      },
      "kpi-5-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-5-3": {
        "actual": 1.0,
        "target": null
      }
    },
    "checks": {
      "chk-1-1": "done",
      "chk-1-2": "done",
      "chk-1-3": "done",
      "chk-1-4": "done",
      "chk-1-5": "done",
      "chk-1-6": "done",
      "chk-2-1": "done",
      "chk-2-2": "done",
      "chk-2-3": "na",
      "chk-2-4": "done",
      "chk-2-5": "done",
      "chk-2-6": "done",
      "chk-3-1": "done",
      "chk-3-2": "done",
      "chk-3-3": "done",
      "chk-3-4": "done",
      "chk-3-5": "done",
      "chk-3-6": "done",
      "chk-4-1": "done",
      "chk-4-2": "done",
      "chk-4-3": "done",
      "chk-4-4": "done",
      "chk-4-5": "done",
      "chk-4-6": "done",
      "chk-5-1": "done",
      "chk-5-2": "done",
      "chk-5-3": "done",
      "chk-5-4": "done",
      "chk-5-5": "done",
      "chk-5-6": "done"
    },
    "incentives": {}
  },
  {
    "templateId": "recruitment_specialist",
    "subjectName": "ياسمين اشرف",
    "period": "2026-07",
    "values": {
      "kpi-1-1": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-3": {
        "actual": 48.0,
        "target": null
      },
      "kpi-2-1": {
        "actual": 5.0,
        "target": null
      },
      "kpi-2-2": {
        "actual": 0.2,
        "target": null
      },
      "kpi-2-3": {
        "actual": 0.9,
        "target": null
      },
      "kpi-3-1": {
        "actual": 48.0,
        "target": null
      },
      "kpi-3-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-3-3": {
        "actual": 0.7,
        "target": null
      },
      "kpi-4-1": {
        "actual": 50.0,
        "target": null
      },
      "kpi-4-2": {
        "actual": 0.85,
        "target": null
      },
      "kpi-4-3": {
        "actual": 0.05,
        "target": null
      },
      "kpi-5-1": {
        "actual": 0.8,
        "target": null
      },
      "kpi-5-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-5-3": {
        "actual": 1.0,
        "target": null
      }
    },
    "checks": {
      "chk-1-1": "done",
      "chk-1-2": "done",
      "chk-1-3": "done",
      "chk-1-4": "done",
      "chk-1-5": "done",
      "chk-1-6": "done",
      "chk-2-1": "done",
      "chk-2-2": "done",
      "chk-2-3": "na",
      "chk-2-4": "done",
      "chk-2-5": "done",
      "chk-2-6": "done",
      "chk-3-1": "done",
      "chk-3-2": "done",
      "chk-3-3": "done",
      "chk-3-4": "done",
      "chk-3-5": "done",
      "chk-3-6": "done",
      "chk-4-1": "done",
      "chk-4-2": "done",
      "chk-4-3": "done",
      "chk-4-4": "done",
      "chk-4-5": "done",
      "chk-4-6": "done",
      "chk-5-1": "done",
      "chk-5-2": "done",
      "chk-5-3": "done",
      "chk-5-4": "done",
      "chk-5-5": "done",
      "chk-5-6": "done"
    },
    "incentives": {}
  },
  {
    "templateId": "personnel_specialist",
    "subjectName": "قسم شئون العاملين",
    "period": "2026-07",
    "values": {
      "kpi-1-1": {
        "actual": 0.8,
        "target": null
      },
      "kpi-1-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-3": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-4": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-5": {
        "actual": 1.0,
        "target": null
      },
      "kpi-1-6": {
        "actual": 1.0,
        "target": null
      },
      "kpi-2-1": {
        "actual": 1.0,
        "target": null
      },
      "kpi-2-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-2-3": {
        "actual": 1.0,
        "target": null
      },
      "kpi-2-4": {
        "actual": 1.0,
        "target": null
      },
      "kpi-2-5": {
        "actual": 1.0,
        "target": null
      },
      "kpi-3-1": {
        "actual": 1.0,
        "target": null
      },
      "kpi-3-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-3-3": {
        "actual": 1.0,
        "target": null
      },
      "kpi-3-4": {
        "actual": 1.0,
        "target": null
      },
      "kpi-3-5": {
        "actual": 1.0,
        "target": null
      },
      "kpi-4-1": {
        "actual": 1.0,
        "target": null
      },
      "kpi-4-2": {
        "actual": 1.0,
        "target": null
      },
      "kpi-4-3": {
        "actual": 1.0,
        "target": null
      },
      "kpi-4-4": {
        "actual": 0.75,
        "target": null
      },
      "kpi-4-5": {
        "actual": 1.0,
        "target": null
      }
    },
    "checks": {
      "chk-1-1": "done",
      "chk-1-2": "done",
      "chk-1-3": "done",
      "chk-1-4": "done",
      "chk-1-5": "done",
      "chk-1-6": "done",
      "chk-1-7": "missed",
      "chk-1-8": "done",
      "chk-1-9": "done",
      "chk-1-10": "done",
      "chk-1-11": "done",
      "chk-1-12": "done",
      "chk-1-13": "done",
      "chk-1-14": "done",
      "chk-1-15": "done",
      "chk-2-1": "done",
      "chk-2-2": "done",
      "chk-2-3": "done",
      "chk-2-4": "done",
      "chk-2-5": "done",
      "chk-2-6": "done",
      "chk-2-7": "done",
      "chk-2-8": "done",
      "chk-2-9": "done",
      "chk-2-10": "done",
      "chk-2-11": "done",
      "chk-2-12": "done",
      "chk-2-13": "done",
      "chk-2-14": "done",
      "chk-2-15": "done",
      "chk-3-1": "done",
      "chk-3-2": "done",
      "chk-3-3": "done",
      "chk-3-4": "done",
      "chk-3-5": "done",
      "chk-3-6": "done",
      "chk-3-7": "done",
      "chk-3-8": "done",
      "chk-3-9": "done",
      "chk-3-10": "done",
      "chk-3-11": "done",
      "chk-3-12": "done",
      "chk-4-1": "done",
      "chk-4-2": "done",
      "chk-4-3": "done",
      "chk-4-4": "done",
      "chk-4-5": "done",
      "chk-4-6": "done",
      "chk-4-7": "done",
      "chk-4-8": "done",
      "chk-4-9": "done",
      "chk-4-10": "done",
      "chk-4-11": "done",
      "chk-4-12": "done"
    },
    "incentives": {}
  },
  {
    "templateId": "hr_manager",
    "subjectName": "مدير الموارد البشرية",
    "period": "2026-07",
    "values": {
      "kpi-1-1": {
        "actual": 5.0,
        "target": null
      },
      "kpi-1-2": {
        "actual": 3.0,
        "target": null
      },
      "kpi-1-3": {
        "actual": 4.0,
        "target": null
      },
      "kpi-1-4": {
        "actual": 5.0,
        "target": null
      },
      "kpi-2-1": {
        "actual": 5.0,
        "target": null
      },
      "kpi-2-2": {
        "actual": 4.0,
        "target": null
      },
      "kpi-2-3": {
        "actual": 5.0,
        "target": null
      },
      "kpi-2-4": {
        "actual": 5.0,
        "target": null
      },
      "kpi-3-1": {
        "actual": 5.0,
        "target": null
      },
      "kpi-3-2": {
        "actual": 5.0,
        "target": null
      },
      "kpi-3-3": {
        "actual": 5.0,
        "target": null
      },
      "kpi-3-4": {
        "actual": 5.0,
        "target": null
      },
      "kpi-4-1": {
        "actual": 5.0,
        "target": null
      },
      "kpi-4-2": {
        "actual": 5.0,
        "target": null
      },
      "kpi-4-3": {
        "actual": 5.0,
        "target": null
      },
      "kpi-4-4": {
        "actual": 5.0,
        "target": null
      },
      "kpi-5-1": {
        "actual": 5.0,
        "target": null
      },
      "kpi-5-2": {
        "actual": 5.0,
        "target": null
      },
      "kpi-5-3": {
        "actual": 5.0,
        "target": null
      },
      "kpi-5-4": {
        "actual": 4.0,
        "target": null
      }
    },
    "checks": {
      "chk-1-1": "done",
      "chk-1-2": "done",
      "chk-1-3": "done",
      "chk-1-4": "done",
      "chk-1-5": "done",
      "chk-1-6": "done",
      "chk-1-7": "done",
      "chk-1-8": "done",
      "chk-2-1": "done",
      "chk-2-2": "done",
      "chk-2-3": "done",
      "chk-2-4": "done",
      "chk-2-5": "done",
      "chk-2-6": "done",
      "chk-2-7": "done",
      "chk-2-8": "done",
      "chk-3-1": "done",
      "chk-3-2": "done",
      "chk-3-3": "done",
      "chk-3-4": "missed",
      "chk-3-5": "done",
      "chk-3-6": "missed",
      "chk-3-7": "done",
      "chk-3-8": "done",
      "chk-4-1": "done",
      "chk-4-2": "missed",
      "chk-4-3": "missed",
      "chk-4-4": "missed",
      "chk-4-5": "missed",
      "chk-4-6": "missed",
      "chk-4-7": "done",
      "chk-4-8": "done",
      "chk-5-1": "done",
      "chk-5-2": "done",
      "chk-5-3": "done",
      "chk-5-4": "done",
      "chk-5-5": "done",
      "chk-5-6": "done",
      "chk-5-7": "done",
      "chk-5-8": "missed"
    },
    "incentives": {}
  },
  {
    "templateId": "marketing_manager",
    "subjectName": "مدير التسويق",
    "period": "2026-07",
    "values": {
      "kpi-1-1": {
        "actual": 110400.0,
        "target": 138000.0
      }
    },
    "checks": {},
    "incentives": {}
  },
  {
    "templateId": "sales_operations_manager",
    "subjectName": "مدير المبيعات والعمليات",
    "period": "2026-07",
    "values": {},
    "checks": {},
    "incentives": {}
  }
];
