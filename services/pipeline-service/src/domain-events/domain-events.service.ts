import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer } from 'kafkajs';

/** Topic for pipeline slice domain events (Redpanda / Kafka API). */
export const PIPELINE_EVENTS_TOPIC = 'oat.domain.pipeline';

@Injectable()
export class DomainEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DomainEventsService.name);
  private producer: Producer | null = null;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const b = this.config.get<string>('KAFKA_BROKERS') ?? process.env.KAFKA_BROKERS;
    this.enabled = Boolean(b && b.trim().length > 0);
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.log.warn('KAFKA_BROKERS not set — domain events disabled');
      return;
    }
    const brokers = (this.config.get<string>('KAFKA_BROKERS') ?? process.env.KAFKA_BROKERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const kafka = new Kafka({ clientId: 'oat-pipeline-service', brokers });
    this.producer = kafka.producer();
    await this.producer.connect();
    this.log.log({ brokers }, 'Kafka producer connected');
  }

  async onModuleDestroy() {
    if (this.producer) {
      await this.producer.disconnect().catch(() => undefined);
    }
  }

  async emit(event: {
    type: string;
    accountId: string;
    pipelineId?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.producer) return;
    const body = {
      v: 1,
      service: 'pipeline-service',
      ...event,
      at: new Date().toISOString(),
    };
    await this.producer.send({
      topic: PIPELINE_EVENTS_TOPIC,
      messages: [
        {
          key: event.accountId,
          value: JSON.stringify(body),
        },
      ],
    });
  }
}
