import { StatusCategory } from '../src/generated/pipeline';
import { mapStatusCategory } from '../src/pipelines/map-status-category';

describe('mapStatusCategory', () => {
  it('defaults missing or unknown to IN_PROGRESS', () => {
    expect(mapStatusCategory(undefined)).toBe(StatusCategory.IN_PROGRESS);
    expect(mapStatusCategory('')).toBe(StatusCategory.IN_PROGRESS);
    expect(mapStatusCategory('not-an-enum')).toBe(StatusCategory.IN_PROGRESS);
  });

  it('accepts valid enum names', () => {
    expect(mapStatusCategory('NEW')).toBe(StatusCategory.NEW);
    expect(mapStatusCategory('HIRED')).toBe(StatusCategory.HIRED);
  });
});
