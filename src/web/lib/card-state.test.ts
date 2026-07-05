import { describe, expect, it } from "vitest";
import { dragRotationDeg, outcomeFromDrag } from "./card-state";

describe("outcomeFromDrag", () => {
  it("returns null below the threshold", () => {
    expect(outcomeFromDrag(10, ["yes", "no"])).toBeNull();
    expect(outcomeFromDrag(-79, ["yes", "no"])).toBeNull();
  });

  it("picks the first outcome for a rightward drag past threshold", () => {
    expect(outcomeFromDrag(100, ["higher", "lower"])).toBe("higher");
  });

  it("picks the second outcome for a leftward drag past threshold", () => {
    expect(outcomeFromDrag(-100, ["higher", "lower"])).toBe("lower");
  });

  it("respects a custom threshold", () => {
    expect(outcomeFromDrag(50, ["yes", "no"], 40)).toBe("yes");
    expect(outcomeFromDrag(30, ["yes", "no"], 40)).toBeNull();
  });

  it("commits on a fast flick even under the distance threshold", () => {
    expect(outcomeFromDrag(20, ["higher", "lower"], 80, 600)).toBe("higher");
    expect(outcomeFromDrag(-20, ["higher", "lower"], 80, -600)).toBe("lower");
  });

  it("does not commit a slow drag under the distance threshold", () => {
    expect(outcomeFromDrag(20, ["higher", "lower"], 80, 50)).toBeNull();
  });
});

describe("dragRotationDeg", () => {
  it("is zero with no drag", () => {
    expect(dragRotationDeg(0)).toBe(0);
  });

  it("caps rotation at the max", () => {
    expect(dragRotationDeg(1000)).toBe(12);
    expect(dragRotationDeg(-1000)).toBe(-12);
  });
});
