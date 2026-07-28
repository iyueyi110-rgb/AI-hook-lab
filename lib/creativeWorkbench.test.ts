import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkbenchBrief,
  candidatesToHooks,
  hooksToSeedCandidates,
  wordLimitToBand,
} from "./creativeWorkbench.ts";

test("maps numeric word limits into the four Agent bands", () => {
  assert.equal(wordLimitToBand(30), "30-50");
  assert.equal(wordLimitToBand(50), "30-50");
  assert.equal(wordLimitToBand(51), "60-80");
  assert.equal(wordLimitToBand(80), "60-80");
  assert.equal(wordLimitToBand(81), "90-110");
  assert.equal(wordLimitToBand(110), "90-110");
  assert.equal(wordLimitToBand(111), "120-150");
  assert.equal(wordLimitToBand(150), "120-150");
});

test("converts the shared brief without blank optional fields", () => {
  assert.deepEqual(
    buildWorkbenchBrief({
      topic: " AI 周报 ",
      platform: "douyin",
      contentType: "video",
      targetAudience: " ",
      emotionTone: "",
      wordLimit: 80,
      imageDescription: " ",
    }),
    {
      topic: "AI 周报",
      platform: "douyin",
      contentType: "video",
      wordLimitBand: "60-80",
    },
  );
});

test("includes meaningful optional brief values", () => {
  assert.deepEqual(
    buildWorkbenchBrief({
      topic: "",
      platform: "xiaohongshu",
      contentType: "image-text",
      targetAudience: " 新手产品经理 ",
      emotionTone: "curious",
      wordLimit: 30,
      imageDescription: " 一张周报截图 ",
    }),
    {
      topic: "",
      platform: "xiaohongshu",
      contentType: "image-text",
      targetAudience: "新手产品经理",
      emotionTone: "curious",
      wordLimitBand: "30-50",
      imageDescription: "一张周报截图",
    },
  );
});

test("strips classic-only candidate metadata at the Agent boundary", () => {
  const [candidate] = hooksToSeedCandidates([
    {
      id: "hook-1",
      text: " 开头 ",
      style: " 反差 ",
      reasoning: " 具体理由 ",
      overallScore: 8,
      scores: { impact: 8, platformFit: 7, actionability: 7, shareability: 6 },
      badcaseTags: ["too_long", "too_long"],
      adopted: true,
      platformSatisfaction: 5,
      templateVersion: "v1",
      promptVariant: "candidate",
    },
  ]);

  assert.deepEqual(candidate, {
    id: "hook-1",
    text: "开头",
    style: "反差",
    reasoning: "具体理由",
    overallScore: 8,
    scores: { impact: 8, platformFit: 7, actionability: 7, shareability: 6 },
    badcaseTags: ["too_long"],
  });
});

test("normalizes legacy scores and maps Agent candidates back to shared hooks", () => {
  const [candidate] = hooksToSeedCandidates([
    {
      id: "legacy",
      text: "旧候选",
      style: "提问",
      reasoning: "",
      score: 12,
    },
  ]);
  assert.equal(candidate?.overallScore, 10);
  assert.deepEqual(candidate?.scores, {
    impact: 10,
    platformFit: 10,
    actionability: 10,
    shareability: 10,
  });

  assert.deepEqual(candidatesToHooks([candidate!]), [
    {
      ...candidate,
      score: 10,
      badcaseTags: [],
    },
  ]);
});
