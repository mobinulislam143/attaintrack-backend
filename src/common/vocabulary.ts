// ─────────────────────────────────────────────────────────────────────────────
// The fixed vocabulary of the system.
//
// These strings are contractual: they are stored in MongoDB verbatim, returned
// to the client verbatim, and rendered by the design system's status
// components verbatim. Do not invent new members — the UI maps each one to a
// label and a Lucide glyph, so an unknown value renders as nothing.
//
// Mirrors obe-frontend/src/types/api.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Course status, ordered along the workflow. Index = progress. */
export const COURSE_STATUSES = [
  'setup-incomplete',
  'ready',
  'in-progress',
  'marks-uploaded',
  'calculated',
  'report-ready',
] as const;

export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** Human labels — the exact strings from `guidelines/status-vocabulary.html`. */
export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  'setup-incomplete': 'Setup incomplete',
  ready: 'Ready for assessment',
  'in-progress': 'Assessment in progress',
  'marks-uploaded': 'Marks uploaded',
  calculated: 'Attainment calculated',
  'report-ready': 'Report ready',
};

export const OUTCOME_STATUSES = ['achieved', 'below-target', 'not-started'] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const ASSESSMENT_TYPES = [
  'quiz',
  'assignment',
  'midterm',
  'final',
  'lab',
  'presentation',
  'project',
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/** CO-PO mapping strength. 0 is "not mapped" and is never persisted. */
export const MAPPING_STRENGTHS = [0, 1, 2, 3] as const;
export type MappingStrength = (typeof MAPPING_STRENGTHS)[number];

export const ROLE_NAMES = ['admin', 'teacher', 'student'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

// ── Status transitions ───────────────────────────────────────────────────────

/**
 * Rank a status along the workflow so a course's status only ever moves
 * forward. Re-uploading marks after calculating, for instance, must not
 * silently demote the course back to `marks-uploaded` and hide the report.
 */
export function statusRank(status: string): number {
  const index = (COURSE_STATUSES as readonly string[]).indexOf(status);
  return index === -1 ? 0 : index;
}

/** The later of two statuses along the workflow. */
export function advanceStatus(current: string, next: CourseStatus): CourseStatus {
  return statusRank(next) > statusRank(current) ? next : (current as CourseStatus);
}
