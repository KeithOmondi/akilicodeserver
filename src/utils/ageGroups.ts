/**
 * The five learning groups. The same list is used on the website (client/src/lib/ageGroups.ts).
 * `start` says what a child in that group begins with; it is advice shown to parents and used to order
 * the learning path, never a rule that blocks anyone.
 */
export const AGE_GROUP_IDS = ['4-6', '7-9', '10-12', '13-15', '16-18'] as const;
export type AgeGroup = (typeof AGE_GROUP_IDS)[number];

export const ageGroupOf = (age: number): AgeGroup => {
  if (age <= 6) return '4-6';
  if (age <= 9) return '7-9';
  if (age <= 12) return '10-12';
  if (age <= 15) return '13-15';
  return '16-18';
};

export const isAgeGroup = (v: unknown): v is AgeGroup => typeof v === 'string' && (AGE_GROUP_IDS as readonly string[]).includes(v);

/**
 * SQL that is true when a lesson (alias `lessonAlias`) should be shown to the child whose id is the parameter
 * `$kidParam`. A lesson with no groups listed is for everyone, and so is any child with no group set.
 */
export const lessonVisibleSql = (lessonAlias: string, kidParam: number): string =>
  `(${lessonAlias}.age_groups IS NULL OR cardinality(${lessonAlias}.age_groups) = 0 ` +
  `OR (SELECT k.age_group FROM kids k WHERE k.id = $${kidParam}) IS NULL ` +
  `OR (SELECT k.age_group FROM kids k WHERE k.id = $${kidParam}) = ANY(${lessonAlias}.age_groups))`;
