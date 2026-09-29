/**
 * E-Learning Production — how the workbook became the workflow.
 *
 * workflowTemplates.js cites the workbook row by row. This file holds the
 * rest: the rows no template uses and why, the anomalies found in the
 * workbook and how each was resolved, and the decisions still open for the
 * business owner.
 *
 * `server/learningProduction.templates.test.js` walks every populated row of
 * workbookSource.js and fails when a row is neither cited by a template nor
 * classified here — so a workbook change that adds a row cannot be silently
 * dropped. `scripts/generate-production-traceability.mjs` prints all of this as
 * docs/ELEARNING_PRODUCTION_TRACEABILITY.md.
 */

import { DETAIL_SHEETS, MASTER_ACTIVITIES } from './workbookSource.js';
import { SCENARIOS, SHEETS, TEMPLATE_OPTIONS, buildTemplate } from './workflowTemplates.js';

/** Rows deliberately not turned into work. Sheet furniture (Activity ID, Checklist) is recognised automatically. */
export const ROW_CLASSIFICATIONS = [
  {
    sheet: SHEETS.DEPLOY,
    rows: [12, 13, 14, 15, 16],
    classification: 'DUPLICATE',
    note: 'Hidden copy of the visible "Content Team Internal Dry Run" block (rows 3–7), word for word. The visible rows are used.',
  },
];

/**
 * The master sheet's own header cells. Row 2 is a header in the revamp and AI
 * columns but holds the Research activity in the new-program column.
 */
export const MASTER_HEADER_CELLS = ['A1:B1', 'D1:E1', 'G1:H1', 'D2:E2', 'G2:H2'];

/**
 * Anomalies in the workbook: naming errors, reused IDs, empty sheets. Each is
 * recorded rather than silently assumed, with how the templates resolved it.
 */
export const ANOMALIES = [
  {
    id: 'master-row9-label',
    where: 'Content Development Activities A9:B9',
    finding: 'The new-program row labelled "1st Draft Curriculum" carries activity ID new_first_run_8.',
    resolution:
      'Checked against the detail sheets: "First Dry Run" is headed new_first_run_8. Mapped to the First Internal Dry Run stage; the label is treated as a copy error.',
  },
  {
    id: 'ai-activity-ids',
    where: 'Content Development Activities G3:G13',
    finding:
      'The AI path reuses new-program activity IDs for different work (new_exp_3 = outline review, new_id_5 = scripts, new_id_7 = Docki slides), invents new_exp_6, and repeats the number 9 (new_id_9, new_media_9).',
    resolution: 'Activity IDs are kept as source references only. The system uses its own stable stage keys (AI_OUTLINE_REVIEW, AI_SCRIPTS, …).',
  },
  {
    id: 'uat-activity-id',
    where: 'User Acceptance Test B1',
    finding: 'The sheet\'s activity ID reads "new_res_1" (Research).',
    resolution: 'Mapped to the master sheet\'s new_uat_11 / rev_uat_8 by sheet name and content.',
  },
  {
    id: 'redeploy-sheet',
    where: 'Platform Deployment After Chang (whole sheet)',
    finding: 'The sheet name is truncated, its activity ID reads "new_res_1", and it has no checklist.',
    resolution: 'Stage kept (REDEPLOYMENT / inside APPLY_DRY_RUN_COMMENTS); its checklist is a proposal, labelled as such.',
  },
  {
    id: 'media-sheet',
    where: 'Media Production (whole sheet)',
    finding: 'Both checklists (new_media_6, upg_media_6) are empty. "upg_media_6" matches neither the master revamp ID (rev_media_2) nor any other.',
    resolution: 'Media production is the lesson asset pipeline from the original brief. The "upg" prefix is recorded, not used.',
  },
  {
    id: 'id-sheet',
    where: 'Instruction Designing',
    finding: 'The visible checklists under new_id_5 and rev_id_1 are empty; a third, hidden checklist (rows 25–37, with FALSE checkbox cells) has no activity ID of its own.',
    resolution:
      'The hidden block is a template candidate, activated as a labelled proposal through the option "idHiddenChecklist" (on by default). FALSE cells are never read as status.',
  },
  {
    id: 'deploy-hidden-block',
    where: 'Platform Deployment rows 11–41 (hidden)',
    finding: 'A second, hidden deployment checklist: a duplicate of rows 3–7, plus clone/versioning, hand-off to Learning Operations, codelabs, release setup and dry-run scheduling.',
    resolution:
      'Duplicates dropped; the rest activated as labelled proposals through "deployHiddenChecklist". Clone-from-latest-release (rows 17–20) is used only for revamps.',
  },
  {
    id: 'experts-duplicate-heading',
    where: 'Experts and Coaches Acquisition A11 and A14',
    finding: 'Two consecutive blocks are both headed "Technical Discussion"; the first describes reviewing script and technical samples.',
    resolution: 'The first is named "Review candidate samples"; the source text is kept on the item.',
  },
  {
    id: 'experts-community',
    where: 'Experts and Coaches Acquisition A37',
    finding: '"Experts Community Engaging" is a heading with no rows under it.',
    resolution: 'Kept as an optional task with no checklist; it never gates the stage.',
  },
  {
    id: 'final-curriculum-deliverables',
    where: 'Final Curriculum Details A17, A19, A20',
    finding: 'MCQs, Tasks and Projects are headings without checklists (row 18 is empty).',
    resolution: 'Each is an explicit deliverable task; its checklist is a proposal pending the business owner.',
  },
  {
    id: 'dry-run-empty-row',
    where: 'First Dry Run A22 and Final Curriculum Details A18',
    finding: 'Empty rows inside a block.',
    resolution: 'Ignored — nothing to trace.',
  },
  {
    id: 'uat-empty-merges',
    where: 'User Acceptance Test rows 36–64',
    finding: 'Eleven merged heading cells with no text (rows 36, 39, 40, 43, 46, 49, 52, 53, 56, 59, 62) — likely a removed "after UAT" section.',
    resolution: 'Nothing to trace. UAT sign-off is a labelled proposal.',
  },
  {
    id: 'revamp-stages-5-6',
    where: 'Content Development Activities D7:E8',
    finding:
      '"Applying Changes if Any" (rev_change_5) and "Applying Dry Run Comments" (rev_change_deploy_6) are both listed; the second\'s ID suggests redeployment, and neither has a sheet.',
    resolution: 'Kept as two distinct stages. The second fixes, verifies and redeploys; the first is conditional. Both checklists are pending the business owner.',
  },
  {
    id: 'ai-no-release',
    where: 'Content Development Activities G/H',
    finding: 'The AI path stops at "Check all comments": no deployment, dry run or UAT.',
    resolution: 'Deployment, UAT and release gates are added as a labelled proposal ("aiReleaseGates", on); a dry run is available but off ("aiDryRun").',
  },
  {
    id: 'external-tools',
    where: 'Content Development Activities H9, H10',
    finding: '"Docki" and "Think" are named, but no integration contract exists.',
    resolution: 'Both are manual handoffs with a link or file as evidence. No API is called or faked.',
  },
  {
    id: 'spelling',
    where: 'several sheets',
    finding:
      'Typos in source text: "Appllo.io", "jsutifications", "Audiance", "Journy", "Learninf", "tpoic", "Recieve", "marketting", "Lerning", "Clonning", "platforn", "Prerequsits", "professiency", "onbording".',
    resolution: 'Display labels are corrected; the original text is kept on every item as its source.',
  },
  {
    id: 'false-cells',
    where: 'Instruction Designing B26:B37, Platform Deployment B13:B41 (hidden)',
    finding: 'Checkbox cells holding FALSE.',
    resolution: 'Recorded as checkbox leftovers. Never read as live status.',
  },
];

/**
 * Decisions the business owner still has to make. `affectsRelease` marks the
 * ones that should be settled before this module is merged and used for real.
 * `default` is what the system does until then.
 */
export const OPEN_DECISIONS = [
  {
    id: 'hidden-id-checklist',
    affectsRelease: true,
    question: 'Should the hidden Instruction Designing checklist (rows 25–37) become the official ID checklist?',
    default: 'Yes, as a labelled proposal (option "idHiddenChecklist").',
  },
  {
    id: 'hidden-deploy-checklist',
    affectsRelease: true,
    question: 'Should the hidden Platform Deployment steps (hand-off to Learning Ops, codelabs, release setup, dry-run scheduling, cloning) be official?',
    default: 'Yes, as labelled proposals (option "deployHiddenChecklist").',
  },
  {
    id: 'redeploy-checklist',
    affectsRelease: true,
    question: 'What is the checklist for "Platform Deployment After Changing"? The sheet is empty.',
    default: 'Deploy every corrected item, re-check each fixed issue, update the release record — signed off by the production manager.',
  },
  {
    id: 'final-deliverables',
    affectsRelease: true,
    question: 'What are the steps for MCQs, Tasks and Projects in Final Curriculum Details?',
    default: 'Write → technical review → ID review (MCQs); write with the task template → scoring checklist and pass mark → technical review (tasks, projects).',
  },
  {
    id: 'revamp-5-6',
    affectsRelease: true,
    question: 'How do "Applying Changes if Any" and "Applying Dry Run Comments" differ operationally in a revamp?',
    default: 'The first is conditional (changes beyond the dry-run findings); the second fixes and verifies every dry-run issue, then redeploys.',
  },
  {
    id: 'ai-release-gates',
    affectsRelease: true,
    question: 'Does the AI path need deployment verification, a dry run, UAT and a release sign-off?',
    default: 'Deployment, UAT and release: on. Dry run: off. Configurable per template version.',
  },
  {
    id: 'change-impact',
    affectsRelease: false,
    question: 'Should a revamp begin with a baseline and change-impact review?',
    default: 'Yes (option "changeImpact").',
  },
  {
    id: 'media-parallel',
    affectsRelease: false,
    question: 'May lesson media production run in parallel with instructional design once the final curriculum is approved?',
    default: 'Yes. Both wait for the final curriculum; deployment waits for both.',
  },
  {
    id: 'draft-signoff',
    affectsRelease: false,
    question: 'Should the ID sign off the revised curriculum draft after the changes are applied?',
    default: 'Yes (a proposed approval on "Apply the ID\'s changes").',
  },
  {
    id: 'external-tools',
    affectsRelease: false,
    question: 'Will Docki and Think expose an API worth integrating?',
    default: 'No integration. Manual handoff with evidence.',
  },
  {
    id: 'expert-performance',
    affectsRelease: false,
    question: 'Should expert and coach performance tracking gate anything?',
    default: 'No — it is optional and continues through production.',
  },
  {
    id: 'sensitive-access',
    affectsRelease: true,
    question: 'Who may see candidate CVs, assessments and contracts?',
    default: 'The expert acquisition coordinator, the production manager, administrators and holders of "experts.sensitive". Nobody else — including course managers.',
  },
];

/** Every row a template cites, across every scenario with every option on. */
export function citedRows() {
  const every = Object.fromEntries(Object.keys(TEMPLATE_OPTIONS).map((key) => [key, true]));
  const cited = new Map();
  const cite = (sheet, rows, where) => {
    for (const row of rows ?? []) {
      const key = `${sheet}#${row}`;
      if (!cited.has(key)) cited.set(key, new Set());
      cited.get(key).add(where);
    }
  };
  const stageCited = new Map();
  for (const scenario of SCENARIOS) {
    const template = buildTemplate(scenario, every);
    for (const stage of template.stages) {
      if (stage.source?.path) {
        const key = `${stage.source.path}#${stage.source.row}`;
        if (!stageCited.has(key)) stageCited.set(key, new Set());
        stageCited.get(key).add(`${scenario}/${stage.key}`);
      }
      for (const entry of stage.tasks) {
        if (entry.source?.sheet) cite(entry.source.sheet, entry.source.rows, `${scenario}/${entry.key}`);
        for (const line of entry.checklist) {
          if (line.source?.sheet) cite(line.source.sheet, line.source.rows, `${scenario}/${entry.key}/${line.key}`);
          if (line.groupSource?.sheet) cite(line.groupSource.sheet, line.groupSource.rows, `${scenario}/${entry.key} (group)`);
        }
      }
    }
  }
  return { rows: cited, masterStages: stageCited };
}

/**
 * Every populated workbook row with what became of it. Used by the test and
 * the traceability document.
 */
export function traceRows() {
  const { rows: cited, masterStages } = citedRows();
  const classified = new Map();
  for (const entry of ROW_CLASSIFICATIONS) for (const row of entry.rows) classified.set(`${entry.sheet}#${row}`, entry);

  const detail = [];
  for (const sheet of DETAIL_SHEETS) {
    for (const row of sheet.rows) {
      const key = `${sheet.name}#${row.row}`;
      let status;
      let usedBy = [];
      let note = null;
      if (row.kind === 'META' || row.kind === 'HEADER') {
        status = 'SHEET_FURNITURE';
      } else if (cited.has(key)) {
        status = 'USED';
        usedBy = [...cited.get(key)].sort();
      } else if (classified.has(key)) {
        status = classified.get(key).classification;
        note = classified.get(key).note;
      } else {
        status = 'UNTRACED';
      }
      detail.push({ sheet: sheet.name, row: row.row, kind: row.kind, hidden: row.hidden, text: row.text, status, usedBy, note });
    }
  }

  const master = MASTER_ACTIVITIES.map((entry) => {
    const key = `${entry.path}#${entry.row}`;
    if (MASTER_HEADER_CELLS.includes(entry.cells)) return { ...entry, status: 'SHEET_FURNITURE', usedBy: [] };
    const used = masterStages.get(key);
    return { ...entry, status: used ? 'USED' : 'UNTRACED', usedBy: used ? [...used].sort() : [] };
  });

  return { detail, master };
}
