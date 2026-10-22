// @vitest-environment jsdom
//
// The return banner's polling hook: asks /api/billing/checkout/status about THIS checkout with backoff
// (2s, 4s, 8s, capped at 15s), stops at a terminal state, and repaints the server-rendered chips with
// exactly one router.refresh() when the purchase lands.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCheckoutReturn } from "./useCheckoutReturn";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useCheckoutReturn", () => {
  it("polls with backoff 2s, 4s, 8s, stops at landed and refreshes exactly once", async () => {
    fetchMock
      .mockImplementationOnce(() => reply({ state: "confirming" }))
      .mockImplementationOnce(() => reply({ state: "paid", orderId: "ord_9" }))
      .mockImplementationOnce(() => reply({ state: "paid", orderId: "ord_9" }))
      .mockImplementationOnce(() => reply({ state: "landed", credits: 500, balance: 620 }));
    const { result } = renderHook(() => useCheckoutReturn("acme", "co_1"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/billing/checkout/status?org=acme&checkout_id=co_1");

    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("paid");
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current).toEqual({ state: "landed", credits: 500, balance: 620 });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("caps the delay at 15s and keeps polling while stalled", async () => {
    fetchMock.mockImplementation(() => reply({ state: "stalled", orderId: "ord_9" }));
    renderHook(() => useCheckoutReturn("acme", "co_1"));
    await act(() => vi.advanceTimersByTimeAsync(0 + 2000 + 4000 + 8000));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(() => vi.advanceTimersByTimeAsync(14_999));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no checkout id: unverified at once, never fetches", async () => {
    const { result } = renderHook(() => useCheckoutReturn("acme", null));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(result.current.state).toBe("unverified");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refused or unknown checkout (4xx) is unverified and stops; a 503 retries", async () => {
    fetchMock.mockImplementationOnce(() => reply({ error: "x" }, 503)).mockImplementationOnce(() => reply({ error: "Unknown checkout." }, 404));
    const { result } = renderHook(() => useCheckoutReturn("acme", "co_1"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.state).toBe("confirming");
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.state).toBe("unverified");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
