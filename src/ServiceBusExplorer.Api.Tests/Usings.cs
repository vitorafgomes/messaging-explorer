global using Xunit;

// Tests share process-wide environment variables, so run them sequentially.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
