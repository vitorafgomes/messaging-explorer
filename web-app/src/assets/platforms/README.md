# Platform Logos

This directory contains logo assets for supported messaging platforms.

## Supported Platforms

The following platforms are planned for integration:

- **Azure Service Bus** (`azure-servicebus.svg`)
- **RabbitMQ** (`rabbitmq.svg`)
- **Apache Kafka** (`kafka.svg`)
- **AWS SQS/SNS** (`aws-sqs.svg`)
- **Google Pub/Sub** (`google-pubsub.svg`)

## Logo Guidelines

- **Format**: SVG preferred for scalability
- **Size**: Optimize for 64x64px to 128x128px display
- **Style**: Match the modern, minimalist theme of Messaging Explorer
- **Colors**: Use official brand colors when possible
- **Licensing**: Ensure all logos are properly licensed for use

## Usage

Platform logos are displayed in:
- Connection selection interface
- Connection status indicators
- Platform-specific documentation links
- Platform badges in the header

## Adding New Platforms

When adding a new platform:
1. Add the SVG logo to this directory
2. Name it using kebab-case: `platform-name.svg`
3. Update this README with the platform name
4. Update the connection manager to recognize the new platform
