import { describe, expect, it } from "vitest";
import { parseCommands } from "@/lib/analyze/guidance-graph";

// A guidance doc names WHERE the solution lives; dropping that leaves a bare `dotnet test` that fails at
// a repo root with MSB1003 (measured on a Unity + .NET repo whose core lives in shared/core-dotnet).
describe("parseCommands keeps the arguments a dotnet command needs", () => {
  it("keeps a path argument", () => {
    expect(parseCommands("Core is tested with\n`dotnet test shared/core-dotnet`. App code renders state.")).toContainEqual({
      key: "test",
      command: "dotnet test shared/core-dotnet",
    });
  });
  it("keeps a solution file, drops a short flag whose value it cannot tell from prose, and stops at prose", () => {
    expect(parseCommands("run dotnet build src/App.sln -c Release before you commit")).toContainEqual({
      key: "build",
      command: "dotnet build src/App.sln",
    });
    expect(parseCommands("then dotnet test before pushing")).toContainEqual({ key: "test", command: "dotnet test" });
    expect(parseCommands("`dotnet test --no-restore tests/Core.Tests.csproj`")).toContainEqual({
      key: "test",
      command: "dotnet test --no-restore tests/Core.Tests.csproj",
    });
  });
  it("keys on the verb, not on a path that happens to contain a key word", () => {
    expect(parseCommands("`dotnet build src/test/Harness.csproj`")).toContainEqual({ key: "build", command: "dotnet build src/test/Harness.csproj" });
  });
});
