import {
  isPublicJobsDetailPath,
  isPublicJobsListPath,
  isPublicJobsReadPath,
  rewriteJobsDetailToSlicePath,
  rewriteJobsListToSlicePath,
} from '../src/job-public-rewrite';

describe('job-public-rewrite', () => {
  it('isPublicJobsListPath matches index only', () => {
    expect(isPublicJobsListPath('/api/jobs')).toBe(true);
    expect(isPublicJobsListPath('/api/jobs/')).toBe(true);
    expect(isPublicJobsListPath('/api/jobs/abc')).toBe(false);
    expect(isPublicJobsListPath('/api/jobsLegacy')).toBe(false);
  });

  it('isPublicJobsDetailPath matches id only', () => {
    expect(isPublicJobsDetailPath('/api/jobs/clabc123')).toBe(true);
    expect(isPublicJobsDetailPath('/api/jobs')).toBe(false);
    expect(isPublicJobsDetailPath('/api/jobs/foo/bar')).toBe(false);
  });

  it('isPublicJobsReadPath is list or detail', () => {
    expect(isPublicJobsReadPath('/api/jobs')).toBe(true);
    expect(isPublicJobsReadPath('/api/jobs/j1')).toBe(true);
    expect(isPublicJobsReadPath('/api/jobs/foo/extra')).toBe(false);
  });

  it('rewriteJobsListToSlicePath preserves query', () => {
    expect(rewriteJobsListToSlicePath('/api/jobs', 'acc-1')).toBe('/api/slice/pipeline/accounts/acc-1/jobs');
    expect(rewriteJobsListToSlicePath('/api/jobs?q=x&limit=5', 'acc-1')).toBe(
      '/api/slice/pipeline/accounts/acc-1/jobs?q=x&limit=5',
    );
  });

  it('rewriteJobsDetailToSlicePath encodes id and query', () => {
    expect(rewriteJobsDetailToSlicePath('/api/jobs/job-1', 'acc-1')).toBe(
      '/api/slice/pipeline/accounts/acc-1/jobs/job-1',
    );
    expect(rewriteJobsDetailToSlicePath('/api/jobs/job-1?x=1', 'acc-1')).toBe(
      '/api/slice/pipeline/accounts/acc-1/jobs/job-1?x=1',
    );
  });
});
