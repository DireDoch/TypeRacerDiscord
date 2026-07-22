// =============================================================================
//  api.test.ts — request() unique : préfixe /.proxy toujours appliqué, et les
//  trois familles d'échec (identité / réseau / HTTP) restent distinguables.
// =============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./discord", () => ({
  getAuthToken: vi.fn(async () => "tok"),
  proxyBase: vi.fn(() => "/.proxy"),
}));

import { getAuthToken } from "./discord";
import { fetchQuote, HttpError, IdentityError, isIdentityError, NetworkError } from "./api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
  vi.mocked(getAuthToken).mockReset().mockResolvedValue("tok");
});

describe("request (via fetchQuote)", () => {
  it("préfixe toujours /.proxy", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    await fetchQuote();
    expect(fetchMock).toHaveBeenCalledWith("/.proxy/api/quote", expect.anything());
  });

  it("getAuthToken() en échec ⇒ IdentityError, reconnue par isIdentityError", async () => {
    vi.mocked(getAuthToken).mockRejectedValue(new Error("pas de handshake"));
    await expect(fetchQuote()).rejects.toBeInstanceOf(IdentityError);
    try {
      await fetchQuote();
    } catch (e) {
      expect(isIdentityError(e)).toBe(true);
    }
  });

  it("fetch() qui rejette ⇒ NetworkError, pas confondue avec l'identité", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchQuote()).rejects.toBeInstanceOf(NetworkError);
    try {
      await fetchQuote();
    } catch (e) {
      expect(isIdentityError(e)).toBe(false);
    }
  });

  it("réponse non-ok ⇒ HttpError taguée du status ; 401 EST une identityError, 500 non", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await expect(fetchQuote()).rejects.toBeInstanceOf(HttpError);
    try {
      await fetchQuote();
    } catch (e) {
      expect(isIdentityError(e)).toBe(true);
    }

    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    try {
      await fetchQuote();
    } catch (e) {
      expect(isIdentityError(e)).toBe(false);
    }
  });
});
