using ServiceBusExplorer.Core.Providers.RabbitMQ.Models;

namespace ServiceBusExplorer.Core.Providers.RabbitMQ.Services;

/// <summary>
/// Detects RabbitMQ messaging patterns based on exchange/queue topology.
/// Analyzes exchange types, bindings, routing keys, and queue configurations
/// to identify which of the 7 AMQP patterns are being used.
/// </summary>
public class RabbitMQPatternDetector
{
    private const double HIGH_CONFIDENCE = 0.9;
    private const double MEDIUM_CONFIDENCE = 0.7;
    private const double LOW_CONFIDENCE = 0.5;

    /// <summary>
    /// Detects messaging pattern for an exchange based on its configuration and bindings.
    /// </summary>
    /// <param name="exchange">The exchange to analyze</param>
    /// <param name="relatedQueues">Queues that are bound to this exchange</param>
    /// <returns>Pattern information including primary and secondary patterns</returns>
    public ExchangePatternInfo DetectExchangePattern(
        RabbitMQExchangeInfo exchange,
        IEnumerable<RabbitMQQueueInfo> relatedQueues)
    {
        var result = new ExchangePatternInfo
        {
            ExchangeName = exchange.Name,
            ExchangeType = exchange.ExchangeType,
            SecondaryPatterns = new List<PatternDetectionResult>()
        };

        // Detect based on exchange type
        switch (exchange.ExchangeType.ToLower())
        {
            case "fanout":
                result.PrimaryPattern = DetectFanoutPattern(exchange);
                break;

            case "direct":
                result.PrimaryPattern = DetectDirectPattern(exchange);
                break;

            case "topic":
                result.PrimaryPattern = DetectTopicPattern(exchange);
                break;

            case "headers":
                result.PrimaryPattern = DetectHeadersPattern(exchange);
                break;

            default:
                result.PrimaryPattern = new PatternDetectionResult
                {
                    Pattern = MessagingPattern.None,
                    Confidence = 0.0,
                    Reason = $"Unknown exchange type: {exchange.ExchangeType}"
                };
                break;
        }

        // Check for Publisher Confirms (can be secondary pattern)
        var confirmsPattern = DetectPublisherConfirms(exchange);
        if (confirmsPattern.Confidence >= LOW_CONFIDENCE)
        {
            result.SecondaryPatterns.Add(confirmsPattern);
        }

        // Check for RPC pattern (can be secondary)
        var rpcPattern = DetectRPCPatternForExchange(exchange, relatedQueues);
        if (rpcPattern.Confidence >= LOW_CONFIDENCE)
        {
            result.SecondaryPatterns.Add(rpcPattern);
        }

        return result;
    }

    /// <summary>
    /// Detects messaging pattern for a queue based on its configuration.
    /// </summary>
    /// <param name="queue">The queue to analyze</param>
    /// <param>bindings">Bindings that connect to this queue</param>
    /// <returns>Pattern information for the queue</returns>
    public QueuePatternInfo DetectQueuePattern(
        RabbitMQQueueInfo queue,
        IEnumerable<RabbitMQBindingInfo> bindings)
    {
        var result = new QueuePatternInfo
        {
            QueueName = queue.Name,
            RelatedExchanges = bindings.Select(b => b.Source).Distinct().ToList()
        };

        // Work Queue pattern detection (highest priority)
        if (queue.ConsumerCount > 1)
        {
            result.PrimaryPattern = new PatternDetectionResult
            {
                Pattern = MessagingPattern.WorkQueue,
                Confidence = HIGH_CONFIDENCE,
                Reason = $"Multiple consumers ({queue.ConsumerCount}) competing for messages",
                Metadata = new Dictionary<string, object>
                {
                    ["consumerCount"] = queue.ConsumerCount,
                    ["messagesReady"] = queue.MessagesReady,
                    ["messagesUnacknowledged"] = queue.MessagesUnacknowledged
                }
            };
            return result;
        }

        // Hello World pattern detection
        if (queue.ConsumerCount == 1 && bindings.Count() == 1)
        {
            var binding = bindings.First();
            if (string.IsNullOrEmpty(binding.Source) || binding.Source == "")
            {
                result.PrimaryPattern = new PatternDetectionResult
                {
                    Pattern = MessagingPattern.HelloWorld,
                    Confidence = HIGH_CONFIDENCE,
                    Reason = "Single consumer, single binding to default exchange",
                    Metadata = new Dictionary<string, object>
                    {
                        ["routingKey"] = binding.RoutingKey ?? string.Empty
                    }
                };
                return result;
            }
        }

        // RPC pattern detection (reply queue)
        if (IsReplyQueue(queue))
        {
            result.PrimaryPattern = new PatternDetectionResult
            {
                Pattern = MessagingPattern.RPC,
                Confidence = MEDIUM_CONFIDENCE,
                Reason = "Queue naming or configuration suggests RPC reply queue",
                Metadata = new Dictionary<string, object>
                {
                    ["queueType"] = "reply",
                    ["exclusive"] = queue.Exclusive
                }
            };
            return result;
        }

        // No specific pattern detected
        result.PrimaryPattern = new PatternDetectionResult
        {
            Pattern = MessagingPattern.None,
            Confidence = 0.0,
            Reason = "No specific pattern detected for queue"
        };

        return result;
    }

    #region Private Pattern Detection Methods

    /// <summary>
    /// Detects Pub/Sub pattern for fanout exchanges.
    /// </summary>
    private PatternDetectionResult DetectFanoutPattern(RabbitMQExchangeInfo exchange)
    {
        if (exchange.Bindings.Count >= 2)
        {
            // Multiple bindings = classic Pub/Sub
            var emptyRoutingKeys = exchange.Bindings.Count(b => string.IsNullOrEmpty(b.RoutingKey));

            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.PubSub,
                Confidence = HIGH_CONFIDENCE,
                Reason = $"Fanout exchange broadcasting to {exchange.Bindings.Count} queues",
                Metadata = new Dictionary<string, object>
                {
                    ["boundQueueCount"] = exchange.Bindings.Count,
                    ["emptyRoutingKeys"] = emptyRoutingKeys
                }
            };
        }
        else if (exchange.Bindings.Count == 1)
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.PubSub,
                Confidence = MEDIUM_CONFIDENCE,
                Reason = "Fanout exchange with single binding (potential Pub/Sub setup)"
            };
        }

        return new PatternDetectionResult
        {
            Pattern = MessagingPattern.None,
            Confidence = LOW_CONFIDENCE,
            Reason = "Fanout exchange with no bindings"
        };
    }

    /// <summary>
    /// Detects Hello World or Routing pattern for direct exchanges.
    /// </summary>
    private PatternDetectionResult DetectDirectPattern(RabbitMQExchangeInfo exchange)
    {
        if (exchange.Bindings.Count == 0)
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.None,
                Confidence = 0.0,
                Reason = "Direct exchange with no bindings"
            };
        }

        var distinctRoutingKeys = exchange.Bindings
            .Select(b => b.RoutingKey)
            .Where(k => !string.IsNullOrEmpty(k))
            .Distinct()
            .Count();

        if (distinctRoutingKeys >= 2)
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.Routing,
                Confidence = HIGH_CONFIDENCE,
                Reason = $"Direct exchange routing to {distinctRoutingKeys} different keys",
                Metadata = new Dictionary<string, object>
                {
                    ["routingKeyCount"] = distinctRoutingKeys,
                    ["bindingCount"] = exchange.Bindings.Count,
                    ["routingKeys"] = exchange.Bindings
                        .Select(b => b.RoutingKey)
                        .Where(k => !string.IsNullOrEmpty(k))
                        .Distinct()
                        .ToList()
                }
            };
        }
        else if (exchange.Bindings.Count == 1)
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.HelloWorld,
                Confidence = MEDIUM_CONFIDENCE,
                Reason = "Direct exchange with single binding",
                Metadata = new Dictionary<string, object>
                {
                    ["routingKey"] = exchange.Bindings.First().RoutingKey ?? string.Empty
                }
            };
        }

        return new PatternDetectionResult
        {
            Pattern = MessagingPattern.Routing,
            Confidence = LOW_CONFIDENCE,
            Reason = "Direct exchange with multiple bindings using same routing key"
        };
    }

    /// <summary>
    /// Detects Topics pattern for topic exchanges.
    /// </summary>
    private PatternDetectionResult DetectTopicPattern(RabbitMQExchangeInfo exchange)
    {
        if (exchange.Bindings.Count == 0)
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.None,
                Confidence = 0.0,
                Reason = "Topic exchange with no bindings"
            };
        }

        var wildcardBindings = exchange.Bindings
            .Where(b => ContainsWildcard(b.RoutingKey))
            .ToList();

        if (wildcardBindings.Any())
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.Topics,
                Confidence = HIGH_CONFIDENCE,
                Reason = $"Topic exchange with {wildcardBindings.Count} wildcard patterns",
                Metadata = new Dictionary<string, object>
                {
                    ["wildcardBindings"] = wildcardBindings.Count,
                    ["totalBindings"] = exchange.Bindings.Count,
                    ["patterns"] = wildcardBindings.Select(b => b.RoutingKey).ToList()
                }
            };
        }

        return new PatternDetectionResult
        {
            Pattern = MessagingPattern.Topics,
            Confidence = MEDIUM_CONFIDENCE,
            Reason = "Topic exchange without wildcard patterns (potential topic setup)",
            Metadata = new Dictionary<string, object>
            {
                ["bindingCount"] = exchange.Bindings.Count
            }
        };
    }

    /// <summary>
    /// Detects pattern for headers exchanges.
    /// </summary>
    private PatternDetectionResult DetectHeadersPattern(RabbitMQExchangeInfo exchange)
    {
        if (exchange.Bindings.Count >= 1)
        {
            var headersBindings = exchange.Bindings
                .Where(b => b.Arguments != null && b.Arguments.Any())
                .Count();

            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.Routing,
                Confidence = MEDIUM_CONFIDENCE,
                Reason = $"Headers exchange with {headersBindings} argument-based bindings",
                Metadata = new Dictionary<string, object>
                {
                    ["headersBindings"] = headersBindings,
                    ["totalBindings"] = exchange.Bindings.Count
                }
            };
        }

        return new PatternDetectionResult
        {
            Pattern = MessagingPattern.None,
            Confidence = 0.0,
            Reason = "Headers exchange with no bindings"
        };
    }

    /// <summary>
    /// Detects Publisher Confirms pattern.
    /// This is often a secondary pattern combined with others.
    /// </summary>
    private PatternDetectionResult DetectPublisherConfirms(RabbitMQExchangeInfo exchange)
    {
        // Check exchange arguments for publisher confirms configuration
        if (exchange.Arguments != null &&
            exchange.Arguments.ContainsKey("x-publisher-confirms"))
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.PublisherConfirms,
                Confidence = HIGH_CONFIDENCE,
                Reason = "Exchange configured with publisher confirms"
            };
        }

        // Durable exchanges are candidates for publisher confirms
        if (exchange.Durable && exchange.BoundQueueCount > 0)
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.PublisherConfirms,
                Confidence = LOW_CONFIDENCE,
                Reason = "Durable exchange suitable for publisher confirms"
            };
        }

        return new PatternDetectionResult
        {
            Pattern = MessagingPattern.None,
            Confidence = 0.0
        };
    }

    /// <summary>
    /// Detects RPC pattern for exchanges by looking for request/reply queue pairs.
    /// </summary>
    private PatternDetectionResult DetectRPCPatternForExchange(
        RabbitMQExchangeInfo exchange,
        IEnumerable<RabbitMQQueueInfo> relatedQueues)
    {
        // Look for request/reply queue pairs
        var queueNames = relatedQueues.Select(q => q.Name.ToLower()).ToList();

        var hasRequestQueue = queueNames.Any(n =>
            n.Contains("request") || n.Contains("req") || n.Contains("rpc_request"));
        var hasReplyQueue = queueNames.Any(n =>
            n.Contains("reply") || n.Contains("resp") || n.Contains("rpc_reply"));

        if (hasRequestQueue && hasReplyQueue)
        {
            return new PatternDetectionResult
            {
                Pattern = MessagingPattern.RPC,
                Confidence = MEDIUM_CONFIDENCE,
                Reason = "Exchange has request/reply queue pairs",
                Metadata = new Dictionary<string, object>
                {
                    ["queuePattern"] = "request-reply"
                }
            };
        }

        return new PatternDetectionResult
        {
            Pattern = MessagingPattern.None,
            Confidence = 0.0
        };
    }

    /// <summary>
    /// Checks if a routing key contains wildcard characters (* or #).
    /// </summary>
    private bool ContainsWildcard(string routingKey)
    {
        return !string.IsNullOrEmpty(routingKey) &&
               (routingKey.Contains('*') || routingKey.Contains('#'));
    }

    /// <summary>
    /// Checks if a queue is likely a reply queue for RPC pattern.
    /// </summary>
    private bool IsReplyQueue(RabbitMQQueueInfo queue)
    {
        var name = queue.Name.ToLower();

        // Common naming patterns for reply queues
        if (name.Contains("reply") ||
            name.Contains("resp") ||
            name.Contains("rpc_reply"))
        {
            return true;
        }

        // Auto-generated reply queues start with amq.gen-
        if (name.StartsWith("amq.gen-"))
        {
            return true;
        }

        // Exclusive queues are often used for RPC replies
        if (queue.Exclusive)
        {
            return true;
        }

        return false;
    }

    #endregion
}
