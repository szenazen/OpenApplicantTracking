import { isPublicJobsListPath, rewriteJobsListToSlicePath } from '../src/job-public-rewrite';

describe('job-public-rewrite', () => {
  it('isPublicJobsListPath matches index only', () => {
    expect(isPublicJobsListPath('/api/jobs')).toBe(true);
    expect(isPublicJobsListPath('/api/jobs/')).toBe(true);
    expect(isPublicJobsListPath('/api/jobs/abc')).toBe(false);
    expect(isPublicJobsListPath('/api/jobsLegacy')).toBe(false);
  });

  it('rewriteJobsListToSlicePath preserves query', () => {
    expect(rewriteJobsListToSlicePath('/api/jobs', 'acc-1')).toBe('/api/slice/pipeline/accounts/acc-1/jobs');
    expect(rewriteJobsListToSlicePath('/api/jobs?q=x&limit=5', 'acc-1')).toBe(
      '/api/slice/pipeline/accounts/acc-1/jobs?q=x&limit=5',
    );
  });
});
