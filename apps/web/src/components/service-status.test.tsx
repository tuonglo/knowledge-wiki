import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceStatus } from "./service-status";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("ServiceStatus", () => {
  it("shows ok when the service reports healthy", async () => {
    mockFetch(async () => ({
      json: async () => ({ service: "api", status: "ok", checks: { postgres: "ok" } }),
    }));
    render(<ServiceStatus name="API" url="http://api" />);
    expect(await screen.findByText("ok")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("http://api/health");
  });

  it("shows degraded when a dependency is down", async () => {
    mockFetch(async () => ({
      json: async () => ({ service: "api", status: "degraded", checks: { redis: "fail" } }),
    }));
    render(<ServiceStatus name="API" url="http://api" />);
    expect(await screen.findByText("degraded")).toBeInTheDocument();
  });

  it("shows unreachable when the request fails", async () => {
    mockFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    render(<ServiceStatus name="AI" url="http://ai" />);
    expect(await screen.findByText("unreachable")).toBeInTheDocument();
  });
});
