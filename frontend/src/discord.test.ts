import { describe, expect, it, vi } from "vitest";
import { getIdentity, updateActivity } from "./discord";

// Le handshake Embedded App SDK, réduit à ce que `resolveIdentity` en consomme.
const { setActivity } = vi.hoisted(() => ({ setActivity: vi.fn().mockResolvedValue({}) }));

vi.mock("@discord/embedded-app-sdk", () => ({
  RPCCloseCodes: { CLOSE_NORMAL: 1000 },
  DiscordSDK: class {
    channelId = "chan-1";
    ready = () => Promise.resolve();
    close = () => undefined;
    commands = {
      authorize: () => Promise.resolve({ code: "code-abc" }),
      authenticate: () => Promise.resolve({ user: { id: "42", username: "joueur" } }),
      setActivity,
    };
  },
}));

vi.stubEnv("VITE_DISCORD_CLIENT_ID", "app-de-test");
vi.stubGlobal("window", { location: { search: "?frame_id=1" } }); // = dans l'iframe Discord
vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: "tok" }) }));

describe("Rich Presence : l'état poussé avant la fin du handshake", () => {
  it("est rejoué une fois la session RPC authentifiée", async () => {
    // `main.ts` monte le Menu sans attendre l'identité : cet appel-ci arrive avant le SDK.
    updateActivity("menu");
    expect(setActivity).not.toHaveBeenCalled();

    await getIdentity();

    expect(setActivity).toHaveBeenCalledTimes(1);
    const { activity } = setActivity.mock.calls[0][0];
    expect(activity.details).toBe("Dans le menu");
    expect(activity.assets.large_image).toBe("menu");
    expect(activity.assets.small_image).toBe("app-icon");
  });
});
