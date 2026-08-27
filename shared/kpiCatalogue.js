/**
 * The KPI scorecard catalogue, transcribed from the five approved workbooks:
 * recruitment, people operations, the HR manager, the sales & operations
 * manager, and the marketing manager.
 *
 * Two scorecard families arrive as one shape. The HR workbooks weight each KPI
 * in absolute points that already sum to the axis total, while the two manager
 * cards weight each sub-KPI as a share of its category. `scoreScorecard` reads
 * both the same way, because a group's achievement is always the weighted
 * average of its KPIs and its score is always `group.weight x that average` —
 * which reproduces the points family exactly and reads the percentage family
 * as the weighted average its own sheets call it.
 *
 * Targets, weights and floors are the values the workbooks carried on the day
 * they were approved; the marketing sheet says in its own footnote that its
 * figures are indicative until management confirms them. They are catalogue
 * defaults, and every scorecard stores the target it was actually judged
 * against, so revising this file never rewrites a month that already closed.
 *
 * Axis names carry both languages. The indicator and checklist rows below
 * them are the workbooks' own Arabic wording, kept verbatim because they are
 * what management approved and what an audit would be read against.
 *
 * The scoring engine lives in `kpi.js`. This file is data only.
 */

export const KPI_TEMPLATES = [
  {
    "id": "recruitment_specialist",
    "audience": "employee",
    "department": "hr",
    "subteam": "recruitment",
    "ar": "أخصائي التوظيف",
    "en": "Recruitment specialist",
    "descAr": "خمسة محاور تغطي الطلب والاستقطاب والفرز وسرعة الدورة وإغلاق العروض، والدرجة المعتمدة = الأداء × نسبة تحقق قائمة المراجعة.",
    "descEn": "Five axes covering demand, sourcing, screening, cycle speed and offer closure; the approved score is performance multiplied by the checklist verification rate.",
    "checklistMode": "multiplier",
    "sourceFile": "Recruitment_KPIs 7-2026 All.xlsx",
    "groups": [
      {
        "id": "axis-1",
        "ar": "مؤشرات طلبات واحتياجات التوظيف",
        "en": "Hiring requests & needs",
        "kpis": [
          {
            "id": "kpi-1-1",
            "ar": "اعتماد طلبات التوظيف قبل التشغيل",
            "definition": "نسبة طلبات التوظيف المعتمدة رسميًا قبل بدء النشر.",
            "weight": 7.0,
            "direction": "higher",
            "target": 1.0,
            "unit": "نسبة",
            "source": "HR System / نموذج طلب التوظيف",
            "formula": "(عدد الطلبات المعتمدة ÷ إجمالي طلبات التوظيف) × 100",
            "bands": null
          },
          {
            "id": "kpi-1-2",
            "ar": "اكتمال الوصف الوظيفي ومعايير الفلترة",
            "definition": "نسبة الوظائف التي لها وصف وظيفي ومعايير فرز واضحة.",
            "weight": 8.0,
            "direction": "higher",
            "target": 0.95,
            "unit": "نسبة",
            "source": "Job Description / نموذج الاحتياج",
            "formula": "(الوظائف ذات JD مكتمل ÷ إجمالي الوظائف المفتوحة) × 100",
            "bands": null
          },
          {
            "id": "kpi-1-3",
            "ar": "سرعة بدء تشغيل الطلب",
            "definition": "متوسط الوقت من استلام الطلب المعتمد حتى بدء النشر.",
            "weight": 5.0,
            "direction": "lower",
            "target": 48.0,
            "unit": "ساعة",
            "source": "سجل الطلبات / تاريخ النشر",
            "formula": "إجمالي ساعات بدء التشغيل ÷ عدد طلبات التوظيف",
            "bands": null
          }
        ],
        "weight": 20.0,
        "checklist": [
          {
            "id": "chk-1-1",
            "ar": "وجود اعتماد رسمي لكل طلب توظيف قبل النشر",
            "method": "مطابقة الطلبات مع توقيع / اعتماد المدير المختص",
            "evidence": "نموذج طلب التوظيف المعتمد",
            "sample": "100% من الطلبات",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-1-2",
            "ar": "وجود وصف وظيفي محدّث لكل وظيفة",
            "method": "مراجعة ملف JD وتاريخ آخر تحديث",
            "evidence": "JD / Job Profile",
            "sample": "100% من الوظائف المفتوحة",
            "owner": "HR Manager"
          },
          {
            "id": "chk-1-3",
            "ar": "تحديد معايير الفلترة الأساسية",
            "method": "مراجعة وجود مؤهل، خبرة، راتب، إقامة، مهارات",
            "evidence": "نموذج معايير الفلترة",
            "sample": "100% من الوظائف",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-1-4",
            "ar": "تسجيل تاريخ استلام الطلب وتاريخ بدء النشر",
            "method": "مطابقة التواريخ داخل النظام أو الشيت",
            "evidence": "Recruitment Tracker",
            "sample": "100% من الطلبات",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-1-5",
            "ar": "اعتماد أولوية الوظائف الحرجة",
            "method": "مراجعة تصنيف الوظائف الحرجة والمستعجلة",
            "evidence": "خطة التوظيف الشهرية",
            "sample": "الوظائف الحرجة فقط",
            "owner": "HR Manager"
          },
          {
            "id": "chk-1-6",
            "ar": "توحيد سبب الاحتياج",
            "method": "تحديد هل الاحتياج بديل، توسع، وظيفة جديدة",
            "evidence": "نموذج طلب التوظيف",
            "sample": "100% من الطلبات",
            "owner": "مدير التوظيف"
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-2",
        "ar": "مؤشرات الاستقطاب والنشر",
        "en": "Sourcing & job posting",
        "kpis": [
          {
            "id": "kpi-2-1",
            "ar": "تنوع قنوات النشر الفعالة",
            "definition": "عدد قنوات النشر التي تحقق متقدمين مؤهلين لكل وظيفة.",
            "weight": 6.0,
            "direction": "higher",
            "target": 4.0,
            "unit": "قنوات",
            "source": "LinkedIn / Wuzzuf / Bayt / قاعدة البيانات",
            "formula": "عدد القنوات التي أنتجت مرشحين مؤهلين",
            "bands": null
          },
          {
            "id": "kpi-2-2",
            "ar": "نسبة المرشحين المؤهلين من إجمالي المتقدمين",
            "definition": "قياس جودة المتقدمين الناتجين من الإعلانات.",
            "weight": 8.0,
            "direction": "higher",
            "target": 0.35,
            "unit": "نسبة",
            "source": "Recruitment Tracker",
            "formula": "(عدد المرشحين المؤهلين ÷ إجمالي المتقدمين) × 100",
            "bands": null
          },
          {
            "id": "kpi-2-3",
            "ar": "جودة محتوى الإعلان قبل النشر",
            "definition": "نسبة الإعلانات المعتمدة دون تعديلات جوهرية بعد النشر.",
            "weight": 6.0,
            "direction": "higher",
            "target": 0.9,
            "unit": "نسبة",
            "source": "نسخ الإعلانات / اعتماد المدير",
            "formula": "(الإعلانات المعتمدة من أول مرة ÷ إجمالي الإعلانات) × 100",
            "bands": null
          }
        ],
        "weight": 20.0,
        "checklist": [
          {
            "id": "chk-2-1",
            "ar": "توثيق قنوات النشر لكل وظيفة",
            "method": "مراجعة وجود رابط أو Screenshot لكل قناة",
            "evidence": "روابط الإعلان / Screenshots",
            "sample": "100% من الإعلانات",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-2-2",
            "ar": "مطابقة الإعلان للوصف الوظيفي",
            "method": "مراجعة الشروط والمهام والمزايا قبل النشر",
            "evidence": "نموذج مراجعة الإعلان",
            "sample": "عينة 30% شهريًا",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-2-3",
            "ar": "قياس مصدر كل متقدم",
            "method": "التأكد من تسجيل Source لكل CV",
            "evidence": "Recruitment Tracker",
            "sample": "عينة 20% من المرشحين",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-2-4",
            "ar": "تحديد القنوات الأعلى جودة",
            "method": "مقارنة عدد المؤهلين بكل قناة",
            "evidence": "تقرير مصادر المرشحين",
            "sample": "شهري",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-2-5",
            "ar": "إيقاف القنوات ضعيفة الجودة",
            "method": "تحديد القنوات ذات تكلفة/عائد ضعيف",
            "evidence": "تقرير الأداء الشهري",
            "sample": "شهري",
            "owner": "HR Manager"
          },
          {
            "id": "chk-2-6",
            "ar": "مراجعة لغة الإعلان وشكل الرسالة",
            "method": "التحقق من وضوح الراتب/المزايا/مكان العمل عند الحاجة",
            "evidence": "نموذج الإعلان",
            "sample": "عينة 30% شهريًا",
            "owner": "مدير التوظيف"
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-3",
        "ar": "مؤشرات الفرز والمقابلات",
        "en": "Screening & interviews",
        "kpis": [
          {
            "id": "kpi-3-1",
            "ar": "سرعة فرز السير الذاتية",
            "definition": "متوسط الوقت من استلام CV حتى تحديد حالة المرشح.",
            "weight": 7.0,
            "direction": "lower",
            "target": 48.0,
            "unit": "ساعة",
            "source": "Recruitment Tracker",
            "formula": "إجمالي ساعات الفرز ÷ عدد السير الذاتية المستلمة",
            "bands": null
          },
          {
            "id": "kpi-3-2",
            "ar": "نسبة استخدام كارت تحليل المرشح",
            "definition": "نسبة المقابلات التي تم فيها استخدام كارت تقييم موحد.",
            "weight": 7.0,
            "direction": "higher",
            "target": 1.0,
            "unit": "نسبة",
            "source": "Candidate Evaluation Cards",
            "formula": "(عدد المقابلات بكارت تقييم ÷ إجمالي المقابلات) × 100",
            "bands": null
          },
          {
            "id": "kpi-3-3",
            "ar": "نسبة المرشحين المقبولين من المديرين",
            "definition": "قياس جودة الترشيحات المرسلة للمديرين.",
            "weight": 6.0,
            "direction": "higher",
            "target": 0.7,
            "unit": "نسبة",
            "source": "نموذج تقييم المديرين",
            "formula": "(عدد المرشحين المقبولين من المديرين ÷ إجمالي المرشحين المرسلين) × 100",
            "bands": null
          }
        ],
        "weight": 20.0,
        "checklist": [
          {
            "id": "chk-3-1",
            "ar": "وجود نتيجة فرز لكل CV",
            "method": "مراجعة حالة كل مرشح: مناسب / غير مناسب / احتياطي",
            "evidence": "Recruitment Tracker",
            "sample": "عينة 20% من السير الذاتية",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-3-2",
            "ar": "توثيق سبب رفض المرشح",
            "method": "مراجعة سبب الرفض وعدم ترك الحالة فارغة",
            "evidence": "Recruitment Tracker",
            "sample": "عينة 20% من المرفوضين",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-3-3",
            "ar": "استخدام كارت تحليل المرشح",
            "method": "مطابقة عدد المقابلات مع عدد كروت التقييم",
            "evidence": "Candidate Evaluation Cards",
            "sample": "100% من المقابلات",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-3-4",
            "ar": "تسليم تقييم المدير خلال 24 ساعة",
            "method": "مطابقة تاريخ المقابلة بتاريخ استلام نموذج المدير",
            "evidence": "نموذج تقييم المديرين",
            "sample": "100% من مقابلات المدير",
            "owner": "HR Manager"
          },
          {
            "id": "chk-3-5",
            "ar": "تحديد توصية نهائية لكل مقابلة",
            "method": "مراجعة وجود Accepted / Rejected / Hold",
            "evidence": "كارت التحليل",
            "sample": "100% من المقابلات",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-3-6",
            "ar": "مطابقة المرشح للراتب المتوقع",
            "method": "مراجعة الراتب الحالي والمتوقع قبل تصعيد المرشح",
            "evidence": "كارت المرشح",
            "sample": "عينة 30% شهريًا",
            "owner": "مدير التوظيف"
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-4",
        "ar": "مؤشرات سرعة دورة التوظيف",
        "en": "Hiring cycle speed",
        "kpis": [
          {
            "id": "kpi-4-1",
            "ar": "متوسط وقت الإشغال Time to Fill",
            "definition": "متوسط الأيام من استلام طلب التوظيف حتى قبول العرض.",
            "weight": 9.0,
            "direction": "lower",
            "target": 30.0,
            "unit": "يوم",
            "source": "Recruitment Tracker",
            "formula": "إجمالي أيام الإشغال ÷ عدد الوظائف المغلقة",
            "bands": null
          },
          {
            "id": "kpi-4-2",
            "ar": "الالتزام بالجدول الزمني للمراحل",
            "definition": "نسبة المراحل التي تمت داخل الوقت المستهدف.",
            "weight": 7.0,
            "direction": "higher",
            "target": 0.85,
            "unit": "نسبة",
            "source": "قائمة تحقق التوقيت",
            "formula": "(المراحل المنجزة في وقتها ÷ إجمالي المراحل) × 100",
            "bands": null
          },
          {
            "id": "kpi-4-3",
            "ar": "نسبة الوظائف المتأخرة",
            "definition": "نسبة الوظائف التي تجاوزت الإطار الزمني المعتمد.",
            "weight": 4.0,
            "direction": "lower",
            "target": 0.1,
            "unit": "نسبة",
            "source": "Recruitment Tracker",
            "formula": "(الوظائف المتأخرة ÷ إجمالي الوظائف المفتوحة) × 100",
            "bands": null
          }
        ],
        "weight": 20.0,
        "checklist": [
          {
            "id": "chk-4-1",
            "ar": "تسجيل تاريخ فتح كل وظيفة",
            "method": "مراجعة وجود Start Date لكل طلب",
            "evidence": "Recruitment Tracker",
            "sample": "100% من الوظائف",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-4-2",
            "ar": "تسجيل تاريخ كل مرحلة توظيف",
            "method": "مطابقة تاريخ النشر، الفرز، المقابلات، العرض، القبول",
            "evidence": "Recruitment Tracker",
            "sample": "100% من الوظائف",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-4-3",
            "ar": "تحليل أسباب التأخير",
            "method": "وجود سبب واضح لكل وظيفة متأخرة",
            "evidence": "تقرير التأخير",
            "sample": "كل وظيفة متأخرة",
            "owner": "HR Manager"
          },
          {
            "id": "chk-4-4",
            "ar": "متابعة الوظائف المفتوحة أسبوعيًا",
            "method": "وجود تحديث أسبوعي للحالة",
            "evidence": "Weekly Hiring Report",
            "sample": "أسبوعيًا",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-4-5",
            "ar": "تصعيد المعوقات في الوقت المناسب",
            "method": "وجود بريد أو رسالة تصعيد للمعوقات المؤثرة",
            "evidence": "Email / Odoo Notes",
            "sample": "حسب الحاجة",
            "owner": "HR Manager"
          },
          {
            "id": "chk-4-6",
            "ar": "إغلاق الوظائف المنتهية من المتابعة",
            "method": "عدم ترك وظائف مغلقة بحالة مفتوحة",
            "evidence": "HR System",
            "sample": "100% من الوظائف المغلقة",
            "owner": "أخصائي التوظيف"
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-5",
        "ar": "مؤشرات العروض والإغلاق",
        "en": "Offers & closing",
        "kpis": [
          {
            "id": "kpi-5-1",
            "ar": "نسبة قبول العروض الوظيفية",
            "definition": "نسبة العروض التي تم قبولها من المرشحين.",
            "weight": 8.0,
            "direction": "higher",
            "target": 0.8,
            "unit": "نسبة",
            "source": "Offer Tracker",
            "formula": "(عدد العروض المقبولة ÷ إجمالي العروض المرسلة) × 100",
            "bands": null
          },
          {
            "id": "kpi-5-2",
            "ar": "اكتمال بنود العرض الوظيفي",
            "definition": "نسبة العروض التي تشمل الراتب، البدلات، الإجازات، التأمينات، تاريخ المباشرة.",
            "weight": 7.0,
            "direction": "higher",
            "target": 1.0,
            "unit": "نسبة",
            "source": "Offer Letters",
            "formula": "(العروض المكتملة البنود ÷ إجمالي العروض) × 100",
            "bands": null
          },
          {
            "id": "kpi-5-3",
            "ar": "إغلاق ملف التوظيف على النظام",
            "definition": "نسبة الوظائف التي تم تحديث حالتها النهائية وإرفاق مستنداتها.",
            "weight": 5.0,
            "direction": "higher",
            "target": 0.95,
            "unit": "نسبة",
            "source": "HR System",
            "formula": "(الوظائف المغلقة والمكتملة على النظام ÷ إجمالي الوظائف المغلقة) × 100",
            "bands": null
          }
        ],
        "weight": 20.0,
        "checklist": [
          {
            "id": "chk-5-1",
            "ar": "توثيق تاريخ إرسال العرض",
            "method": "مطابقة تاريخ إرسال العرض مع النظام",
            "evidence": "Offer Tracker",
            "sample": "100% من العروض",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-5-2",
            "ar": "توثيق رد المرشح على العرض",
            "method": "وجود قبول / رفض / تفاوض لكل عرض",
            "evidence": "Offer Tracker",
            "sample": "100% من العروض",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-5-3",
            "ar": "اكتمال بنود العرض الوظيفي",
            "method": "مراجعة الراتب، البدلات، التأمينات، تاريخ المباشرة",
            "evidence": "Offer Letter",
            "sample": "100% من العروض",
            "owner": "HR Manager"
          },
          {
            "id": "chk-5-4",
            "ar": "حفظ مستندات المرشح المقبول",
            "method": "وجود CV، كارت تقييم، عرض، مستندات أساسية",
            "evidence": "Employee File",
            "sample": "100% من المقبولين",
            "owner": "أخصائي التوظيف"
          },
          {
            "id": "chk-5-5",
            "ar": "تحديث حالة الوظيفة نهائيًا",
            "method": "إغلاق الوظيفة على النظام بعد القبول أو الإلغاء",
            "evidence": "HR System",
            "sample": "100% من الوظائف المغلقة",
            "owner": "مدير التوظيف"
          },
          {
            "id": "chk-5-6",
            "ar": "تسليم بيانات الموظف لشؤون العاملين",
            "method": "وجود Hand-over واضح للموظف الجديد",
            "evidence": "Onboarding Handover",
            "sample": "100% من المقبولين",
            "owner": "HR Manager"
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      }
    ]
  },
  {
    "id": "personnel_specialist",
    "audience": "employee",
    "department": "hr",
    "subteam": "personnel",
    "ar": "أخصائي شئون العاملين",
    "en": "People operations specialist",
    "descAr": "أربعة محاور متساوية الوزن: استلام الموظفين الجدد، تقفيل الرواتب، التدريب على اللوائح، وسياسات العمل والدورة المستندية.",
    "descEn": "Four equally weighted axes: onboarding, payroll close, policy training, and the document cycle.",
    "checklistMode": "evidence",
    "sourceFile": "Personnel KPI`S New 7-2026.xlsx",
    "groups": [
      {
        "id": "axis-1",
        "ar": "استلام الموظفين الجدد",
        "en": "Onboarding new hires",
        "weight": 25.0,
        "kpis": [
          {
            "id": "kpi-1-1",
            "ar": "اكتمال ملف الموظف الجديد بجميع المستندات المطلوبة",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "ملف الموظف الورقي / الإلكتروني",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-1-2",
            "ar": "توقيع عقد العمل وجميع النماذج الرسمية في الموعد المحدد",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "نسخة العقد الموقعة + تسليم النسخة للموظف",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-1-3",
            "ar": "تسليم بطاقة الدخول والأدوات والمعدات اللازمة يوم الانضمام",
            "definition": "",
            "weight": 4.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "نموذج استلام الأصول والمعدات",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-1-4",
            "ar": "إجراء جلسة تعريفية رسمية بالشركة ورسالتها وهيكلها خلال أول 3 أيام",
            "definition": "",
            "weight": 4.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "محضر الجلسة التعريفية / قائمة الحضور",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-1-5",
            "ar": "تعيين مرشد أو Buddy للموظف الجديد وتوثيق التواصل",
            "definition": "",
            "weight": 3.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "نموذج تعيين المرشد الموقع",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-1-6",
            "ar": "متابعة أداء الموظف الجديد خلال فترة الاختبار وتوثيقها",
            "definition": "",
            "weight": 4.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "تقارير المتابعة الشهرية / تقييم نهاية الاختبار",
            "formula": "",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-1-1",
            "ar": "صورة الهوية الوطنية / جواز السفر",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-2",
            "ar": "المؤهلات الدراسية الأصلية وصورها",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-3",
            "ar": "شهادات الخبرة من أصحاب العمل السابقين",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-4",
            "ar": "الصور الشخصية بالمواصفات المطلوبة",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-5",
            "ar": "استمارة بيانات الموظف مكتملة وموقعة",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-6",
            "ar": "نموذج بيانات الحساب البنكي",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-7",
            "ar": "شهادة اللياقة الطبية (إن اشترطت)",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-8",
            "ar": "نموذج التأمين الصحي / الاجتماعي",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-9",
            "ar": "نموذج الإقرار بالسياسات والقواعد الداخلية",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-10",
            "ar": "نموذج استلام دليل الموظف",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-11",
            "ar": "نموذج استلام المعدات والأجهزة",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-12",
            "ar": "نموذج عدم الإفصاح (NDA) إن وجد",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-13",
            "ar": "توقيع عقد العمل وتسليم نسخة للموظف",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-14",
            "ar": "تفعيل البريد الإلكتروني وحسابات النظام",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-15",
            "ar": "إدخال بيانات الموظف في نظام الموارد البشرية",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-2",
        "ar": "تقفيل الرواتب",
        "en": "Payroll close",
        "weight": 25.0,
        "kpis": [
          {
            "id": "kpi-2-1",
            "ar": "دقة إدخال بيانات الحضور والغياب والإجازات قبل الإغلاق",
            "definition": "",
            "weight": 6.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "تقرير الحضور المعتمد / سجلات النظام",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-2-2",
            "ar": "مراجعة ومطابقة الرواتب الأساسية والبدلات مع العقود",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "كشف مقارنة العقود × مسير الرواتب",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-2-3",
            "ar": "احتساب الاستقطاعات القانونية والتأمينات بشكل صحيح",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "تقرير الاستقطاعات المعتمد + إيصالات السداد",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-2-4",
            "ar": "الالتزام بموعد صرف الرواتب المحدد (لا تأخير)",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "سجل تواريخ التحويل البنكي",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-2-5",
            "ar": "الحصول على اعتماد مسير الرواتب من المسئول المختص قبل الصرف",
            "definition": "",
            "weight": 4.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "نموذج اعتماد مسير الرواتب الموقع",
            "formula": "",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-2-1",
            "ar": "مراجعة سجل الحضور والانصراف كاملاً",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-2",
            "ar": "التحقق من طلبات الإجازة المعتمدة وخصمها",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-3",
            "ar": "مراجعة حالات الغياب وتطبيق الاستقطاع",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-4",
            "ar": "مراجعة ساعات العمل الإضافي والاعتماد",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-5",
            "ar": "تحديث بيانات الموظفين الجدد في المسير",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-6",
            "ar": "تسوية رواتب المنتهية خدمتهم (إن وجد)",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-7",
            "ar": "مراجعة أي تعديلات على الرواتب أو البدلات",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-8",
            "ar": "احتساب استقطاعات التأمينات الاجتماعية",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-9",
            "ar": "احتساب ضريبة الدخل (إن وجدت)",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-10",
            "ar": "مراجعة ودفع مستحقات الإجازة السنوية",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-11",
            "ar": "التحقق من أرقام الحسابات البنكية للموظفين",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-12",
            "ar": "اعتماد مسير الرواتب من المدير المختص",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-13",
            "ar": "إرسال ملف التحويل للبنك في الموعد",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-14",
            "ar": "توثيق وأرشفة مسير الرواتب الشهري",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-15",
            "ar": "إعداد تقرير ملخص رواتب للإدارة",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-3",
        "ar": "التدريب على اللوائح",
        "en": "Policy training",
        "weight": 25.0,
        "kpis": [
          {
            "id": "kpi-3-1",
            "ar": "إجراء تدريب توعوي رسمي للوائح العمل الداخلي لجميع الموظفين الجدد",
            "definition": "",
            "weight": 6.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "قائمة الحضور الموقعة + محتوى التدريب",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-3-2",
            "ar": "إجراء جلسات تدريب دورية للموظفين الحاليين (مرة على الأقل كل 6 أشهر)",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "خطة التدريب السنوية + سجلات الجلسات",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-3-3",
            "ar": "قياس مستوى الاستيعاب بعد التدريب (اختبار / تقييم)",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "نتائج الاختبارات / استمارات التقييم",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-3-4",
            "ar": "مراقبة الالتزام بلوائح العمل ورصد المخالفات وتوثيقها",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "تقرير المخالفات الشهري / سجل الجزاءات",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-3-5",
            "ar": "تحديث مواد التدريب فور تغيير اللوائح أو السياسات",
            "definition": "",
            "weight": 4.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "سجل مراجعة المواد + تواريخ التحديث",
            "formula": "",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-3-1",
            "ar": "لائحة العمل الداخلية (تعريف، حقوق، واجبات)",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-2",
            "ar": "سياسة الحضور والانصراف وأوقات العمل",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-3",
            "ar": "سياسة الإجازات وإجراءات الطلب والاعتماد",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-4",
            "ar": "قواعد السلوك المهني وآداب التعامل",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-5",
            "ar": "سياسة الاستخدام الأمثل للموارد والأصول",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-6",
            "ar": "إجراءات الصحة والسلامة المهنية",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-7",
            "ar": "سياسة التحرش والمساواة وبيئة العمل",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-8",
            "ar": "سياسة السرية وحماية البيانات",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-9",
            "ar": "منظومة الجزاءات التأديبية وإجراءاتها",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-10",
            "ar": "إجراءات تقديم الشكاوى والتظلمات",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-11",
            "ar": "سياسة الترقي والتطوير الوظيفي",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-12",
            "ar": "إجراءات إنهاء الخدمة والاستقالة",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-4",
        "ar": "سياسات العمل والمستندات",
        "en": "Work policies & paperwork",
        "weight": 25.0,
        "kpis": [
          {
            "id": "kpi-4-1",
            "ar": "تطبيق سياسات HR بشكل منتظم ومتسق مع جميع الموظفين",
            "definition": "",
            "weight": 6.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "عينة قرارات / إشعارات HR مطابقة للسياسة",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-4-2",
            "ar": "اكتمال الدورة المستندية لجميع العمليات (طلب – اعتماد – تنفيذ – أرشفة)",
            "definition": "",
            "weight": 6.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "مراجعة عشوائية لملفات 10 عمليات شهرياً",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-4-3",
            "ar": "الالتزام بمواعيد إصدار الخطابات والقرارات الرسمية",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "سجل تواريخ الإصدار × التواريخ المستهدفة",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-4-4",
            "ar": "دقة وسلامة الأرشفة الإلكترونية والورقية لملفات الموظفين",
            "definition": "",
            "weight": 4.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "تقرير مراجعة الأرشيف الربع سنوي",
            "formula": "",
            "bands": null
          },
          {
            "id": "kpi-4-5",
            "ar": "التحقق من امتثال قرارات HR للتشريعات العمالية المعمول بها",
            "definition": "",
            "weight": 4.0,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "مراجعة قانونية / تقرير الامتثال السنوي",
            "formula": "",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-4-1",
            "ar": "وجود سياسة موثقة ومعتمدة لكل عملية HR",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-2",
            "ar": "تطبيق السياسة بالتساوي على جميع الموظفين",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-3",
            "ar": "وجود نموذج طلب رسمي لكل عملية",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-4",
            "ar": "وجود مسار اعتماد واضح ومحدد للمسئوليات",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-5",
            "ar": "توثيق قرار الاعتماد أو الرفض مع المبرر",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-6",
            "ar": "إشعار الموظف بالقرار كتابياً في الموعد",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-7",
            "ar": "أرشفة المستند في ملف الموظف فور الانتهاء",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-8",
            "ar": "وجود سجل تتبع للمستندات المعلقة (Tracker)",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-9",
            "ar": "مراجعة دورية لمدى تطبيق السياسات",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-10",
            "ar": "تحديث السياسات عند تغيير القوانين",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-11",
            "ar": "توثيق أي استثناءات مع مبرراتها واعتمادها",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-12",
            "ar": "إجراء تدقيق داخلي دوري على الدورة المستندية",
            "method": "",
            "evidence": "",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      }
    ]
  },
  {
    "id": "hr_manager",
    "audience": "manager",
    "department": "hr",
    "subteam": "hr_management",
    "ar": "مدير الموارد البشرية",
    "en": "HR manager",
    "descAr": "خمسة محاور بوزن 20 نقطة لكل محور: التخطيط والتوظيف، شئون العاملين والرواتب، الأداء والانضباط، التدريب والتطوير، والامتثال والتقارير.",
    "descEn": "Five axes worth 20 points each: workforce planning, people operations and payroll, performance and conduct, learning and development, and compliance and reporting.",
    "checklistMode": "evidence",
    "sourceFile": "HR Manager Kpis 7-2026.xlsx",
    "groups": [
      {
        "id": "axis-1",
        "ar": "التخطيط والتوظيف",
        "en": "Workforce planning & hiring",
        "weight": 20.0,
        "kpis": [
          {
            "id": "kpi-1-1",
            "ar": "التزام تنفيذ خطة التوظيف المعتمدة",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "خطة التوظيف المعتمدة + أوامر التعيين",
            "formula": "نسبة الوظائف التي تم شغلها من إجمالي الوظائف المعتمدة بالخطة",
            "bands": null
          },
          {
            "id": "kpi-1-2",
            "ar": "متوسط زمن إغلاق الوظائف الشاغرة",
            "definition": "",
            "weight": 5.0,
            "direction": "lower",
            "target": 5.0,
            "unit": "",
            "source": "تقرير الوظائف الشاغرة + تواريخ النشر والتعيين",
            "formula": "المدة المستهدفة مقابل متوسط الأيام الفعلية لإغلاق كل وظيفة",
            "bands": null
          },
          {
            "id": "kpi-1-3",
            "ar": "جودة الاختيار خلال فترة الاختبار",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 4.0,
            "unit": "",
            "source": "نماذج تقييم فترة الاختبار + قرارات التثبيت",
            "formula": "نسبة الموظفين الجدد الذين اجتازوا فترة الاختبار بنجاح",
            "bands": null
          },
          {
            "id": "kpi-1-4",
            "ar": "كفاءة تكلفة التوظيف",
            "definition": "",
            "weight": 5.0,
            "direction": "lower",
            "target": 4.0,
            "unit": "",
            "source": "تقرير تكلفة الإعلان والمقابلات ومصادر التوظيف",
            "formula": "التكلفة المستهدفة للتوظيف مقابل التكلفة الفعلية لكل تعيين",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-1-1",
            "ar": "وجود خطة احتياجات وظيفية معتمدة للشهر / الربع",
            "method": "",
            "evidence": "خطة التوظيف",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-2",
            "ar": "وجود توصيف وظيفي محدث لكل وظيفة شاغرة",
            "method": "",
            "evidence": "التوصيف الوظيفي",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-3",
            "ar": "توثيق موافقة الإدارة على فتح الشاغر",
            "method": "",
            "evidence": "نموذج طلب تعيين",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-4",
            "ar": "تسجيل مصادر المرشحين وتكلفة كل مصدر",
            "method": "",
            "evidence": "سجل مصادر التوظيف",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-5",
            "ar": "توثيق مراحل الفرز والمقابلات والاختبارات",
            "method": "",
            "evidence": "نماذج المقابلات",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-6",
            "ar": "الاحتفاظ بعروض العمل والموافقات النهائية",
            "method": "",
            "evidence": "عرض العمل",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-7",
            "ar": "متابعة الموظف الجديد خلال أول 90 يومًا",
            "method": "",
            "evidence": "متابعة فترة الاختبار",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-1-8",
            "ar": "إصدار تقرير شهري عن الوظائف المغلقة والمتأخرة",
            "method": "",
            "evidence": "تقرير التوظيف الشهري",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-2",
        "ar": "شئون العاملين والرواتب",
        "en": "People operations & payroll",
        "weight": 20.0,
        "kpis": [
          {
            "id": "kpi-2-1",
            "ar": "دقة تقفيل الرواتب الشهرية",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "مسير الرواتب المعتمد + تقرير التعديلات",
            "formula": "عدد الرواتب الصحيحة ÷ إجمالي رواتب الموظفين في المسير",
            "bands": null
          },
          {
            "id": "kpi-2-2",
            "ar": "اكتمال ملفات الموظفين",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "قائمة مراجعة ملفات الموظفين",
            "formula": "عدد الملفات المكتملة ÷ إجمالي ملفات الموظفين التي تمت مراجعتها",
            "bands": null
          },
          {
            "id": "kpi-2-3",
            "ar": "الالتزام بمواعيد الإجراءات الرسمية",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "سجل العقود / التأمينات / الخطابات",
            "formula": "الإجراءات المنجزة في الموعد ÷ إجمالي الإجراءات المطلوبة",
            "bands": null
          },
          {
            "id": "kpi-2-4",
            "ar": "سرعة إنجاز طلبات الموظفين",
            "definition": "",
            "weight": 5.0,
            "direction": "lower",
            "target": 5.0,
            "unit": "",
            "source": "تذاكر / طلبات الموظفين + تواريخ الإغلاق",
            "formula": "المدة المستهدفة لإنجاز الطلب مقابل متوسط المدة الفعلية",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-2-1",
            "ar": "مراجعة الحضور والانصراف قبل إغلاق الرواتب",
            "method": "",
            "evidence": "تقرير الحضور",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-2",
            "ar": "مطابقة البدلات والاستقطاعات مع العقود والقرارات",
            "method": "",
            "evidence": "العقود والقرارات",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-3",
            "ar": "اعتماد مسير الرواتب قبل التحويل البنكي",
            "method": "",
            "evidence": "نموذج اعتماد الرواتب",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-4",
            "ar": "أرشفة مسير الرواتب وإثباتات التحويل",
            "method": "",
            "evidence": "الأرشيف المالي",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-5",
            "ar": "مراجعة عينة من ملفات الموظفين شهريًا",
            "method": "",
            "evidence": "سجل مراجعة الملفات",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-6",
            "ar": "التأكد من اكتمال العقود والنماذج الرسمية",
            "method": "",
            "evidence": "ملف الموظف",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-7",
            "ar": "تتبع الطلبات المتأخرة وتوضيح أسباب التأخير",
            "method": "",
            "evidence": "سجل طلبات الموظفين",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-2-8",
            "ar": "إصدار تقرير شهري بالأخطاء والتعديلات",
            "method": "",
            "evidence": "تقرير شئون العاملين",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-3",
        "ar": "الأداء والانضباط",
        "en": "Performance & conduct",
        "weight": 20.0,
        "kpis": [
          {
            "id": "kpi-3-1",
            "ar": "اكتمال تقييمات الأداء في الموعد",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "نماذج تقييم الأداء المعتمدة",
            "formula": "عدد التقييمات المعتمدة في الموعد ÷ إجمالي التقييمات المطلوبة",
            "bands": null
          },
          {
            "id": "kpi-3-2",
            "ar": "ربط أهداف الموظفين بأهداف الإدارة",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "نماذج الأهداف الفردية / KPIs",
            "formula": "عدد الموظفين الذين لديهم أهداف موثقة ÷ إجمالي الموظفين المستهدفين",
            "bands": null
          },
          {
            "id": "kpi-3-3",
            "ar": "خفض مخالفات الانضباط المتكررة",
            "definition": "",
            "weight": 5.0,
            "direction": "lower",
            "target": 5.0,
            "unit": "",
            "source": "سجل المخالفات والجزاءات",
            "formula": "الحد المستهدف للمخالفات مقابل العدد الفعلي للمخالفات المتكررة",
            "bands": null
          },
          {
            "id": "kpi-3-4",
            "ar": "متابعة خطط تحسين الأداء",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "نماذج PIP وتقارير المتابعة",
            "formula": "عدد خطط التحسين المغلقة أو المتابعة ÷ إجمالي خطط التحسين المفتوحة",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-3-1",
            "ar": "وجود دورة تقييم أداء واضحة ومعتمدة",
            "method": "",
            "evidence": "سياسة تقييم الأداء",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-2",
            "ar": "إرسال مواعيد التقييم للمديرين قبل الموعد",
            "method": "",
            "evidence": "إشعارات التقييم",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-3",
            "ar": "اعتماد نتائج التقييم من المدير المختص",
            "method": "",
            "evidence": "نماذج التقييم",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-4",
            "ar": "توثيق أهداف الموظفين ومؤشرات قياسها",
            "method": "",
            "evidence": "بطاقات الأهداف",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-5",
            "ar": "تحليل الموظفين ذوي الأداء المنخفض",
            "method": "",
            "evidence": "تقرير الأداء",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-6",
            "ar": "فتح خطط تحسين أداء للحالات المطلوبة",
            "method": "",
            "evidence": "نماذج PIP",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-7",
            "ar": "توثيق المخالفات والجزاءات وفق اللائحة",
            "method": "",
            "evidence": "سجل الجزاءات",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-3-8",
            "ar": "رفع تقرير شهري عن الأداء والانضباط للإدارة",
            "method": "",
            "evidence": "تقرير شهري",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-4",
        "ar": "التدريب والتطوير",
        "en": "Learning & development",
        "weight": 20.0,
        "kpis": [
          {
            "id": "kpi-4-1",
            "ar": "تنفيذ خطة التدريب المعتمدة",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "خطة التدريب + سجل التنفيذ",
            "formula": "عدد البرامج المنفذة ÷ إجمالي البرامج المخططة",
            "bands": null
          },
          {
            "id": "kpi-4-2",
            "ar": "تغطية التدريب الإلزامي والسياسات",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "قوائم الحضور + محتوى التدريب",
            "formula": "عدد الموظفين الذين حضروا التدريب الإلزامي ÷ إجمالي الموظفين المستهدفين",
            "bands": null
          },
          {
            "id": "kpi-4-3",
            "ar": "فاعلية التدريب بعد التقييم",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "نتائج تقييم التدريب / الاختبارات",
            "formula": "متوسط تقييم التدريب أو نتائج الاختبار بعد التدريب ÷ الدرجة المستهدفة",
            "bands": null
          },
          {
            "id": "kpi-4-4",
            "ar": "تطبيق خطط التطوير للوظائف الحرجة",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "خطط التطوير الفردية + تقارير المتابعة",
            "formula": "عدد خطط التطوير المتابعة ÷ إجمالي الخطط المطلوبة للوظائف الحرجة",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-4-1",
            "ar": "وجود تحليل احتياجات تدريبية معتمد",
            "method": "",
            "evidence": "TNA",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-2",
            "ar": "ربط الخطة التدريبية باحتياجات الأقسام",
            "method": "",
            "evidence": "خطة التدريب",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-3",
            "ar": "توثيق الحضور والانصراف لكل برنامج",
            "method": "",
            "evidence": "قوائم الحضور",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-4",
            "ar": "قياس رضا المتدربين بعد التدريب",
            "method": "",
            "evidence": "استمارة تقييم",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-5",
            "ar": "قياس أثر التدريب عند الحاجة",
            "method": "",
            "evidence": "تقرير أثر التدريب",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-6",
            "ar": "متابعة البرامج غير المنفذة وسبب التأجيل",
            "method": "",
            "evidence": "سجل التأجيلات",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-7",
            "ar": "تحديث مواد تدريب اللوائح والسياسات",
            "method": "",
            "evidence": "مواد التدريب",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-4-8",
            "ar": "إصدار تقرير ربع سنوي عن التدريب والتطوير",
            "method": "",
            "evidence": "تقرير التدريب",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-5",
        "ar": "الامتثال والتقارير",
        "en": "Compliance & reporting",
        "weight": 20.0,
        "kpis": [
          {
            "id": "kpi-5-1",
            "ar": "الالتزام بالتشريعات والسياسات العمالية",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "تقرير امتثال داخلي / مراجعة قانونية",
            "formula": "عدد البنود الملتزم بها ÷ إجمالي البنود التي تمت مراجعتها",
            "bands": null
          },
          {
            "id": "kpi-5-2",
            "ar": "إصدار تقارير HR الدورية في الموعد",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "أرشيف التقارير الشهرية والربع سنوية",
            "formula": "عدد التقارير الصادرة في الموعد ÷ إجمالي التقارير المطلوبة",
            "bands": null
          },
          {
            "id": "kpi-5-3",
            "ar": "تحديث السياسات والإجراءات",
            "definition": "",
            "weight": 5.0,
            "direction": "higher",
            "target": 5.0,
            "unit": "",
            "source": "سجل مراجعة السياسات والإصدارات",
            "formula": "عدد السياسات المحدثة والمعتمدة ÷ إجمالي السياسات المطلوب تحديثها",
            "bands": null
          },
          {
            "id": "kpi-5-4",
            "ar": "خفض معدل الدوران غير المرغوب",
            "definition": "",
            "weight": 5.0,
            "direction": "lower",
            "target": 5.0,
            "unit": "",
            "source": "تقرير الاستقالات + مقابلات الخروج",
            "formula": "المعدل المستهدف للدوران مقابل المعدل الفعلي للدوران غير المرغوب",
            "bands": null
          }
        ],
        "checklist": [
          {
            "id": "chk-5-1",
            "ar": "مراجعة اللوائح والسياسات مقابل القوانين المعمول بها",
            "method": "",
            "evidence": "قائمة الامتثال",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-5-2",
            "ar": "توثيق أي مخاطر امتثال أو مخالفات محتملة",
            "method": "",
            "evidence": "سجل المخاطر",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-5-3",
            "ar": "رفع تقرير شهري للإدارة عن مؤشرات HR",
            "method": "",
            "evidence": "Dashboard / تقرير HR",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-5-4",
            "ar": "توحيد مصادر البيانات المستخدمة في التقارير",
            "method": "",
            "evidence": "مصادر البيانات",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-5-5",
            "ar": "تحديث السياسات عند تغيير الإجراءات أو القوانين",
            "method": "",
            "evidence": "سجل الإصدارات",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-5-6",
            "ar": "إبلاغ الموظفين بأي تحديثات جوهرية في السياسات",
            "method": "",
            "evidence": "إشعارات الموظفين",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-5-7",
            "ar": "تحليل أسباب ترك العمل وإجراءات الحد منها",
            "method": "",
            "evidence": "Exit Interviews",
            "sample": "",
            "owner": ""
          },
          {
            "id": "chk-5-8",
            "ar": "متابعة الإجراءات التصحيحية حتى الإغلاق",
            "method": "",
            "evidence": "سجل الإجراءات التصحيحية",
            "sample": "",
            "owner": ""
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      }
    ]
  },
  {
    "id": "sales_operations_manager",
    "audience": "manager",
    "department": "sales",
    "subteam": "",
    "ar": "مدير المبيعات والعمليات",
    "en": "Sales & operations manager",
    "descAr": "تحقيق التارجت بوزن 50% وفق شرائح خصم متدرّجة، ثم المحافظة على الأفراد والتقارير والأسواق الجديدة بوزن 10% لكل منها، وقسم العمليات بوزن 20% موزّعة على أربعة معايير.",
    "descEn": "Target achievement carries 50% on a tiered deduction scale; retention, reporting and new markets carry 10% each; operations carries 20% split across four measures.",
    "checklistMode": "none",
    "sourceFile": "مؤشرات_مدير_المبيعات_والعمليات_شهري.xlsx",
    "groups": [
      {
        "id": "axis-1",
        "ar": "تحقيق مستهدف المبيعات",
        "en": "Sales target achievement",
        "weight": 50,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-1-1",
            "ar": "نسبة تحقيق مستهدف المبيعات (Target Achievement)",
            "definition": "",
            "weight": 50,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "احتساب متدرّج: 100% فأكثر = المعيار كامل | 90%–100% = خصم 30% | 80%–90% = خصم 60% | 70%–80% = خصم 80% | أقل من 70% = خصم المعيار بالكامل",
            "bands": [
              {
                "min": 1,
                "entitlement": 1
              },
              {
                "min": 0.9,
                "entitlement": 0.7
              },
              {
                "min": 0.8,
                "entitlement": 0.4
              },
              {
                "min": 0.7,
                "entitlement": 0.2
              },
              {
                "min": 0,
                "entitlement": 0
              }
            ]
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-2",
        "ar": "المحافظة على الأفراد",
        "en": "Team retention",
        "weight": 10,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-2-1",
            "ar": "المحافظة على الأفراد (Retention)",
            "definition": "",
            "weight": 10,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "يُحتسب بناءً على عدد الاستقالات خلال الشهر ومعدل الرضا الوظيفي العام بالقسم",
            "bands": null
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-3",
        "ar": "التقارير واجتماعات الإدارة",
        "en": "Reports & management meetings",
        "weight": 10,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-3-1",
            "ar": "جودة التقارير وحضور اجتماعات الإدارة",
            "definition": "",
            "weight": 10,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "انتظام وجودة واكتمال التقارير الدورية + نسبة الحضور في اجتماعات الإدارة",
            "bands": null
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-4",
        "ar": "فتح أسواق جديدة",
        "en": "New markets",
        "weight": 10,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-4-1",
            "ar": "فتح أسواق جديدة وزيادة المبيعات",
            "definition": "",
            "weight": 10,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "نجاح فتح أسواق/قنوات بيع جديدة خلال الشهر وأثرها في نمو المبيعات",
            "bands": null
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      },
      {
        "id": "axis-5",
        "ar": "قسم العمليات",
        "en": "Operations",
        "weight": 20,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-5-1",
            "ar": "رضا العملاء (Customer Satisfaction)",
            "definition": "",
            "weight": 5,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "نتائج استبيانات/مقاييس رضا العملاء خلال الشهر",
            "bands": null
          },
          {
            "id": "kpi-5-2",
            "ar": "دورة استلام العميل بعد المبيعات",
            "definition": "",
            "weight": 5,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "مدى الالتزام بسرعة وجودة دورة تسليم/استلام العميل بعد إتمام البيع",
            "bands": null
          },
          {
            "id": "kpi-5-3",
            "ar": "تقييمات العملاء",
            "definition": "",
            "weight": 5,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "متوسط تقييمات العملاء (Reviews / Ratings) خلال الشهر",
            "bands": null
          },
          {
            "id": "kpi-5-4",
            "ar": "فيديوهات تقييم العملاء (للتدريب)",
            "definition": "",
            "weight": 5,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "",
            "formula": "عدد وجودة فيديوهات تقييم العملاء المستخدمة في تدريب فريق المبيعات",
            "bands": null
          }
        ],
        "minimumRatio": null,
        "incentiveBands": null
      }
    ]
  },
  {
    "id": "marketing_manager",
    "audience": "manager",
    "department": "marketing",
    "subteam": "",
    "ar": "مدير التسويق",
    "en": "Marketing manager",
    "descAr": "ست فئات مرجّحة، لكل فئة حد أدنى للاحتساب — الفئة التي تقل نسبة تحقيقها عن حدها الأدنى تُحتسب صفرًا. فئة المبيعات مرتبطة بشرائح خصم نقدي من الحافز الشهري.",
    "descEn": "Six weighted categories, each with a floor — a category below its floor scores zero. The sales category is tied to cash deduction tiers on the monthly incentive.",
    "checklistMode": "none",
    "sourceFile": "تقرير_مؤشرات_أداء_مدير_التسويق_-_مُعدَّل.xlsx",
    "groups": [
      {
        "id": "cat-1",
        "ar": "مبيعات موحدة عامة للشركة",
        "en": "Company-wide sales",
        "weight": 50,
        "minimumRatio": null,
        "checklist": [],
        "incentiveBands": [
          {
            "min": 0.9,
            "deduction": 0
          },
          {
            "min": 0.8,
            "deduction": 4000
          },
          {
            "min": 0.7,
            "deduction": 8000
          },
          {
            "min": 0,
            "deduction": "all"
          }
        ],
        "kpis": [
          {
            "id": "kpi-1-1",
            "ar": "نسبة تحقيق تارجت مبيعات الشركة المباشرة",
            "definition": "",
            "weight": 1,
            "direction": "higher",
            "target": 138000,
            "unit": "ج.م",
            "source": "تقرير المبيعات الرسمي المعتمد من قسم المبيعات/المالية (نظام CRM أو الفواتير)",
            "formula": "قيمة مبيعات الشركة المباشرة الفعلية المحصّلة خلال الشهر ÷ تارجت مبيعات الشركة المعتمد للشهر",
            "bands": null
          }
        ]
      },
      {
        "id": "cat-2",
        "ar": "متابعة تحسين الموقع الإلكتروني",
        "en": "Website improvement",
        "weight": 15,
        "minimumRatio": 0.6,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-2-1",
            "ar": "إنجاز مهام السيو (SEO) الشهرية",
            "definition": "",
            "weight": 0.2,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "خطة مهام السيو الشهرية المعتمدة وتقرير الإنجاز (Task Tracker)",
            "formula": "عدد مهام السيو المنفذة ÷ عدد مهام السيو المخططة في الشهر",
            "bands": null
          },
          {
            "id": "kpi-2-2",
            "ar": "تحديث جدول الظهور والكلمات المفتاحية",
            "definition": "",
            "weight": 0.15,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "Google Search Console",
            "formula": "تحديث جدول الظهور والكلمات المفتاحية في الموعد المحدد (أول كل شهر) — 100% التزام أو 0%",
            "bands": null
          },
          {
            "id": "kpi-2-3",
            "ar": "متابعة وتحديث محتوى الموقع الإلكتروني",
            "definition": "",
            "weight": 0.15,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "خطة محتوى الموقع الشهرية وتقرير التحديثات الفعلية",
            "formula": "عدد تحديثات المحتوى المنفذة ÷ عدد تحديثات المحتوى المخططة",
            "bands": null
          },
          {
            "id": "kpi-2-4",
            "ar": "التحديثات الداخلية للموقع (العروض والمناسبات والإعلانات)",
            "definition": "",
            "weight": 0.15,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "خطة العروض والمناسبات المعتمدة وتقرير التنفيذ",
            "formula": "عدد التحديثات الداخلية المنفذة ÷ عدد التحديثات المخططة",
            "bands": null
          },
          {
            "id": "kpi-2-5",
            "ar": "تقديم أفكار ومقترحات لتحسين الموقع",
            "definition": "",
            "weight": 0.1,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "سجل الأفكار والمقترحات",
            "formula": "عدد الأفكار المقدَّمة والموثقة ÷ الحد الأدنى المطلوب شهريًا",
            "bands": null
          },
          {
            "id": "kpi-2-6",
            "ar": "متابعة أداء الموقع (الظهور / الزيارات / CTR)",
            "definition": "",
            "weight": 0.25,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "Google Search Console و Google Analytics (GA4)",
            "formula": "متوسط نسبة تحقيق المستهدف لمعدل الظهور وعدد الزيارات ومعدل الضغط",
            "bands": null
          }
        ],
        "incentiveBands": null
      },
      {
        "id": "cat-3",
        "ar": "تقييم رضا الموظفين الوظيفي",
        "en": "Team satisfaction",
        "weight": 5,
        "minimumRatio": 0.6,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-3-1",
            "ar": "معدل رضا فريق التسويق الوظيفي",
            "definition": "",
            "weight": 1,
            "direction": "higher",
            "target": 0.8,
            "unit": "نسبة",
            "source": "استبيان رضا الموظفين (Pulse Survey) من الموارد البشرية",
            "formula": "متوسط نتائج استبيان الرضا الوظيفي الشهري لأعضاء الفريق (من 100)",
            "bands": null
          }
        ],
        "incentiveBands": null
      },
      {
        "id": "cat-4",
        "ar": "الدوران والتطوير وحل المشكلات",
        "en": "Turnover, development & problem solving",
        "weight": 10,
        "minimumRatio": 0.6,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-4-1",
            "ar": "معدل دوران فريق التسويق",
            "definition": "",
            "weight": 0.4,
            "direction": "lower",
            "target": 0.05,
            "unit": "نسبة",
            "source": "تقرير الموارد البشرية الشهري",
            "formula": "عدد من ترك العمل خلال الشهر ÷ متوسط عدد أفراد الفريق",
            "bands": null
          },
          {
            "id": "kpi-4-2",
            "ar": "معدل تنفيذ خطة التدريب والتطوير",
            "definition": "",
            "weight": 0.3,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "سجل الحضور وشهادات إتمام البرامج",
            "formula": "عدد الساعات/البرامج المنفذة ÷ عدد الساعات/البرامج المخططة",
            "bands": null
          },
          {
            "id": "kpi-4-3",
            "ar": "معدل حل المشكلات/الشكاوى داخل الفريق",
            "definition": "",
            "weight": 0.3,
            "direction": "lower",
            "target": 0.1,
            "unit": "نسبة",
            "source": "سجل الشكاوى والمشكلات",
            "formula": "عدد المشكلات الموثقة خلال الشهر ÷ عدد أفراد الفريق",
            "bands": null
          }
        ],
        "incentiveBands": null
      },
      {
        "id": "cat-5",
        "ar": "قنوات التواصل والأورجانك ليد",
        "en": "Social channels & organic leads",
        "weight": 10,
        "minimumRatio": 0.6,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-5-1",
            "ar": "نسبة إنجاز خطة النشر على قنوات التواصل الاجتماعي",
            "definition": "",
            "weight": 0.3,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "التقويم التحريري وتقرير النشر",
            "formula": "عدد المنشورات المنفذة ÷ عدد المنشورات المخططة في التقويم التحريري",
            "bands": null
          },
          {
            "id": "kpi-5-2",
            "ar": "معدل الأورجانك ليد (Organic Leads) من السوشيال ميديا",
            "definition": "",
            "weight": 0.35,
            "direction": "higher",
            "target": 100,
            "unit": "ليد",
            "source": "تقارير المنصات ونظام إدارة الليدز",
            "formula": "عدد الليدز العضوية المستقطبة من منصات التواصل ÷ الهدف الشهري",
            "bands": null
          },
          {
            "id": "kpi-5-3",
            "ar": "نسبة إنجاز أنشطة السوشيال ميديا والمواد الإبداعية",
            "definition": "",
            "weight": 0.35,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "خطة الأنشطة الإبداعية وتقرير التسليم",
            "formula": "عدد الأنشطة/التصاميم/الفيديوهات المسلَّمة ÷ عدد الأنشطة المخططة",
            "bands": null
          }
        ],
        "incentiveBands": null
      },
      {
        "id": "cat-6",
        "ar": "الاجتماعات الدورية والتقارير",
        "en": "Meetings & reports",
        "weight": 10,
        "minimumRatio": 0.6,
        "checklist": [],
        "kpis": [
          {
            "id": "kpi-6-1",
            "ar": "نسبة الحضور والانتظام في الاجتماعات الدورية للمديرين",
            "definition": "",
            "weight": 0.5,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "محاضر الاجتماعات وسجل الحضور",
            "formula": "عدد الاجتماعات التي حضرها المدير فعليًا ÷ إجمالي الاجتماعات المنعقدة",
            "bands": null
          },
          {
            "id": "kpi-6-2",
            "ar": "نسبة تقديم التقارير الدورية في مواعيدها المحددة",
            "definition": "",
            "weight": 0.5,
            "direction": "higher",
            "target": 1,
            "unit": "نسبة",
            "source": "أرشيف التقارير الدورية",
            "formula": "عدد التقارير المقدَّمة في موعدها ÷ إجمالي التقارير المطلوبة",
            "bands": null
          }
        ],
        "incentiveBands": null
      }
    ]
  }
];
