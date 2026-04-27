import { StatusCategory } from '../generated/pipeline';

/** Maps API/monolith string labels to Prisma enum; unknown → IN_PROGRESS. */
export function mapStatusCategory(s?: string): StatusCategory {
  if (!s) return StatusCategory.IN_PROGRESS;
  if (s in StatusCategory) return s as StatusCategory;
  return StatusCategory.IN_PROGRESS;
}
