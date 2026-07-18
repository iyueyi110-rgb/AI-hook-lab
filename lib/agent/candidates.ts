import type { Candidate } from "./types.ts";

function compareNumberDescending(left: number, right: number): number {
  return right - left;
}

function compareCandidate(left: Candidate, right: Candidate): number {
  const scoreOrder = [
    compareNumberDescending(left.overallScore, right.overallScore),
    compareNumberDescending(left.scores.impact, right.scores.impact),
    compareNumberDescending(left.scores.platformFit, right.scores.platformFit),
    compareNumberDescending(left.scores.actionability, right.scores.actionability),
    compareNumberDescending(left.scores.shareability, right.scores.shareability),
    left.badcaseTags.length - right.badcaseTags.length,
  ];
  return scoreOrder.find((value) => value !== 0) ?? left.id.localeCompare(right.id);
}

export function compareCandidates(candidates: Candidate[]): { top3: Candidate[]; explanations: string[] } {
  const top3 = [...candidates].sort(compareCandidate).slice(0, 3);
  return {
    top3,
    explanations: top3.map((candidate) => {
      const tags = candidate.badcaseTags.length ? candidate.badcaseTags.join(", ") : "none";
      return `Candidate ${candidate.id}: score ${candidate.overallScore}; dimensions ${candidate.scores.impact}/${candidate.scores.platformFit}/${candidate.scores.actionability}/${candidate.scores.shareability}; known bad-case tags: ${tags}; reasoning: ${candidate.reasoning}`;
    }),
  };
}
