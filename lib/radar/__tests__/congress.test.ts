import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isoDate, memberMatch, parseIndex, unzipFirstXml } from "../congress";

// Real excerpt of the House Clerk's 2026FD.zip (from the day-trader skill's fixtures)
const zip = readFileSync(path.join(__dirname, "fixtures", "2026FD.zip"));

describe("congress index", () => {
  const rows = parseIndex(unzipFirstXml(zip).toString("utf8"), 2026);

  it("unzips and parses every filing, newest first", () => {
    expect(rows.length).toBeGreaterThan(5);
    const dates = rows.map((r) => r.filed ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("builds PTR links and names", () => {
    const c = rows.find((r) => r.docId === "20035622");
    expect(c).toMatchObject({
      type: "P",
      last: "Cisneros",
      district: "CA31",
      filed: "2026-10-12",
      name: "Hon. Gilbert Cisneros",
      url: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035622.pdf",
    });
    const w = rows.find((r) => r.docId === "8068");
    expect(w?.url).toContain("/financial-pdfs/2026/8068.pdf");
  });

  it("passes plain XML through", () => {
    const xml =
      "<FinancialDisclosure><Member><Last>X</Last><FilingType>P</FilingType><DocID>1</DocID><FilingDate>1/2/2026</FilingDate></Member></FinancialDisclosure>";
    expect(parseIndex(unzipFirstXml(Buffer.from(xml)).toString(), 2026)[0].filed).toBe(
      "2026-01-02"
    );
  });
});

describe("helpers", () => {
  it("isoDate", () => {
    expect(isoDate("8/21/2026")).toBe("2026-08-21");
    expect(isoDate("08/01/26")).toBe("2026-08-01");
    expect(isoDate("x")).toBeNull();
  });
  it("memberMatch", () => {
    const f = { first: "Nancy", last: "Pelosi" };
    expect(memberMatch(f, "pelosi")).toBe(true);
    expect(memberMatch(f, "Nancy Pelosi")).toBe(true);
    expect(memberMatch(f, "Pelosi, N")).toBe(true);
    expect(memberMatch(f, "Paul Pelosi")).toBe(false);
    expect(memberMatch(f, "")).toBe(true);
  });
});
