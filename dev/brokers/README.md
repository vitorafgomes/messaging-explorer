# Local brokers

RabbitMQ and the Azure Service Bus emulator in Docker, for trying the app by hand.

```bash
docker compose -f dev/brokers/docker-compose.yml up -d      # start
docker compose -f dev/brokers/docker-compose.yml down -v    # stop and discard all data
```

Connection values, the sample entities and the limits of the emulator:
[`context/pages/runbooks/local-brokers.md`](../../context/pages/runbooks/local-brokers.md).
