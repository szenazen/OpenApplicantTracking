import { isPublicPipelinesPath, rewritePipelinesToSlicePath } from '../src/pipeline-public-rewrite';

describe('pipeline-public-rewrite', () => {
  it('isPublicPipelinesPath', () => {
    expect(isPublicPipelinesPath('/api/pipelines')).toBe(true);
    expect(isPublicPipelinesPath('/api/pipelines/')).toBe(true);
    expect(isPublicPipelinesPath('/api/pipelines/abc')).toBe(true);
    expect(isPublicPipelinesPath('/api/pipelinesLegacy')).toBe(false);
  });

  it('rewritePipelinesToSlicePath', () => {
    expect(rewritePipelinesToSlicePath('/api/pipelines', 'acc-1')).toBe('/api/slice/pipeline/accounts/acc-1/pipelines');
    expect(rewritePipelinesToSlicePath('/api/pipelines/abc?x=1', 'acc-1')).toBe(
      '/api/slice/pipeline/accounts/acc-1/pipelines/abc?x=1',
    );
  });
});
