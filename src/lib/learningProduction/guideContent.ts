/**
 * "How it works" — the business logic of E-Learning Production in plain
 * words, for the people who use it. Every rule here is one the server
 * enforces (see shared/learningProduction/runs.js and workflow.js); the stage
 * lists themselves are read live from the published templates, so they can
 * never drift from what a new run gets.
 */

type Pair = { ar: string; en: string };

export const GUIDE = {
  title: { ar: 'كيف يعمل إنتاج المحتوى', en: 'How production works' } as Pair,
  lede: {
    ar: 'كل ما يحدث لبرنامج تدريبي من أول بحث حتى نشره للمتعلمين، ومن يفعل ماذا، ومتى ينتقل العمل من خطوة لأخرى.',
    en: 'Everything that happens to a training program from the first research to publishing it for learners — who does what, and when work moves on.',
  } as Pair,

  model: {
    title: { ar: 'الفكرة كلها', en: 'The whole idea' } as Pair,
    boxes: [
      { title: { ar: 'الكورس', en: 'Course' }, body: { ar: 'هوية البرنامج الدائمة: اسمه وكوده وفريقه وتاريخه كله.', en: 'The program’s lasting identity: its name, code, team and full history.' } },
      { title: { ar: 'دورة الإنتاج', en: 'Production run' }, body: { ar: 'مرة واحدة ننتج فيها البرنامج أو نطوّره، بطريقة واحدة من ثلاث. للكورس دورة جارية واحدة فقط في كل وقت.', en: 'One effort to produce or revamp the program, in one of three ways. A course has one run in progress at a time.' } },
      { title: { ar: 'المراحل والمهام', en: 'Stages and tasks' }, body: { ar: 'عمل البرنامج: بحث، منهج، خبراء، تصميم، نشر، تجربة، اختبار قبول. تُنسخ من القالب عند بدء الدورة.', en: 'Program work: research, curriculum, experts, design, deployment, dry runs, UAT. Copied from the template when the run starts.' } },
      { title: { ar: 'الدروس وملفاتها', en: 'Lessons and their files' }, body: { ar: 'كل درس له خمسة ملفات تُصنع وتُراجع بالترتيب: المخطط، العرض، السكريبت، الصوت، الفيديو.', en: 'Each lesson has five files, made and reviewed in order: outline, slides, script, voice, video.' } },
      { title: { ar: 'الإصدار', en: 'Release' }, body: { ar: 'نسخة ثابتة من البرنامج تُعتمد وتُنشر. التطوير اللاحق يبدأ منها.', en: 'A fixed copy of the program, signed off and published. A later revamp starts from it.' } },
    ] as Array<{ title: Pair; body: Pair }>,
  },

  journey: {
    title: { ar: 'الرحلة من أ إلى ي', en: 'The journey, A to Z' } as Pair,
    steps: [
      { who: { ar: 'مدير الإنتاج', en: 'Production manager' }, what: { ar: 'يبدأ «دورة إنتاج جديدة»: يختار الطريقة، ويكتب اسم البرنامج والموعد، ويختار الفريق، ويراجع المراحل قبل الإنشاء.', en: 'Starts a “New production run”: picks the way, names the program and target date, chooses the team, reviews the stages before creating.' }, where: 'newRun' },
      { who: { ar: 'النظام', en: 'The system' }, what: { ar: 'ينشئ المراحل والمهام، ويسند كل مهمة لمن يحمل دورها (إن كان شخصًا واحدًا)، ويبلغ كل واحد بعمله.', en: 'Creates the stages and tasks, gives each task to the person holding its role (when there is one), and tells everyone about their work.' } },
      { who: { ar: 'كل عضو في الفريق', en: 'Every team member' }, what: { ar: 'يفتح «مهامي» فيجد في قائمة واحدة ما ينتظر قراره وما عليه الآن، وتحتها ما هو متوقف ولماذا. كل سطر يفتح مكان العمل مباشرة.', en: 'Opens “My tasks” to see, in one list, what waits for their decision and what is theirs now, with what cannot start yet (and why) folded underneath. Every row opens the exact place to act.' }, where: 'myWork' },
      { who: { ar: 'صاحب المهمة', en: 'Task owner' }, what: { ar: 'يعلّم بنود القائمة، ويرفق الدليل المطلوب (رابط أو ملف أو ملاحظة)، ثم «تم الإنجاز» أو «إرسال للاعتماد».', en: 'Ticks the checklist, attaches the evidence asked for (link, file or note), then “Mark done” or “Send for approval”.' } },
      { who: { ar: 'المعتمِد', en: 'Approver' }, what: { ar: 'يجد الطلب أعلى «مهامي» تحت «بانتظار قرارك» ويعتمد، أو يطلب تعديلًا مع ملاحظة. لا أحد يعتمد عمله بنفسه.', en: 'Finds it at the top of “My tasks”, under “Waiting for your decision”, and approves, or requests changes with a note. Nobody approves their own work.' }, where: 'reviews' },
      { who: { ar: 'مدير الإنتاج', en: 'Production manager' }, what: { ar: 'يضيف الدروس من صفحة الكورس («إضافة درس») عندما يتضح المنهج. تُسند ملفاتها تلقائيًا لمن اختاره في الفريق.', en: 'Adds the lessons from the course page (“Add lesson”) once the curriculum is clear. Their files go to the people chosen for the team.' } },
      { who: { ar: 'صنّاع المحتوى والمراجعون', en: 'Makers and reviewers' }, what: { ar: 'يصنع كل واحد ملفه ويرسله للمراجعة؛ المراجع يعلّق على الشريحة أو السطر أو الثانية ويعتمد أو يطلب تعديلًا.', en: 'Each maker produces their file and sends it for review; the reviewer comments on the slide, line or second and approves or requests changes.' }, where: 'production' },
      { who: { ar: 'عمليات التعلم', en: 'Learning operations' }, what: { ar: 'تنشر البرنامج على المنصة يدويًا وترفق الرابط دليلًا — لا يوجد ربط آلي بالمنصة.', en: 'Deploys the program on the platform by hand and attaches the link as evidence — there is no platform integration.' } },
      { who: { ar: 'الفريق ومختبرو القبول', en: 'Team and UAT testers' }, what: { ar: 'يجربون البرنامج كمتعلمين ويسجلون كل مشكلة. المشكلات العالية والحرجة تمنع الإصدار حتى تُصلح ويتحقق منها شخص آخر.', en: 'Try the program as learners and log every issue. High and critical issues hold the release until fixed and verified by someone else.' }, where: 'qa' },
      { who: { ar: 'المدير ثم شخص آخر', en: 'Manager, then someone else' }, what: { ar: 'عند تحقق كل شروط الجاهزية يجهّز المدير نسخة الإصدار، ويعتمدها شخص آخر، ثم يُسجَّل النشر برابط المنصة.', en: 'Once every readiness check is met, the manager prepares the release, someone else signs it off, then the publication is recorded with the platform link.' }, where: 'qa' },
    ] as Array<{ who: Pair; what: Pair; where?: 'newRun' | 'myWork' | 'reviews' | 'production' | 'qa' }>,
  },

  ways: {
    title: { ar: 'الطرق الثلاث', en: 'The three ways' } as Pair,
    body: {
      ar: 'هذه هي المراحل بالترتيب كما في القالب المنشور الآن. المرحلة تبدأ عندما تكتمل المراحل المكتوبة بعد «بعد:». المراحل المعلَّمة «مقترح» ليست في ملف العمل الأصلي.',
      en: 'These are the stages in order, as in the template published now. A stage starts once the stages listed after “after:” are done. Stages marked “proposal” are not in the original workbook.',
    } as Pair,
  },

  task: {
    title: { ar: 'حياة المهمة', en: 'A task’s life' } as Pair,
    states: [
      { label: { ar: 'بانتظار ما قبلها', en: 'Waiting' }, body: { ar: 'مرحلتها لم تبدأ، أو مهمة قبلها لم تنتهِ. تظهر في «متوقف على غيرك» مع السبب ومن يمسك السبب.', en: 'Its stage has not started, or a task before it is not finished. Listed under “Waiting on others” with the reason and who holds it.' } },
      { label: { ar: 'جاهزة', en: 'Ready' }, body: { ar: 'يمكن البدء الآن.', en: 'Can start now.' } },
      { label: { ar: 'قيد التنفيذ', en: 'In progress' }, body: { ar: 'صاحبها يعمل عليها: يعلّم البنود ويرفق الدليل.', en: 'Its owner is working: ticking lines, attaching evidence.' } },
      { label: { ar: 'بانتظار الاعتماد', en: 'Waiting for approval' }, body: { ar: 'أُرسلت مع دليلها. القرار يخص هذا الإرسال بالذات.', en: 'Sent with its evidence. The decision is about this exact submission.' } },
      { label: { ar: 'مطلوب تعديل', en: 'Changes requested' }, body: { ar: 'عادت مع ملاحظة. لإعادة الإرسال يجب إرفاق دليل جديد يعالج الملاحظة.', en: 'Came back with a note. Resubmitting needs new evidence that answers it.' } },
      { label: { ar: 'منجزة / معتمدة', en: 'Done / approved' }, body: { ar: 'انتهت. يمكن للمدير إعادة فتحها بسبب، ويبقى القرار القديم في السجل.', en: 'Finished. A manager can reopen it with a reason; the old decision stays in the history.' } },
      { label: { ar: 'تم تخطيها', en: 'Waived' }, body: { ar: 'خرجت من الحساب بسبب مكتوب. المهمة الشرطية يتخطاها المدير؛ المطلوبة يتخطاها مدير النظام فقط ويُسجَّل كتجاوز.', en: 'Left out with a written reason. A manager may waive conditional work; required work only an administrator, recorded as an override.' } },
    ] as Array<{ label: Pair; body: Pair }>,
    rules: [
      { ar: 'لا تكتمل المهمة قبل تعليم كل بنودها المطلوبة (أو جعل غير المنطبق «لا ينطبق» مع السبب).', en: 'A task cannot finish before every required line is ticked (or marked N/A with a reason).' },
      { ar: 'المهمة التي تطلب دليلًا لا تكتمل بدونه.', en: 'A task that asks for evidence cannot finish without it.' },
      { ar: 'المعتمِد دائمًا شخص غير من أرسل العمل.', en: 'The approver is always someone other than the sender.' },
      { ar: 'من يحمل دور المهمة يستطيع العمل عليها حتى لو لم تُسند له باسمه.', en: 'Whoever holds a task’s role can work on it even if it is not in their name.' },
      { ar: 'العمل الجاهز الذي بلا مسؤول يظهر لمدير الدورة في «مهامي» ليسنده.', en: 'Ready work with nobody on it appears in the run manager’s “My tasks” to be assigned.' },
    ] as Pair[],
  },

  lessons: {
    title: { ar: 'ملفات الدرس', en: 'A lesson’s files' } as Pair,
    order: [
      { ar: 'المخطط أولًا', en: 'Outline first' },
      { ar: 'ثم العرض التقديمي والسكريبت معًا', en: 'then slides and script, side by side' },
      { ar: 'ثم التعليق الصوتي بعد اعتماد السكريبت', en: 'then the voice-over, once the script is approved' },
      { ar: 'وأخيرًا الفيديو بعد اعتماد العرض والسكريبت والصوت', en: 'and last the video, once slides, script and voice are approved' },
    ] as Pair[],
    rules: [
      { ar: 'كل ملف: إسناد ← عمل ← إرسال للمراجعة ← اعتماد أو طلب تعديل ← نسخة جديدة وإعادة إرسال.', en: 'Each file: assign → work → submit for review → approve or request changes → a new version and resubmit.' },
      { ar: 'الملف الذي لم يأتِ دوره يظهر رماديًا «ينتظر …» — هذا ترتيب طبيعي وليس خطأ.', en: 'A file whose turn has not come shows grey “Waits for …” — that is the normal order, not an error.' },
      { ar: 'الفيديو لا يُعتمد قبل اجتياز بنود قائمة الجودة المطلوبة.', en: 'A video cannot be approved before its required QA checklist lines pass.' },
      { ar: 'الملف الذي لا يحتاجه درس يُجعل «لا ينطبق» مع السبب، فيخرج من الحساب وتبقى نسخه.', en: 'A file a lesson does not need is marked “not applicable” with a reason; it leaves the count and keeps its versions.' },
      { ar: 'ما يُصنع بأداة ذكاء اصطناعي يُعلَّم باسم الأداة، ويُراجع ويُعتمد كأي ملف آخر.', en: 'Anything made with an AI tool is labelled with the tool and is reviewed and approved like any other file.' },
    ] as Pair[],
  },

  stages: {
    title: { ar: 'متى تنتقل المرحلة', en: 'When a stage moves on' } as Pair,
    rules: [
      { ar: 'تبدأ المرحلة عندما تكتمل كل المراحل المكتوبة بعدها.', en: 'A stage starts when every stage it comes after is done.' },
      { ar: 'تكتمل المرحلة عندما تُنجز أو تُعتمد أو تُتخطى كل مهامها المطلوبة. المهام الاختيارية لا تؤخرها.', en: 'A stage is done when every required task is done, approved or waived. Optional tasks never hold it.' },
      { ar: 'بعض المهام «تلقائية»: تُحسب من الملفات نفسها، مثل «كل ملفات الدروس معتمدة» في مرحلة إنتاج الوسائط.', en: 'Some tasks are “automatic”: they are read from the files themselves, like “every lesson file approved” in media production.' },
      { ar: 'إعادة فتح مهمة في مرحلة مكتملة تعيد المرحلة «جارية» حتى تنتهي المهمة من جديد.', en: 'Reopening a task in a finished stage makes the stage “in progress” again until the task is finished again.' },
      { ar: 'مرحلة استقطاب الخبراء تُتخطى فقط إن كان هناك خبير متعاقد، مع ذكر السبب.', en: 'Expert acquisition is skipped only when an expert is already contracted, with the reason recorded.' },
    ] as Pair[],
  },

  release: {
    title: { ar: 'المشكلات والإصدار', en: 'Issues and the release' } as Pair,
    rules: [
      { ar: 'المشكلة تُسجَّل من بند في قائمة التجربة أو اختبار القبول، أو من زر «تسجيل مشكلة»، ولها خطورة ومسؤول.', en: 'An issue is logged from a dry-run or UAT checklist line, or with “Report an issue”, and has a severity and an owner.' },
      { ar: 'المسؤول يصلحها ويكتب ما أصلحه، ثم يتحقق منها شخص آخر (عادة من سجّلها).', en: 'The owner fixes it and writes what was fixed, then someone else verifies it (usually the reporter).' },
      { ar: 'الإصدار جاهز عندما: تكتمل كل المراحل قبله، وتُعتمد كل ملفات الدروس، ولا تبقى مشكلة عالية أو حرجة مفتوحة.', en: 'The release is ready when every stage before it is done, every lesson file is approved, and no high or critical issue is open.' },
      { ar: 'يجهّز المدير نسخة الإصدار، ويعتمدها شخص آخر، ثم يُسجَّل النشر برابط المنصة. لو تغيّر ملف معتمد بعد التجهيز فلا تُنشر النسخة.', en: 'The manager prepares the release, someone else signs it off, then the publication is recorded with the platform link. If an approved file changes after preparing, the candidate cannot be published.' },
      { ar: 'التطوير يبدأ من إصدار منشور ويسجل أثر التغيير: ما يبقى (يُحال لاعتماده القديم) وما يتغير (يُفتح ويحتاج اعتمادًا جديدًا) وما يُحذف.', en: 'A revamp starts from a published release and records the change impact: what stays (its old approval is referenced), what changes (reopens and needs new approval), what goes.' },
    ] as Pair[],
  },

  progress: {
    title: { ar: 'أرقام التقدم الأربعة', en: 'The four progress numbers' } as Pair,
    items: [
      { title: { ar: 'سير العمل', en: 'Workflow' }, body: { ar: 'كم من مهام المراحل المطلوبة انتهى.', en: 'How many of the required stage tasks are finished.' } },
      { title: { ar: 'محتوى الدروس', en: 'Lesson content' }, body: { ar: 'كم من ملفات الدروس معتمد. اكتماله لا يعني اكتمال البرنامج: النشر والتجربة واختبار القبول ما زالت باقية.', en: 'How many lesson files are approved. Complete content is not a complete program: deployment, dry runs and UAT are still to come.' } },
      { title: { ar: 'جاهزية الإصدار', en: 'Release readiness' }, body: { ar: 'هل تحققت شروط الإصدار، وأيها ما زال ناقصًا.', en: 'Whether the release conditions are met, and which are still missing.' } },
      { title: { ar: 'المنشور', en: 'Published' }, body: { ar: 'آخر إصدار نُشر فعلًا من هذه الدورة.', en: 'The last release actually published from this run.' } },
    ] as Array<{ title: Pair; body: Pair }>,
  },

  roles: {
    title: { ar: 'من يفعل ماذا', en: 'Who does what' } as Pair,
    body: {
      ar: 'الدور يُعطى لكل كورس عند اختيار الفريق. من يحمل دورًا يرى الكورس وعمله فيه فقط. بيانات المرشحين من الخبراء يراها منسق الخبراء ومدير الإنتاج ومدير النظام فقط.',
      en: 'Roles are given per course when the team is chosen. Holding a role lets a person see that course and their work in it. Expert candidates’ records are seen only by the expert coordinator, the production manager and administrators.',
    } as Pair,
    order: [
      'PRODUCTION_MANAGER',
      'COURSE_MANAGER',
      'RESEARCHER',
      'INSTRUCTIONAL_DESIGNER',
      'EXPERT_COORDINATOR',
      'TECHNICAL_CONSULTANT',
      'SUBJECT_MATTER_EXPERT',
      'TECHNICAL_PM',
      'OUTLINE_WRITER',
      'PPT_DESIGNER',
      'SCRIPT_WRITER',
      'VOICE_OVER_ARTIST',
      'VIDEO_EDITOR',
      'QUALITY_REVIEWER',
      'LEARNING_OPERATIONS',
      'MARKETING',
      'UAT_COORDINATOR',
      'UAT_TESTER',
      'VIEWER',
    ],
  },

  alerts: {
    title: { ar: 'التنبيهات', en: 'Notifications' } as Pair,
    body: {
      ar: 'تصل إلى جرس مساحة العمل: عند إسناد عمل لك، وطلب اعتماد منك، وطلب تعديل أو اعتماد عملك، وذكر اسمك، وبدء مرحلتك، واقتراب الموعد أو تجاوزه، والمشكلات والإصدارات. لا يصلك تنبيه عن فعل قمت به بنفسك، وتستطيع كتم أي نوع من قائمة «المزيد» ← «التنبيهات» في شريط الوحدة.',
      en: 'They arrive in the workspace bell: when work is assigned to you, an approval is asked of you, your work is approved or sent back, you are mentioned, your stage starts, a deadline is close or passed, and for issues and releases. You are never told about your own action, and you can mute any kind from the module bar’s “More” menu → Notifications.',
    } as Pair,
  },
};
