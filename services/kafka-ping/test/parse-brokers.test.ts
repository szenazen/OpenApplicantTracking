describe('kafka-ping config', () => {
  it('splits KAFKA_BROKERS', () => {
    const raw = 'a:1,b:2';
    const b = raw.split(',').map((s) => s.trim());
    expect(b).toEqual(['a:1', 'b:2']);
  });
});
