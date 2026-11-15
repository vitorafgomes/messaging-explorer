namespace ServiceBusExplorer.Core.Models;

/// <summary>How a message body travels as a string between the API and the web app.</summary>
public static class MessageBodyEncoding
{
    /// <summary>The body is the UTF-8 text of its bytes.</summary>
    public const string Text = "text";

    /// <summary>The body is the base64 of its bytes, for a body that is not valid UTF-8.</summary>
    public const string Base64 = "base64";
}
