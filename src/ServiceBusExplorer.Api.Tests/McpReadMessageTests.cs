using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ServiceBusExplorer.Api.Logs;
using ServiceBusExplorer.Api.Mcp;
using ServiceBusExplorer.Core.Models;
using ServiceBusExplorer.Core.Services;
using static ServiceBusExplorer.Api.Tests.McpToolTests;

namespace ServiceBusExplorer.Api.Tests;

/// <summary>
/// read_message reads one message by its sequence number, its body in pieces of at most 8000 characters, under the
/// protection of a peek, and records no body.
/// </summary>
public class McpReadMessageTests
{
    private static readonly string LongBody = BodyMarker + string.Concat(Enumerable.Range(0, 20000 - BodyMarker.Length).Select(i => (char)('a' + i % 26)));

    private static readonly string PairAcrossTheCut = new string('a', 7999) + "\U0001F600" + new string('b', 100);

    private static Broker WithMessages(bool sequenceNumbers = true, bool transferDeadLetter = true, bool deadLetter = true, bool subscriptions = true, Exception? failure = null) => new()
    {
        SupportsSequenceNumbers = sequenceNumbers,
        SupportsTransferDeadLetter = transferDeadLetter,
        SupportsDeadLetterQueue = deadLetter,
        SupportsSubscriptions = subscriptions,
        PeekFailure = failure,
        Messages =
        [
            new MessageInfo { MessageId = "m41", SequenceNumber = 41, Body = "short" },
            new MessageInfo { MessageId = "m42", SequenceNumber = 42, Body = LongBody, Subject = "order", State = "Active" },
            new MessageInfo { MessageId = "m43", SequenceNumber = 43, Body = PairAcrossTheCut },
        ],
    };

    private static async Task<Host> StartedAsync(Broker broker, bool offered = true, string? environmentId = null)
    {
        var host = new Host(broker);
        await host.StartAsync();
        if (environmentId is not null)
        {
            await host.Factory.Services.GetRequiredService<IConnectionGroupManager>()
                .SaveGroupAsync(new ConnectionGroup { Id = environmentId, Name = "prod", Type = "environment", IsProduction = true });
        }
        var connection = Offered();
        connection.EnvironmentId = environmentId;
        await host.SeedAsync(connection);
        if (offered) await host.OfferAsync(connection.Id);
        await host.ConnectAsync(connection.Id);
        return host;
    }

    [Fact]
    public async Task A_body_of_20000_characters_is_read_in_three_pieces_that_join_to_the_original_and_none_of_it_is_recorded()
    {
        var broker = WithMessages();
        await using var host = await StartedAsync(broker);
        var store = host.Factory.Services.GetRequiredService<RecentLogStore>();
        var pieces = new List<JsonElement>();

        foreach (var offset in new[] { 0, 8000, 16000 })
        {
            var (isError, text) = await host.CallAsync("read_message", new { entity = "orders", sequenceNumber = 42, offset });
            Assert.False(isError, text);
            using var doc = JsonDocument.Parse(text);
            pieces.Add(doc.RootElement.Clone());
        }

        Assert.True(pieces.Select(p => p.GetProperty("body").GetString()!.Length).SequenceEqual([8000, 8000, 4000]),
            $"a body is read from offset, at most 8000 characters at a time; the pieces were {string.Join(", ", pieces.Select(p => p.GetProperty("body").GetString()!.Length))} long");
        Assert.True(string.Concat(pieces.Select(p => p.GetProperty("body").GetString())) == LongBody, "the pieces of a body read with nextOffset join to the original body");
        Assert.True(pieces.All(p => p.GetProperty("bodyLength").GetInt32() == 20000), "every piece says the whole length of the body in characters");
        Assert.Equal([8000, 16000, -1], pieces.Select(p => p.TryGetProperty("nextOffset", out var next) ? next.GetInt32() : -1));
        Assert.Equal((42L, "m42", "order"), (pieces[0].GetProperty("sequenceNumber").GetInt64(), pieces[0].GetProperty("messageId").GetString(), pieces[0].GetProperty("subject").GetString()));
        var activity = await host.ActivityAsync();
        Assert.Equal(
            [("Read message 42", "orders (active) on offered-name", "4000 characters read"), ("Read message 42", "orders (active) on offered-name", "8000 characters read"), ("Read message 42", "orders (active) on offered-name", "8000 characters read")],
            activity.EnumerateArray().Select(l => (l.GetProperty("asked").GetString(), l.GetProperty("where").GetString(), l.GetProperty("outcome").GetString())));
        Assert.False(activity.GetRawText().Contains(BodyMarker, StringComparison.Ordinal), $"no body goes to the record; it held {activity.GetRawText()}");
        Assert.DoesNotContain(store.After(0), l => l.Text.Contains(BodyMarker, StringComparison.Ordinal));
    }

    [Fact]
    public async Task On_a_production_connection_read_message_asks_first_and_a_denial_reads_nothing()
    {
        var broker = WithMessages();
        await using var host = await StartedAsync(broker, environmentId: "env-prod");

        var denied = host.CallAsync("read_message", new { entity = "orders", sequenceNumber = 42, reason = "see why it failed" });
        var request = await host.AnswerOnlyRequestAsync(allow: false);
        var deniedAnswer = await denied;
        var peeksAfterDenial = broker.Peeks;
        var allowed = host.CallAsync("read_message", new { entity = "orders", sequenceNumber = 42 });
        await host.AnswerOnlyRequestAsync(allow: true);
        var allowedAnswer = await allowed;

        Assert.Equal(("read", "Assistant asks to read message 42"), (request.GetProperty("kind").GetString(), request.GetProperty("title").GetString()));
        Assert.Equal("From: orders (active) | On: offered-name (prod) | It said why: see why it failed",
            string.Join(" | ", request.GetProperty("facts").EnumerateArray().Select(f => $"{f.GetProperty("label").GetString()}: {f.GetProperty("value").GetString()}")));
        Assert.True(deniedAnswer == (true, McpToolCalls.DeniedSentence) && peeksAfterDenial == 0,
            $"a production connection asks before the read and a denial reads nothing; it answered {deniedAnswer.Text} after {peeksAfterDenial} peeks");
        Assert.False(allowedAnswer.IsError, allowedAnswer.Text);
    }

    [Fact]
    public async Task A_connection_not_offered_is_refused_and_nothing_is_read()
    {
        var broker = WithMessages();
        await using var host = await StartedAsync(broker, offered: false);

        var answer = await host.CallAsync("read_message", new { entity = "orders", sequenceNumber = 42 });

        Assert.True(answer == (true, McpReadTools.NotOffered) && broker.Peeks == 0,
            $"read_message needs the connection offered at the level read; below it is refused and nothing is read; it answered {answer.Text} after {broker.Peeks} peeks");
    }

    [Theory]
    [InlineData(40, 0, "The message was not found.")]
    [InlineData(99, 0, "The message was not found.")]
    [InlineData(42, -1, "offset is 0 to 20000.")]
    [InlineData(42, 20001, "offset is 0 to 20000.")]
    public async Task A_message_not_there_or_an_offset_outside_the_body_is_refused_with_its_sentence(long sequenceNumber, int offset, string sentence)
    {
        await using var host = await StartedAsync(WithMessages());

        var answer = await host.CallAsync("read_message", new { entity = "orders", sequenceNumber, offset });

        Assert.True(answer == (true, sentence), $"read_message of {sequenceNumber} from {offset} is refused with \"{sentence}\"; it answered {answer.Text}");
        Assert.DoesNotContain(BodyMarker, answer.Text);
    }

    [Theory]
    [InlineData("position")]
    [InlineData("transfer")]
    [InlineData("deadLetter")]
    [InlineData("subscription")]
    [InlineData("unknown")]
    public async Task What_the_provider_cannot_do_is_refused_with_the_sentence_of_the_peek_and_the_numbered_tools(string missing)
    {
        var broker = WithMessages(sequenceNumbers: missing != "position", transferDeadLetter: missing != "transfer", deadLetter: missing != "deadLetter", subscriptions: missing != "subscription");
        await using var host = await StartedAsync(broker);
        var (arguments, sentence) = missing switch
        {
            "position" => ((object)new { entity = "orders", sequenceNumber = 42 }, McpRemoveTools.PositionRefused),
            "transfer" => (new { entity = "orders", subQueue = "transferDeadLetter", sequenceNumber = 42 }, "This provider does not support the transfer dead-letter queue."),
            "deadLetter" => (new { entity = "orders", subQueue = "deadLetter", sequenceNumber = 42 }, "This provider does not support the dead-letter queue."),
            "subscription" => (new { entity = "events", subscription = "audit", sequenceNumber = 42 }, "This provider does not support subscriptions."),
            _ => (new { entity = "orders", subQueue = "scheduled", sequenceNumber = 42 }, "subQueue must be active, deadLetter or transferDeadLetter."),
        };

        var answer = await host.CallAsync("read_message", arguments);

        Assert.True(answer == (true, sentence) && broker.Peeks == 0,
            $"what the provider cannot do is refused before it is called; without {missing} read_message answered {answer.Text} after {broker.Peeks} peeks");
    }

    [Fact]
    public async Task A_read_the_broker_fails_answers_the_fixed_sentence_and_records_the_failure()
    {
        var broker = WithMessages(failure: new Azure.Messaging.ServiceBus.ServiceBusException(Sentinel, Azure.Messaging.ServiceBus.ServiceBusFailureReason.ServiceCommunicationProblem));
        await using var host = await StartedAsync(broker);

        var answer = await host.CallAsync("read_message", new { entity = "orders", sequenceNumber = 42 });

        Assert.True(answer == (true, "An internal error occurred."), $"a read the broker fails is answered with the fixed sentence, never the broker's text; it answered {answer.Text}");
        var line = Assert.Single((await host.ActivityAsync()).EnumerateArray());
        Assert.Equal(("Read message 42", "Failed"), (line.GetProperty("asked").GetString(), line.GetProperty("outcome").GetString()));
        Assert.DoesNotContain("SENTINEL", line.GetRawText());
    }

    [Fact]
    public async Task Read_message_is_read_only_and_peek_messages_says_a_cut_body_is_read_on_with_it()
    {
        await using var host = await StartedAsync(WithMessages());

        var read = await host.ListedToolAsync("read_message");
        var peek = await host.ListedToolAsync("peek_messages");

        Assert.True(read.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean(), "read_message is marked read-only: it reads only where a message is named by its sequence number");
        Assert.Contains("A body cut at 8000 characters is read on with read_message.", peek.GetProperty("description").GetString());
    }

    [Fact]
    public async Task A_character_of_two_code_units_at_the_cut_is_never_split_and_the_pieces_still_join_to_the_original()
    {
        await using var host = await StartedAsync(WithMessages());
        var pieces = new List<string>();
        int? offset = 0;

        while (offset is { } from && pieces.Count < 5)
        {
            var (isError, text) = await host.CallAsync("read_message", new { entity = "orders", sequenceNumber = 43, offset = from });
            Assert.False(isError, text);
            using var doc = JsonDocument.Parse(text);
            pieces.Add(doc.RootElement.GetProperty("body").GetString()!);
            offset = doc.RootElement.TryGetProperty("nextOffset", out var next) ? next.GetInt32() : null;
        }

        Assert.True(pieces.All(p => p.Length > 0 && !char.IsHighSurrogate(p[^1]) && !char.IsLowSurrogate(p[0])),
            $"no piece ends or begins inside a character of two code units; the pieces were {string.Join(", ", pieces.Select(p => p.Length))} long");
        Assert.True(string.Concat(pieces) == PairAcrossTheCut, "the pieces of a body read with nextOffset join to the original body, a character across the cut included");
    }
}
