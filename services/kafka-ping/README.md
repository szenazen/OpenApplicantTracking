# kafka-ping

Small service that **produces and consumes** on a Redpanda/Kafka topic (`oat.domain.smoke` by default) to validate the async path. Uses the same brokers as `docker-compose.yml` (`redpanda:9092` in the Docker network, `localhost:19092` on the host).

- `GET /health`, `GET /ready` — last consumed message when successful.
- Included in the microservices compose overlay; **not** required for monolith mode.
