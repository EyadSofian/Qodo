/**
 * What the E-Learning Production demo contains.
 *
 * Content only: names, dates as offsets from the day it is loaded, the shape of
 * each course's production, and the educational text that fills an outline, a
 * script and a deck. Nothing here touches a database — `../seed-learning-demo.js`
 * is the engine that writes it.
 *
 * Two rules the content follows, because a demo that breaks either of them
 * teaches the wrong thing about the product:
 *
 *   • **Nothing is uniform.** Every filter in the module — stage, status,
 *     assignee, reviewer, priority, overdue, blocked, changes-requested — has
 *     to have something on both sides of it, or a reviewer of this demo cannot
 *     tell a working filter from a broken one.
 *
 *   • **No empty records.** An outline is a real outline, a script is real
 *     narration, a deck has real slides. A demo full of `Lorem ipsum` proves the
 *     tables exist and nothing else.
 *
 * Development tooling. Nothing under `server/` imports this file.
 */

/* ── people ───────────────────────────────────────────────────────── */

/**
 * The production staff. These become workspace users with no password hash and
 * an address on the reserved `.invalid` domain — so none of them can sign in by
 * either route, and no notification can ever leave the building.
 */
export const PEOPLE = [
  { ref: 'hala', name: 'هالة مصطفى', title: 'مديرة إنتاج تعليمي', avatarColor: '#1D6FB8' },
  { ref: 'nour', name: 'نور الدين حسن', title: 'مصمم تعليمي', avatarColor: '#7C3AED' },
  { ref: 'khaled', name: 'خالد الفقي', title: 'خبير موضوع — صيانة', avatarColor: '#0E385E' },
  { ref: 'rania', name: 'رانيا سليم', title: 'كاتبة مخططات الدروس', avatarColor: '#0284C7' },
  { ref: 'ahmed', name: 'أحمد علي', title: 'مصمم عروض تقديمية', avatarColor: '#B45309' },
  { ref: 'mona', name: 'منى عبد الله', title: 'كاتبة سكريبت', avatarColor: '#F5821F' },
  { ref: 'sara', name: 'سارة عمر', title: 'مراجعة سكريبت', avatarColor: '#15803D' },
  { ref: 'omar', name: 'عمر سمير', title: 'معلّق صوتي', avatarColor: '#0369A1' },
  { ref: 'tarek', name: 'طارق منصور', title: 'مراجع صوت', avatarColor: '#6D28D9' },
  { ref: 'youssef', name: 'يوسف إبراهيم', title: 'محرر فيديو', avatarColor: '#BE123C' },
  { ref: 'amr', name: 'عمرو شاكر', title: 'محرر فيديو', avatarColor: '#12497A' },
  { ref: 'dina', name: 'دينا رأفت', title: 'مراجعة جودة', avatarColor: '#A8480A' },
];

/* ── the shape of a lesson's production ───────────────────────────── */

/**
 * A plan is the five statuses of one lesson, in stage order.
 *
 * They are named after what a production manager would call them, because that
 * is how the mix of a course is described below — "four done, one stuck in PPT
 * review, one that has not started" is a readable sentence and `['APPROVED',
 * 'APPROVED', …]` repeated ninety-nine times is not.
 */
export const PLANS = {
  LOCKED: ['LOCKED', 'LOCKED', 'LOCKED', 'LOCKED', 'LOCKED'],
  DONE: ['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'],
  VIDEO_REVIEW: ['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'UNDER_REVIEW'],
  VIDEO_WORK: ['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'IN_PROGRESS'],
  VIDEO_CHANGES: ['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'CHANGES_REQUESTED'],
  VOICE_REVIEW: ['APPROVED', 'APPROVED', 'APPROVED', 'RESUBMITTED', 'NOT_STARTED'],
  VOICE_WORK: ['APPROVED', 'APPROVED', 'APPROVED', 'IN_PROGRESS', 'NOT_STARTED'],
  PPT_REVIEW: ['APPROVED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS', 'NOT_STARTED'],
  PPT_CHANGES: ['APPROVED', 'CHANGES_REQUESTED', 'IN_PROGRESS', 'NOT_STARTED', 'NOT_STARTED'],
  SCRIPT_REVIEW: ['APPROVED', 'APPROVED', 'SUBMITTED', 'NOT_STARTED', 'NOT_STARTED'],
  SCRIPT_CHANGES: ['APPROVED', 'APPROVED', 'CHANGES_REQUESTED', 'IN_PROGRESS', 'NOT_STARTED'],
  SCRIPT_WORK: ['APPROVED', 'IN_PROGRESS', 'IN_PROGRESS', 'NOT_STARTED', 'NOT_STARTED'],
  OUTLINE_REVIEW: ['UNDER_REVIEW', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED'],
  EARLY: ['IN_PROGRESS', 'ASSIGNED', 'ASSIGNED', 'NOT_STARTED', 'NOT_STARTED'],
  NOT_STARTED: ['NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED'],
};

/* ── courses ──────────────────────────────────────────────────────── */

/**
 * Seven courses, chosen to put every course-health state on the screen at once:
 * one finished, three comfortable, two at risk and one plainly late. `mix` is
 * the repertoire of lesson plans the course cycles through, and `overrides`
 * pins the handful of lessons whose exact state is worth showing to somebody
 * being given a tour.
 *
 * `lateness` is the share of a course's *open* work that is past its due date,
 * and it is what decides health: the module calls a course Delayed above ten
 * per cent (`delayedOverdueShare`), so the numbers here are chosen either side
 * of that line rather than left to chance.
 */
export const COURSES = [
  {
    ref: 'cmrp',
    name: 'CMRP Certification',
    code: 'CMRP-01',
    description:
      'Preparation programme for the Certified Maintenance & Reliability Professional exam, covering the five pillars of the SMRP body of knowledge with worked plant examples throughout.',
    subject: 'maintenance and reliability',
    cover: { from: [11, 37, 69], to: [29, 111, 184], band: { top: 0.58, height: 0.1, color: [245, 130, 31] } },
    managerRef: 'viewer',
    priority: 'HIGH',
    // Far enough into the course that 62% finished reads as behind the line —
    // this is the At Risk exhibit.
    startOffset: -140,
    targetOffset: 20,
    lateness: 0.07,
    mix: ['LOCKED', 'DONE', 'VIDEO_REVIEW', 'VOICE_WORK', 'DONE', 'VOICE_REVIEW', 'PPT_REVIEW', 'SCRIPT_CHANGES', 'VIDEO_CHANGES', 'EARLY', 'PPT_CHANGES', 'NOT_STARTED'],
    overrides: {
      'Maintenance KPIs': 'PPT_REVIEW',
      'MTBF & MTTR': 'PPT_CHANGES',
      'Preventive Maintenance': 'DONE',
      'Failure Analysis': 'OUTLINE_REVIEW',
      'Asset Reliability': 'SCRIPT_CHANGES',
      'Introduction to Maintenance Strategy': 'VIDEO_REVIEW',
    },
    team: {
      hala: ['COURSE_MANAGER'],
      khaled: ['SUBJECT_MATTER_EXPERT'],
      rania: ['OUTLINE_WRITER'],
      ahmed: ['PPT_DESIGNER'],
      mona: ['SCRIPT_WRITER'],
      sara: ['SCRIPT_WRITER', 'QUALITY_REVIEWER'],
      omar: ['VOICE_OVER_ARTIST'],
      tarek: ['AUDIO_REVIEWER'],
      youssef: ['VIDEO_EDITOR'],
      dina: ['QUALITY_REVIEWER'],
    },
    defaults: {
      OUTLINE: ['rania', 'khaled'],
      PPT: ['ahmed', 'nour'],
      SCRIPT: ['mona', 'sara'],
      VOICE_OVER: ['omar', 'tarek'],
      VIDEO: ['youssef', 'dina'],
    },
    modules: [
      {
        name: 'Module 01 — Maintenance Strategy',
        lessons: ['Introduction to Maintenance Strategy', 'Maintenance Objectives', 'Business Impact of Maintenance', 'Maintenance Strategy Selection', 'Asset Criticality Ranking'],
      },
      {
        name: 'Module 02 — Maintenance Performance',
        lessons: ['Maintenance KPIs', 'MTBF & MTTR', 'Availability', 'OEE Fundamentals', 'Benchmarking Maintenance Performance'],
      },
      {
        name: 'Module 03 — Reliability',
        lessons: ['Asset Reliability', 'Failure Analysis', 'Failure Modes and Effects Analysis', 'RCM Fundamentals', 'Weibull Analysis Basics', 'Root Cause Analysis'],
      },
      {
        name: 'Module 04 — Work Management',
        lessons: ['Work Order Management', 'Maintenance Planning', 'Maintenance Scheduling', 'Backlog Management', 'Shutdown & Turnaround Planning'],
      },
      {
        name: 'Module 05 — Asset Management',
        lessons: ['Preventive Maintenance', 'Predictive Maintenance', 'Inventory Optimization', 'Spare Parts Strategy', 'Asset Life Cycle Costing'],
      },
    ],
  },
  {
    ref: 'mech',
    name: 'Mechanical Design Fundamentals',
    code: 'MECH-02',
    description: 'From drawing standards to machine elements and stress analysis — the design skills a mechanical engineer uses in the first three years on the job.',
    subject: 'mechanical design',
    cover: { from: [14, 56, 94], to: [74, 143, 203], band: { top: 0.3, height: 0.08, color: [216, 233, 247] } },
    managerRef: 'hala',
    priority: 'NORMAL',
    startOffset: -54,
    targetOffset: 62,
    lateness: 0,
    mix: ['DONE', 'VIDEO_REVIEW', 'DONE', 'VOICE_WORK', 'PPT_REVIEW', 'SCRIPT_WORK', 'DONE', 'EARLY'],
    overrides: { 'Shaft Design': 'VIDEO_WORK', 'Bearings and Lubrication': 'SCRIPT_REVIEW' },
    team: {
      nour: ['INSTRUCTIONAL_DESIGNER'],
      khaled: ['SUBJECT_MATTER_EXPERT'],
      ahmed: ['PPT_DESIGNER'],
      mona: ['SCRIPT_WRITER'],
      omar: ['VOICE_OVER_ARTIST'],
      amr: ['VIDEO_EDITOR'],
      dina: ['QUALITY_REVIEWER'],
      viewer: ['QUALITY_REVIEWER'],
    },
    defaults: {
      OUTLINE: ['nour', 'khaled'],
      PPT: ['ahmed', 'hala'],
      SCRIPT: ['mona', 'sara'],
      VOICE_OVER: ['omar', 'tarek'],
      VIDEO: ['amr', 'viewer'],
    },
    modules: [
      { name: 'Module 01 — Design Basics', lessons: ['Engineering Drawing Standards', 'Tolerances and Fits', 'Material Selection', 'Design for Manufacturing'] },
      { name: 'Module 02 — Machine Elements', lessons: ['Shaft Design', 'Bearings and Lubrication', 'Gears and Gear Trains', 'Couplings and Clutches'] },
      { name: 'Module 03 — Stress and Strength', lessons: ['Stress Analysis Fundamentals', 'Fatigue and Endurance', 'Failure Theories', 'Finite Element Basics'] },
      { name: 'Module 04 — Applied Design', lessons: ['Pressure Vessel Basics', 'Piping Layout Essentials', 'Vibration in Rotating Machines', 'Design Review Practices'] },
    ],
  },
  {
    ref: 'pmp',
    name: 'PMP Essentials',
    code: 'PMP-03',
    description: 'A condensed path through the PMBOK knowledge areas for engineers sitting the PMP exam, built around one running construction case study.',
    subject: 'project management',
    cover: { from: [18, 73, 122], to: [247, 155, 74], band: { top: 0.66, height: 0.14, color: [11, 37, 69] } },
    managerRef: 'nour',
    priority: 'URGENT',
    startOffset: -96,
    targetOffset: -6,
    // The late course: its decks and its scripts have both slipped.
    lateness: 0.12,
    lateStages: ['PPT', 'SCRIPT'],
    mix: ['PPT_CHANGES', 'SCRIPT_CHANGES', 'OUTLINE_REVIEW', 'EARLY', 'VOICE_WORK', 'NOT_STARTED', 'PPT_REVIEW'],
    overrides: { 'Earned Value Management': 'VIDEO_CHANGES', 'Project Closure': 'NOT_STARTED' },
    team: {
      nour: ['COURSE_MANAGER', 'INSTRUCTIONAL_DESIGNER'],
      rania: ['OUTLINE_WRITER'],
      ahmed: ['PPT_DESIGNER'],
      sara: ['SCRIPT_WRITER'],
      omar: ['VOICE_OVER_ARTIST'],
      youssef: ['VIDEO_EDITOR'],
      viewer: ['PPT_DESIGNER', 'QUALITY_REVIEWER'],
    },
    defaults: {
      OUTLINE: ['rania', 'nour'],
      PPT: ['viewer', 'nour'],
      SCRIPT: ['sara', 'mona'],
      VOICE_OVER: ['omar', 'tarek'],
      VIDEO: ['youssef', 'dina'],
    },
    modules: [
      { name: 'Module 01 — Framework', lessons: ['Project Management Foundations', 'Project Life Cycle', 'Organizational Influences'] },
      { name: 'Module 02 — Planning', lessons: ['Scope Management', 'Schedule Development', 'Cost Estimating', 'Risk Planning'] },
      { name: 'Module 03 — Execution', lessons: ['Team Leadership', 'Stakeholder Engagement', 'Quality Management'] },
      { name: 'Module 04 — Control and Close', lessons: ['Earned Value Management', 'Change Control', 'Procurement Basics', 'Project Closure'] },
    ],
  },
  {
    ref: 'rel',
    name: 'Reliability Engineering',
    code: 'REL-04',
    description: 'Reliability mathematics and the condition-monitoring techniques that turn it into maintenance decisions on real rotating equipment.',
    subject: 'reliability engineering',
    cover: { from: [11, 37, 69], to: [124, 58, 237], band: { top: 0.42, height: 0.1, color: [216, 233, 247] } },
    managerRef: 'khaled',
    priority: 'NORMAL',
    startOffset: -40,
    targetOffset: 74,
    lateness: 0.03,
    mix: ['DONE', 'VIDEO_REVIEW', 'VOICE_WORK', 'PPT_REVIEW', 'DONE', 'EARLY'],
    overrides: { 'Vibration Analysis': 'VOICE_REVIEW', 'Thermography': 'NOT_STARTED' },
    team: {
      khaled: ['COURSE_MANAGER', 'SUBJECT_MATTER_EXPERT'],
      rania: ['OUTLINE_WRITER'],
      ahmed: ['PPT_DESIGNER'],
      mona: ['SCRIPT_WRITER'],
      omar: ['VOICE_OVER_ARTIST'],
      tarek: ['AUDIO_REVIEWER'],
      amr: ['VIDEO_EDITOR'],
      dina: ['QUALITY_REVIEWER'],
    },
    defaults: {
      OUTLINE: ['rania', 'khaled'],
      PPT: ['ahmed', 'hala'],
      SCRIPT: ['mona', 'sara'],
      VOICE_OVER: ['omar', 'tarek'],
      VIDEO: ['amr', 'dina'],
    },
    modules: [
      { name: 'Module 01 — Reliability Basics', lessons: ['Reliability Fundamentals', 'Probability Distributions in Reliability', 'The Bathtub Curve'] },
      { name: 'Module 02 — Analysis Methods', lessons: ['FMEA in Practice', 'Fault Tree Analysis', 'Reliability Block Diagrams', 'Weibull Data Analysis'] },
      { name: 'Module 03 — Applied Reliability', lessons: ['Condition Monitoring', 'Vibration Analysis', 'Oil Analysis', 'Thermography', 'Reliability Improvement Programmes'] },
    ],
  },
  {
    ref: 'hvac',
    name: 'HVAC Design Fundamentals',
    code: 'HVAC-05',
    description: 'Load calculation, air and water distribution, and the controls that decide whether an HVAC design performs the way it was drawn.',
    subject: 'HVAC design',
    cover: { from: [14, 56, 94], to: [2, 132, 199], band: { top: 0.24, height: 0.12, color: [255, 255, 255] } },
    managerRef: 'hala',
    priority: 'NORMAL',
    startOffset: -34,
    targetOffset: 21,
    lateness: 0.08,
    mix: ['PPT_REVIEW', 'SCRIPT_CHANGES', 'EARLY', 'VOICE_WORK', 'NOT_STARTED', 'DONE'],
    overrides: { 'Duct Design': 'PPT_CHANGES', 'Psychrometrics Basics': 'DONE' },
    team: {
      hala: ['COURSE_MANAGER'],
      nour: ['INSTRUCTIONAL_DESIGNER'],
      rania: ['OUTLINE_WRITER'],
      ahmed: ['PPT_DESIGNER'],
      mona: ['SCRIPT_WRITER'],
      omar: ['VOICE_OVER_ARTIST'],
      youssef: ['VIDEO_EDITOR'],
    },
    defaults: {
      OUTLINE: ['rania', 'nour'],
      PPT: ['ahmed', 'hala'],
      SCRIPT: ['mona', 'sara'],
      VOICE_OVER: ['omar', 'tarek'],
      VIDEO: ['youssef', 'dina'],
    },
    modules: [
      { name: 'Module 01 — Load and Psychrometrics', lessons: ['Psychrometrics Basics', 'Cooling Load Calculation', 'Heating Load Calculation', 'Ventilation Requirements'] },
      { name: 'Module 02 — Systems', lessons: ['Air Distribution Systems', 'Chilled Water Systems', 'Duct Design', 'Fan and Pump Selection'] },
      { name: 'Module 03 — Controls and Efficiency', lessons: ['HVAC Controls', 'Energy Efficiency in HVAC', 'Indoor Air Quality', 'Commissioning HVAC Systems'] },
    ],
  },
  {
    ref: 'plan',
    name: 'Planning & Scheduling',
    code: 'PLAN-06',
    description: 'Building a schedule that survives contact with a site: breakdown, sequencing, the critical path, and how progress is actually measured.',
    subject: 'planning and scheduling',
    cover: { from: [18, 73, 122], to: [21, 128, 61], band: { top: 0.5, height: 0.09, color: [216, 233, 247] } },
    managerRef: 'hala',
    priority: 'LOW',
    startOffset: -18,
    targetOffset: 96,
    lateness: 0,
    mix: ['DONE', 'VOICE_REVIEW', 'PPT_REVIEW', 'EARLY', 'NOT_STARTED'],
    overrides: { 'Critical Path Method': 'VIDEO_REVIEW' },
    team: {
      hala: ['COURSE_MANAGER'],
      rania: ['OUTLINE_WRITER'],
      ahmed: ['PPT_DESIGNER'],
      mona: ['SCRIPT_WRITER'],
      omar: ['VOICE_OVER_ARTIST'],
      amr: ['VIDEO_EDITOR'],
      viewer: ['QUALITY_REVIEWER'],
    },
    defaults: {
      // The viewer writes the outlines here and reviews the decks — the two
      // halves of "My Work", so neither list is a stranger's.
      OUTLINE: ['viewer', 'nour'],
      PPT: ['ahmed', 'viewer'],
      SCRIPT: ['mona', 'sara'],
      VOICE_OVER: ['omar', 'tarek'],
      VIDEO: ['amr', 'dina'],
    },
    modules: [
      { name: 'Module 01 — Foundations', lessons: ['Planning Fundamentals', 'Work Breakdown Structure', 'Activity Definition'] },
      { name: 'Module 02 — Scheduling', lessons: ['Network Diagrams', 'Critical Path Method', 'Resource Levelling', 'Schedule Baselines'] },
      { name: 'Module 03 — Control', lessons: ['Progress Measurement', 'Schedule Updating', 'Delay Analysis'] },
    ],
  },
  {
    ref: 'ctrl',
    name: 'Project Controls',
    code: 'CTRL-07',
    description: 'Cost control, earned value and the reporting pack — delivered, approved and locked. Kept in the catalogue as the reference for a finished course.',
    subject: 'project controls',
    cover: { from: [11, 37, 69], to: [21, 128, 61], band: { top: 0.7, height: 0.1, color: [232, 247, 238] } },
    managerRef: 'nour',
    priority: 'NORMAL',
    startOffset: -150,
    targetOffset: -30,
    lateness: 0,
    mix: ['LOCKED'],
    overrides: {},
    team: {
      nour: ['COURSE_MANAGER'],
      rania: ['OUTLINE_WRITER'],
      ahmed: ['PPT_DESIGNER'],
      sara: ['SCRIPT_WRITER'],
      omar: ['VOICE_OVER_ARTIST'],
      youssef: ['VIDEO_EDITOR'],
      dina: ['QUALITY_REVIEWER'],
    },
    defaults: {
      OUTLINE: ['rania', 'nour'],
      PPT: ['ahmed', 'nour'],
      SCRIPT: ['sara', 'mona'],
      VOICE_OVER: ['omar', 'tarek'],
      VIDEO: ['youssef', 'dina'],
    },
    modules: [
      { name: 'Module 01 — Cost Control', lessons: ['Cost Breakdown Structure', 'Budgeting Basics', 'Cost Forecasting'] },
      { name: 'Module 02 — Performance', lessons: ['Earned Value Basics', 'Variance Analysis', 'Productivity Measurement'] },
      { name: 'Module 03 — Reporting', lessons: ['Dashboards and Reports', 'Change Management', 'Lessons Learned'] },
    ],
  },
];

/* ── authored content ─────────────────────────────────────────────── */

/**
 * The lessons somebody will actually open during a tour, written out in full.
 * Every other lesson gets the generated content below, which is templated but
 * never empty.
 */
const AUTHORED = {
  'Maintenance KPIs': {
    objectives: [
      'Explain the purpose of maintenance KPIs and who each one is for.',
      'Distinguish leading indicators from lagging indicators.',
      'Calculate MTBF and MTTR from a set of failure records.',
      'Interpret equipment availability and say what it does not tell you.',
    ],
    topics: ['Reliability metrics', 'Maintenance performance', 'MTBF', 'MTTR', 'Availability', 'Planned versus unplanned downtime'],
    definitions: [
      'MTBF — mean operating time between failures of a repairable asset.',
      'MTTR — mean time to restore an asset to service after a failure.',
      'Availability — the share of required time an asset is able to perform.',
    ],
    examples: ['A packaging line that lost 42 hours in one month across nine stoppages, and what its MTBF and MTTR say about where to look first.'],
    exercises: ['Calculate MTBF, MTTR and availability from the supplied failure log for pump P-101, then rank the three assets by which to investigate first.'],
    references: ['SMRP Best Practices, 6th edition', 'CMRP Body of Knowledge — Pillar 3', 'EN 15341 Maintenance Key Performance Indicators'],
    duration: '18 minutes',
    instructorNotes: 'Learners consistently confuse availability with reliability. Spend the extra two minutes on the packaging-line example before moving on.',
    productionNotes: 'Slide 4 needs the KPI dashboard mock-up from the brand library. Keep the MTBF formula on screen while the narrator reads it.',
    script: [
      {
        title: 'Why maintenance KPIs matter',
        narration:
          'Maintenance KPIs exist to answer one question: is the maintenance we are doing making the plant more reliable? Without them, a maintenance department can be extremely busy and still be losing ground. In this lesson we will look at the handful of indicators that actually change decisions, and at how each one is calculated from records you already have.',
        visual: 'Open on a plant-wide KPI dashboard; highlight the four tiles we will cover.',
        seconds: 26,
      },
      {
        title: 'Leading and lagging indicators',
        narration:
          'A lagging indicator tells you what already happened — how many breakdowns there were last month. A leading indicator tells you what is likely to happen next — how much of this month\'s planned work was completed on schedule. A programme measured only by lagging indicators is always reacting; one measured only by leading indicators is congratulating itself. You need both.',
        visual: 'Split screen: rear-view mirror against a windscreen, then the two lists of example indicators.',
        seconds: 31,
      },
      {
        title: 'Calculating MTBF',
        narration:
          'Mean time between failures is total operating time divided by the number of failures in that time. If a pump ran for nine hundred hours and failed three times, its MTBF is three hundred hours. The arithmetic is simple; the discipline is in agreeing what counts as operating time and what counts as a failure, and applying that definition the same way every month.',
        visual: 'Animate the formula, then substitute the pump figures step by step.',
        seconds: 29,
      },
      {
        title: 'Calculating MTTR',
        narration:
          'Mean time to repair is the total downtime caused by failures divided by the number of those failures. It measures the response, not the asset. A rising MTTR with a steady MTBF usually points at spare-part availability or at the time it takes to get a technician to the equipment, rather than at the equipment itself.',
        visual: 'Timeline of one failure event, with the repair window shaded.',
        seconds: 27,
      },
      {
        title: 'Reading availability',
        narration:
          'Availability combines the two: uptime divided by required time. It is the number a plant manager asks for, and it hides everything interesting. Ninety-two per cent availability from two long shutdowns is a different plant from ninety-two per cent availability from forty short stoppages, and the two need completely different maintenance responses.',
        visual: 'Two bar charts with identical totals and very different shapes.',
        seconds: 30,
      },
    ],
  },
  'MTBF & MTTR': {
    objectives: [
      'Derive MTBF and MTTR from a maintenance work-order history.',
      'Recognise the data-quality problems that make both numbers misleading.',
      'Use the pair together to separate asset problems from process problems.',
    ],
    topics: ['Failure records', 'Operating time', 'Downtime classification', 'Data quality', 'Trend analysis'],
    definitions: ['Operating time — the time an asset was required to run and was running.', 'Downtime — the time an asset was required to run and could not.'],
    examples: ['Two conveyors with the same availability, one with an MTBF problem and one with an MTTR problem.'],
    exercises: ['Clean the supplied work-order extract, then recalculate MTBF for the compressor fleet before and after the cleanup.'],
    references: ['SMRP Best Practices — Metric 5.4.1', 'ISO 14224 Collection and exchange of reliability data'],
    duration: '20 minutes',
    instructorNotes: 'The cleanup exercise is the point of the lesson. Do not let it be skipped for time.',
    productionNotes: 'Needs the work-order extract as a downloadable file next to the video.',
  },
  'Preventive Maintenance': {
    objectives: [
      'Decide when a preventive task is worth doing at all.',
      'Set a task interval from failure data rather than from the manual.',
      'Write a PM task that a technician can actually follow.',
    ],
    topics: ['Task selection', 'Interval setting', 'PM optimisation', 'Task instructions', 'Compliance measurement'],
    definitions: ['Preventive maintenance — work carried out at a fixed interval to reduce the probability of failure.'],
    examples: ['A monthly greasing route that was costing more than the failures it prevented.'],
    exercises: ['Review the supplied PM programme for a fan and remove every task that cannot be justified.'],
    references: ['CMRP Body of Knowledge — Pillar 4', 'Nowlan & Heap, Reliability-Centered Maintenance'],
    duration: '16 minutes',
    instructorNotes: 'Expect resistance to removing tasks. The cost argument lands better than the reliability argument.',
    productionNotes: 'Reuse the greasing-route footage from the reliability course.',
  },
  'Introduction to Maintenance Strategy': {
    objectives: [
      'Describe what a maintenance strategy is and what it is not.',
      'Place run-to-failure, preventive and predictive work on the same map.',
      'Connect a maintenance strategy to a business objective.',
    ],
    topics: ['Strategy versus tactics', 'Maintenance types', 'Business alignment', 'Asset criticality'],
    definitions: ['Maintenance strategy — the set of decisions about which maintenance is done on which assets, and why.'],
    examples: ['A bottling plant that moved half its fleet to run-to-failure and improved availability.'],
    exercises: ['Classify the twelve assets in the supplied register by the maintenance approach each one deserves.'],
    references: ['SMRP Best Practices — Pillar 1', 'EN 13306 Maintenance terminology'],
    duration: '12 minutes',
    instructorNotes: 'This is the first lesson in the course — set the tone and keep it non-technical.',
    productionNotes: 'Opening title sequence from the course brand pack.',
  },
  'Failure Analysis': {
    objectives: [
      'Separate the failure mode from the failure cause.',
      'Run a structured failure analysis on a repeat offender.',
      'Turn the finding into a change somebody is accountable for.',
    ],
    topics: ['Failure modes', 'Evidence collection', 'Five whys', 'Fishbone analysis', 'Corrective action'],
    definitions: ['Failure mode — the way in which an asset fails to perform its function.'],
    examples: ['A bearing that had failed four times in a year for three different reasons.'],
    exercises: ['Work through the supplied failure report and identify the point at which the analysis stopped too early.'],
    references: ['CMRP Body of Knowledge — Pillar 3', 'Latino, Root Cause Analysis'],
    duration: '22 minutes',
    instructorNotes: 'Bring a failed component to the session if one is available.',
    productionNotes: 'Outline still with the subject-matter expert — do not start the deck until it is approved.',
  },
  'Asset Reliability': {
    objectives: [
      'Define reliability in terms a plant team can measure.',
      'Relate reliability to availability, maintainability and cost.',
      'Identify the few assets where reliability work pays for itself.',
    ],
    topics: ['Reliability definition', 'Criticality', 'Failure rate', 'Cost of unreliability'],
    definitions: ['Reliability — the probability that an asset performs its function for a stated period under stated conditions.'],
    examples: ['Ranking a fleet of twenty pumps by cost of unreliability rather than by failure count.'],
    exercises: ['Calculate the annual cost of unreliability for the three assets in the supplied case.'],
    references: ['SMRP Best Practices — Metric 3.1', 'CMRP Body of Knowledge — Pillar 3'],
    duration: '19 minutes',
    instructorNotes: 'The cost ranking usually surprises people. Let them do it before showing the answer.',
    productionNotes: 'Script is back from review with changes — the ranking table needs to be on screen for the whole of scene 4.',
  },
};

/* ── generated content ────────────────────────────────────────────── */

const VERBS = ['Explain', 'Identify', 'Apply', 'Compare', 'Interpret', 'Evaluate'];

function generatedObjectives(lesson, subject) {
  return [
    `Explain what ${lesson} means in the context of ${subject}.`,
    `Identify the data and conditions ${lesson} depends on.`,
    `Apply ${lesson} to a worked example from an operating plant.`,
    `Interpret the result and decide what action it justifies.`,
  ];
}

/** The outline of one lesson: authored where it matters, templated elsewhere. */
export function outlineFor(lessonName, course) {
  const authored = AUTHORED[lessonName];
  const objectives = authored?.objectives ?? generatedObjectives(lessonName, course.subject);
  const topics = authored?.topics ?? [`${lessonName} — principles`, `${lessonName} — method`, `${lessonName} — worked example`, `Common mistakes in ${lessonName.toLowerCase()}`];
  return {
    sections: {
      lessonTitle: lessonName,
      learningObjectives: objectives.map((line) => `• ${line}`).join('\n'),
      keyTopics: topics.map((line) => `• ${line}`).join('\n'),
      definitions: (authored?.definitions ?? [`${lessonName} — the working definition used throughout this course.`]).map((line) => `• ${line}`).join('\n'),
      examples: (authored?.examples ?? [`A plant example in which ${lessonName.toLowerCase()} changed the decision that was made.`]).join('\n'),
      exercises: (authored?.exercises ?? [`Apply ${lessonName.toLowerCase()} to the data set supplied with this lesson and justify your answer in two sentences.`]).join('\n'),
      caseStudies: `Case study: ${lessonName} at a mid-size ${course.subject} operation.`,
      references: (authored?.references ?? [`${course.name} — course reference pack`, 'SMRP Best Practices, 6th edition']).map((line) => `• ${line}`).join('\n'),
      estimatedDuration: authored?.duration ?? '15 minutes',
      instructorNotes: authored?.instructorNotes ?? `Keep the worked example on screen while the learners attempt the exercise.`,
      productionNotes: authored?.productionNotes ?? `Standard course template. Diagrams from the ${course.code} asset pack.`,
    },
  };
}

/** The narration script: several blocks, each with its own visual direction. */
export function scriptFor(lessonName, course) {
  const authored = AUTHORED[lessonName];
  const blocks = authored?.script
    ? authored.script
    : (authored?.objectives ?? generatedObjectives(lessonName, course.subject)).map((objective, index) => ({
        title: index === 0 ? `Introducing ${lessonName}` : `${VERBS[index % VERBS.length]}: ${lessonName}`,
        narration:
          index === 0
            ? `In this lesson we look at ${lessonName.toLowerCase()} — what it is, where the numbers come from, and what a ${course.subject} team does differently once it has them. By the end you will be able to ${objective.replace(/^[A-Z]/, (character) => character.toLowerCase())}`
            : `${objective} We will work through it on a real set of plant data rather than on a textbook example, because the difficulty in practice is almost never the arithmetic — it is deciding which records belong in the calculation in the first place.`,
        visual: index === 0 ? 'Title card, then the lesson agenda.' : `Diagram: ${lessonName.toLowerCase()}, step ${index}.`,
        seconds: 22 + ((index * 7) % 14),
      }));

  return {
    mode: 'SLIDE',
    blocks: blocks.map((block, index) => ({
      id: `b${index + 1}`,
      title: block.title,
      narration: block.narration,
      visual: block.visual,
      pronunciation: index === 0 ? 'Read the course code as letters: C-M-R-P.' : '',
      pauses: index === 0 ? 'Half-second pause after the title card.' : '',
      emphasis: '',
      notes: '',
      manualDurationSeconds: block.seconds ?? null,
    })),
  };
}

/** The slides a PPT version contains — built from the outline, like a real deck. */
export function slidesFor(lessonName, course) {
  const outline = outlineFor(lessonName, course);
  const objectives = outline.sections.learningObjectives.split('\n').map((line) => line.replace(/^•\s*/, ''));
  const topics = outline.sections.keyTopics.split('\n').map((line) => line.replace(/^•\s*/, ''));
  const slides = [
    { title: lessonName, bullets: [course.name, `Module reference ${course.code}`] },
    { title: 'Learning objectives', bullets: objectives.slice(0, 4) },
    { title: 'Key topics', bullets: topics.slice(0, 4) },
  ];
  topics.slice(0, 4).forEach((topic, index) => {
    slides.push({
      title: topic,
      bullets: [`Definition and scope`, `Where the data comes from`, `Worked example ${index + 1}`],
    });
  });
  slides.push({ title: 'Worked example', bullets: [outline.sections.examples.slice(0, 70)] });
  slides.push({ title: 'Exercise', bullets: [outline.sections.exercises.slice(0, 70)] });
  slides.push({ title: 'Summary', bullets: objectives.slice(0, 3) });
  return slides;
}

/* ── review conversation ──────────────────────────────────────────── */

/** Comments a reviewer leaves on a deck, by slide. */
export const PPT_COMMENTS = [
  { page: 4, body: 'Increase the definition text size — it is unreadable on a phone.', anchor: { x: 0.18, y: 0.42 } },
  { page: 7, body: 'Align the KPI figures with the column above them.', anchor: { x: 0.62, y: 0.55 } },
  { page: 11, body: 'Replace the chart labels with the agreed terminology.', anchor: { x: 0.34, y: 0.28 } },
  { page: 2, body: 'Objective three repeats objective one. Merge them.', anchor: { x: 0.25, y: 0.6 } },
];

/** Comments a reviewer leaves on a recording, by timestamp. */
export const VOICE_COMMENTS = [
  { start: 74, end: null, body: 'Pronunciation of "reliability" needs correcting here.' },
  { start: 162, end: 169, body: 'Delivery is too fast through this passage — take it down a notch.' },
  { start: 24, end: null, body: 'Good energy on the opening. Keep this level for the rest.', resolved: true },
];

/** Comments a reviewer leaves on a cut, by timestamp. */
export const VIDEO_COMMENTS = [
  { start: 134, end: null, body: 'Move this title lower — it collides with the safe area.' },
  { start: 272, end: 279, body: 'Audio synchronisation is slightly late from here to the cut.' },
  { start: 38, end: null, body: 'Brand bug is the old version. Swap it for the 2025 mark.' },
];

/** A script reviewer's notes, by block. */
export const SCRIPT_COMMENTS = [
  { block: 'b2', body: 'This paragraph contradicts the outline — leading indicators are defined the other way round there.' },
  { block: 'b4', body: 'Shorten by about ten words so the narration fits the animation.', suggestion: 'Mean time to repair is total failure downtime divided by the number of failures. It measures the response, not the asset.' },
];

/** The QA checklist a finished video is signed off against. */
export const VIDEO_CHECKLIST = [
  { category: 'CONTENT_ACCURACY', label: 'Content accuracy', status: 'PASSED' },
  { category: 'VISUAL_QUALITY', label: 'Visual quality', status: 'PASSED' },
  { category: 'AUDIO_QUALITY', label: 'Audio quality', status: 'PASSED' },
  { category: 'SYNCHRONIZATION', label: 'Synchronization', status: 'ISSUE', notes: 'Drifts by about half a second after 04:30.' },
  { category: 'BRANDING', label: 'Branding', status: 'ISSUE', notes: 'Old brand mark in the opening title.' },
  { category: 'SPELLING', label: 'Spelling', status: 'PASSED' },
  { category: 'ANIMATIONS', label: 'Animations', status: 'PASSED' },
  { category: 'TRANSITIONS', label: 'Transitions', status: 'PENDING' },
  { category: 'TECHNICAL_QUALITY', label: 'Technical quality', status: 'PASSED' },
  { category: 'FINAL_APPROVAL', label: 'Final approval', status: 'PENDING' },
];

/** Version notes, so a version history reads like a conversation over time. */
export const VERSION_NOTES = {
  1: 'First draft for review.',
  2: 'Addressed the review comments from v1.',
  3: 'Second round of changes — figures and labels corrected.',
  4: 'Final pass after the quality review.',
};

export function blueprintTotals() {
  const lessons = COURSES.reduce((sum, course) => sum + course.modules.reduce((count, module) => count + module.lessons.length, 0), 0);
  return { courses: COURSES.length, people: PEOPLE.length, lessons, assets: lessons * 5 };
}
