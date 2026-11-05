import { describe, expect, it } from "vitest";
import { GEMEINSAM, standardVerbindung, verbindung } from "./supabase";

describe("Verbindung zum Server", () => {
  it("nimmt auf der Website das gemeinsame Projekt der Apps", () => {
    expect(standardVerbindung("simonbruder-hub.github.io")).toEqual(GEMEINSAM);
    expect(GEMEINSAM.url).toBe("https://xlbddpaxwjgseqxaicuf.supabase.co");
  });

  it("bleibt lokal, in den Tests und auf fremden Seiten ohne Verbindung", () => {
    expect(standardVerbindung("localhost")).toBeNull();
    expect(standardVerbindung("127.0.0.1")).toBeNull();
    expect(standardVerbindung("jemand.github.io")).toBeNull();
    // Node: kein location, kein localStorage, keine Build-Variablen
    expect(verbindung()).toBeNull();
  });
});
